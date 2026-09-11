import type { WASocket } from 'baileys'

import {
  createAssistantGraph,
  runAssistant,
  type AssistantGraph,
} from '../ai/graph/graph.js'
import { detectImageIntent } from '../ai/graph/intent.js'
import { config } from '../config/env.js'
import { errorFields, logger } from '../lib/logger.js'
import {
  AdmissionControl,
  JobTimeoutError,
  QueueFullError,
  TaskQueue,
  UserCooldownError,
  UserInFlightError,
} from '../lib/queue.js'
import {
  evaluateMention,
  selfIdentities,
  type InfographicRequest,
} from './mention.js'
import {
  sendAck,
  sendAnswer,
  sendError,
  sendInfographic,
  sendProgress,
  startTyping,
  type ErrorKind,
} from './reply.js'

const log = logger.child({ module: 'infographic' })

/**
 * How long research may run before the group is told it is still going.
 *
 * Comfortably past a normal run — a single-fact question finishes well inside this — so the notice
 * only appears when the question really is a big one.
 */
const PROGRESS_AFTER_MS = 90_000

export type InfographicRuntime = {
  graph: AssistantGraph
  admission: AdmissionControl
  /** Refreshed on every reconnect via setSelf(). */
  self: Set<string>
  setSelf(ids: Set<string>): void
  drain(): Promise<void>
}

export function createInfographicRuntime(): InfographicRuntime {
  const queue = new TaskQueue({
    concurrency: config.infographicConcurrency,
    maxQueued: config.infographicMaxQueued,
  })
  const admission = new AdmissionControl(queue, {
    cooldownMs: config.userCooldownMs,
    jobTimeoutMs: config.jobTimeoutMs,
  })

  // Lazily compiled on first use so WhatsApp can pair without AI keys present.
  let graph: AssistantGraph | undefined
  const getGraph = () => {
    graph ??= createAssistantGraph()
    return graph
  }

  let self = new Set<string>()

  return {
    get graph() {
      return getGraph()
    },
    admission,
    get self() {
      return self
    },
    setSelf(ids: Set<string>) {
      self = ids
    },
    drain: () => admission.drain(),
  }
}

/** The text branch produced nothing worth sending. */
class EmptyAnswerError extends Error {
  constructor() {
    super('graph returned an empty answer')
    this.name = 'EmptyAnswerError'
  }
}

function classifyError(error: unknown): ErrorKind {
  if (error instanceof UserInFlightError) return 'inFlight'
  if (error instanceof UserCooldownError) return 'cooldown'
  if (error instanceof QueueFullError) return 'queueFull'
  if (error instanceof JobTimeoutError) return 'timeout'
  if (error instanceof EmptyAnswerError) return 'emptyAnswer'
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const msg = error.message.toLowerCase()
    // LangChain/LangGraph AbortSignal timeouts surface as TimeoutError (often with pregelTaskId).
    if (name === 'timeouterror' || msg.includes('timeout') || msg.includes('aborted')) {
      return 'timeout'
    }
    if (msg.includes('image generation') || msg.includes('/images')) return 'image'
  }
  return 'research'
}

/**
 * Handles one incoming message against the mention gates and, on a hit, runs the
 * graph through the admission queue. Never throws to the caller — errors become
 * PT-BR replies. Safe to fire-and-forget from messages.upsert.
 */
export async function handleInfographicMessage(
  sock: WASocket,
  runtime: InfographicRuntime,
  msg: Parameters<typeof evaluateMention>[0],
  jid: string,
  type: Parameters<typeof evaluateMention>[2],
): Promise<void> {
  // Refresh self identities whenever the socket knows who we are.
  if (sock.user && runtime.self.size === 0) {
    runtime.setSelf(selfIdentities(sock.user))
  }

  const result = evaluateMention(msg, jid, type, runtime.self)

  if (result.kind === 'skip') {
    if (result.reason !== 'bot not mentioned' && result.reason !== 'not a group') {
      log.debug({ chat: jid, reason: result.reason }, 'infographic skipped')
    }
    return
  }

  if (result.kind === 'usage') {
    await sendError(sock, result.jid, result.message, result.requester, 'usage')
    return
  }

  await runRequest(sock, runtime, result.request)
}

async function runRequest(
  sock: WASocket,
  runtime: InfographicRuntime,
  request: InfographicRequest,
): Promise<void> {
  const { jid, question, requester, message } = request
  // Free keyword pass, only so the ack wording matches the likely outcome.
  const expectsImage = detectImageIntent(question) === 'image'
  log.info({ chat: jid, requester, question, expectsImage }, 'request received')

  let stopTyping: (() => void) | undefined
  let progressTimer: NodeJS.Timeout | undefined
  const cancelProgress = () => {
    if (progressTimer === undefined) return
    clearTimeout(progressTimer)
    progressTimer = undefined
  }

  try {
    await runtime.admission.admit(
      requester,
      async (signal) => {
        const run = await runAssistant(
          runtime.graph,
          question,
          {
            onNodeStart: (node) => {
              log.info({ chat: jid, node }, 'graph node started')
              if (node !== 'research') return
              progressTimer = setTimeout(() => {
                progressTimer = undefined
                void sendProgress(sock, jid, message)
              }, PROGRESS_AFTER_MS)
            },
            onStage: (node, elapsedMs) => {
              if (node === 'research') cancelProgress()
              log.info({ chat: jid, node, elapsedMs }, 'graph node finished')
            },
          },
          jid,
          signal,
        )

        if (run.mode === 'image') {
          if (!run.image || !run.brief) throw new Error('graph returned no image')

          // Logged before the send so a stalled WhatsApp upload is distinguishable
          // from a slow graph node.
          log.info({ chat: jid, bytes: run.image.bytes.length }, 'sending infographic')
          await sendInfographic(sock, jid, message, run.image, run.brief)
          log.info(
            {
              chat: jid,
              title: run.brief.title,
              costUsd: run.costUsd,
              saved: run.saved?.imagePath,
              truncated: run.truncated,
              intentSource: run.intentSource,
            },
            'infographic sent',
          )
          return
        }

        if (!run.answer.trim()) throw new EmptyAnswerError()

        log.info({ chat: jid, chars: run.answer.length }, 'sending answer')
        await sendAnswer(sock, jid, message, requester, run.answer)
        log.info(
          {
            chat: jid,
            chars: run.answer.length,
            depth: run.depth,
            freshness: run.freshness,
            sources: run.sources.length,
            // How many of those the answer actually leaned on. A wide gap between the two
            // means the run retrieved a lot and used little, which is what a shallow
            // answer looks like from outside.
            cited: run.citedSources.length,
            newestSource: run.newestSource,
            oldestSource: run.oldestSource,
            truncated: run.truncated,
            intentSource: run.intentSource,
          },
          'answer sent',
        )
      },
      // Ack + typing fire as soon as the user is admitted, even if still waiting for a worker.
      async () => {
        await sendAck(sock, jid, message, expectsImage)
        stopTyping = startTyping(sock, jid)
      },
    )
  } catch (error: unknown) {
    const kind = classifyError(error)
    const remainingMs = error instanceof UserCooldownError ? error.remainingMs : undefined
    log.error({ chat: jid, kind, remainingMs, ...errorFields(error) }, 'infographic failed')
    try {
      await sendError(sock, jid, message, requester, kind, remainingMs)
    } catch (sendErr: unknown) {
      log.error({ chat: jid, ...errorFields(sendErr) }, 'failed to send error reply')
    }
  } finally {
    // Both fire on every exit path: a timeout or a crash must not leave a timer that later tells
    // the group the bot is still researching a question it already gave up on.
    cancelProgress()
    stopTyping?.()
  }
}
