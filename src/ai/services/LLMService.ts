import { ChatOpenAI } from '@langchain/openai'
import { createAgent, providerStrategy, toolCallLimitMiddleware } from 'langchain'
import { GraphRecursionError } from '@langchain/langgraph'
import { z } from 'zod/v3'
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { ClientTool, ServerTool } from '@langchain/core/tools'

import { getChatConfig, getOutputConfig } from '../config.js'
import { toWhatsAppText } from '../lib/whatsappText.js'
import { createResearchTools } from '../tools/index.js'
import {
  infographicBriefSchema,
  MIN_RANKING_ITEMS,
  MAX_RANKING_ITEMS,
  normaliseBrief,
  type InfographicBrief,
} from '../infographic/schema.js'
import { prefersRankingLayout } from '../infographic/layout.js'
import { languageName } from '../infographic/prompt.js'

export type AgentTool = ClientTool | ServerTool

/*
Routing contract for the classifier stage.

Deliberately two booleans rather than one enum of four states: the two questions are
independent, and an image request always implies research (enforced in normaliseIntent).
*/
export const intentSchema = z.object({
  mode: z
    .enum(['text', 'image'])
    .describe(
      'image only when the user wants a picture (infographic, poster, chart, drawing, illustration). text for every other question, including questions about numbers or rankings.',
    ),
  needsResearch: z
    .boolean()
    .describe(
      'true when answering needs live web data (current events, prices, rates, releases, anything time-sensitive or any named entity to get right). false only for small talk or a self-contained language task.',
    ),
})

export type Intent = z.infer<typeof intentSchema>

/**
 * How much room the text answer gets.
 *
 * Deliberately NOT part of the classifier's job. Asked to judge it, the model called a
 * plain "quais as notícias de hoje" detailed and produced the wall of prose this format
 * exists to avoid. Prose is opt-in via an explicit word, decided by detectAnswerDepth.
 */
export type AnswerDepth = 'topics' | 'detailed'

/** An infographic without researched facts is the failure mode we already fixed once. */
export function normaliseIntent(intent: Intent): Intent {
  const mode = intent.mode === 'image' ? 'image' : 'text'
  return {
    mode,
    needsResearch: mode === 'image' ? true : intent.needsResearch !== false,
  }
}

/*
Four jobs, four temperatures.

classify decides the shape of the reply: a text answer (the default) or an infographic,
and whether live research is needed at all.
research calls tools in a loop and produces accurate but dry notes.
brief reduces those notes to the handful of figures worth putting on a poster.
answer rewrites those notes as the message a person actually reads in WhatsApp.

Splitting them means the writing steps cannot invent a tool call, and the research step
cannot be pushed off-facts by a warmer sampling setting.
*/

const RESEARCH_PROMPT = `You are a research assistant with live web access. Your notes will
be turned into an infographic, so concrete figures matter more than prose.

You do not know today's date and your training data is stale, so for any question about
current facts, prices, news or recent events:
1. Call get_current_datetime first so you know what "now" means.
2. Call web_search to find sources. Put the current year in the query when it matters.
3. If a snippet is too thin to answer, call web_extract on the most promising URL. Never
   extract a video or social page (youtube.com, instagram.com, facebook.com, tiktok.com,
   x.com, reddit.com): the page carries no article text, so it wastes the extract budget
   and cannot be cited. Prefer a news site, an official source or a research page.
4. Answer only from what the tools returned. If they disagree or come back empty, say so
   instead of filling the gap from memory.

Stay inside the scope of the question. If it names a country, a region, a company, an entity
or a period, search in that scope — write the query in the local language and prefer local
sources ("in Brazil" means Brazilian sources and the Brazilian entity, not the US parent).
Never substitute data from somewhere else without labelling it as such, and if the tools only
returned the wrong scope, say that plainly.

Prioritise things that can be drawn: numbers, percentages, dates, rankings, before/after
comparisons, and — when the user asks for a list / best-of / top N / recommendations —
concrete named items (titles, products, funds) with a reason and a score or platform when
available. Always write a figure with its unit and its period, e.g. "12.4% (year to
August 2026)". Note when sources disagree and by how much.

For list-style questions, finish your notes with a clear ranked bullet list of the best
named items you found (at least five when the sources support it), each with one reason
and any score/platform/year from the tools. Do not summarise a list as "10 titles were
mentioned" — write the titles.

Budget: at most two searches and two extracts. Never repeat a search you have already run
with different wording, a different language, or a narrower date — if the first results did
not contain the exact figure, they will not on the fourth attempt either. Approximate
answers with an honest caveat ("around 5.18, and sources vary by a few cents") are correct
and useful; silence is not. Stop and answer as soon as you can say something true.

Be precise rather than readable: other models turn your notes into prose and into a poster.
Always finish with the URLs you relied on, and note how fresh the information is.`

function briefPrompt(language: string): string {
  return `You turn research notes into the copy for a single poster.

LANGUAGE: every string you produce is printed on the poster, and the poster is for
${language} readers. Write every field in ${language}, including headings and labels, and
use the number, date and currency conventions of ${language}. The research notes are often
in another language; translate them. Never leave a field in the language of the notes.

LAYOUT — choose first:
- ranking — the user asked for a list, ranking, best-of, top N, "which ones", "what is worth
  it", recommendations, or the answer is naturally a set of named things (series, films,
  funds, places, tools). Fill \`items\` with ${MIN_RANKING_ITEMS}–${MAX_RANKING_ITEMS} real
  names from the notes (best first). Each item needs name + badge (score/platform/year/return)
  + why. Leave \`panels\` as []. NEVER collapse a list into aggregates like "10 titles" or
  "2 finales" — list the names.
- stats — the answer is a handful of figures (rates, %, dates, poll numbers). Fill
  \`panels\` with 3–4 figures. Leave \`items\` as [].

Rules for stats panels:
- Use ONLY figures that appear in the notes. Never invent statistics.
- Each panel is one figure: label (no number), figure (number+unit), note, icon, visual.
- Respect the character limit for each field.

Rules for ranking items:
- Use ONLY names that appear in the notes, spelled exactly as the notes spell them. Never
  invent a title, product or score, and never re-spell a name.
- Prefer items that several sources agree on; if sources disagree, still pick the strongest
  ones and say so in \`why\` when it matters.
- badge: ONE short chip only — "IMDb 8.4", "Netflix", "Max", "CDI+", "2026". Never two facts in one badge.
- why: one short punchy line (under ~10 words) that fits under the title on a phone screen.
- Prefer the strongest ${MAX_RANKING_ITEMS} items; quality over stuffing the list.
- Never put a URL or source name in any field.

ART DIRECTION: \`art\` and every panel \`icon\` are written in English and are never printed.
- First set \`art.tone\`: editorial (news/economy/health…) or expressive (games/entertainment…).
  Ranking posters about culture/entertainment usually use expressive; money/news use editorial.
- Palette and mood: modern digital (2020s). Deep charcoal/midnight + one electric accent +
  clean off-white. Ban cream newspaper beige and Brazilian-flag colour blocks.
- Panel visuals (stats only): prefer chart for trajectories/comparisons.
- Never cartoons, thick black outlines, clip-art, trophies, lightbulbs, briefcases,
  clipboards, or identifiable real people.`
}

const CLASSIFIER_PROMPT = `You route an incoming WhatsApp question to the right kind of reply.

Return exactly two fields:

mode
- "image" ONLY when the user actually wants a picture: an infographic, poster, chart, card,
  drawing or illustration. Look for verbs like gerar/criar/fazer/montar/desenhar paired with
  imagem/arte/infográfico/pôster, or an explicit noun like "infográfico".
- "text" for everything else. This is the default. A question that merely happens to be
  about numbers, rankings or data is still "text" — wanting information is not wanting a picture.

needsResearch
- true when answering well requires live web data: current events, prices, rates, scores,
  releases, "latest", "2026", anything that changes over time, or any named entity the answer
  must get factually right.
- true whenever the reply has to carry identifying details of a real company or person — an
  address, a phone number, an e-mail, a CNPJ, a link. Drafting a document, receipt or template
  does not make it self-contained if the text has to contain real data.
- false only for small talk, greetings, thanks, or a self-contained language/logic task
  (translate this, summarise this text, what does this word mean).

When in doubt choose mode "text" and needsResearch true: a researched answer is never wrong,
an unwanted image costs money.`

/** Shared rules. Only the FORMAT block differs between the two depths. */
function answerBase(language: string): string {
  return `You turn research notes into a reply for someone who just asked a question in a
WhatsApp group.

LANGUAGE: write the whole reply in ${language}, using its number, date and currency
conventions. The notes are often in another language; translate them. Never leave a sentence
in the language of the notes.

Rules:
- Answer the question that was asked, nothing adjacent to it. Respect its scope: the country,
  entity, period or figure it names. If the notes only cover a different scope — the US parent
  instead of the Brazilian company, last year instead of this one — say so in one line rather
  than answering about the other thing.
- Use ONLY the facts in the notes. Never add anything from your own knowledge, and never
  invent a number, date, name or URL.
- Copy every proper name — people, companies, places, titles — exactly as the notes spell
  it, character for character. Never re-spell, complete, translate or abbreviate a name;
  if the notes spell it two ways, use the one the sources agree on.
- WhatsApp formatting only: *bold* is a single asterisk each side, _italic_ sparingly.
  NEVER use markdown headings (#), NEVER use ** for bold, no tables, no code blocks.
- Keep any caveat that genuinely matters: a figure that moves, an approximate value, sources
  that disagree.
- If the notes do not actually answer the question, say so plainly instead of guessing.
- Never mention notes, research, searching, tools, or that you are an AI. Just answer.
- Finish with a sources line — the word for "Sources" in ${language} followed by a colon —
  listing at most five bare URLs, one per line. Skip it entirely when the notes carry no URLs.`
}

/** Default: a scannable list of bold topics. What people actually read in a group chat. */
function topicsAnswerPrompt(language: string): string {
  return `${answerBase(language)}

FORMAT — a scannable list of topics, NOT flowing prose:
- Three to six topics, most important first.
- Each topic is exactly two lines:
    *Short bold headline*
    One sentence carrying the concrete fact — a number, a name, a date.
- One blank line between topics.
- No opening sentence, no closing summary, no bullet characters (-, •, *) and no numbering
  before the headlines. The bold headline IS the marker.
- The headline is a real headline, not a category label: "*Inflation holds at 4.5%*" is right,
  "*Economy*" is not.
- Never let a topic run past two lines. Move the extra fact into its own topic or drop it.
- Exactly one blank line between topics — never two or three.
- Stay under ${ANSWER_BODY_LIMITS.topics} characters, not counting the sources lines.
  Drop the weakest topic rather than running over.`
}

/** Only when explicitly asked to explain or go deep. */
function detailedAnswerPrompt(language: string): string {
  return `${answerBase(language)}

FORMAT — the reader explicitly asked for a full explanation, so write prose:
- Lead with the direct answer in the first sentence.
- Two to four short paragraphs, separated by a blank line. Explain causes and consequences,
  not just the headline facts.
- Use *bold* only for the figures and names that matter most.
- A numbered list is fine when the question asks for a list, ranking, best-of or top N. In a
  list, write the real names — never collapse it into "10 titles".
- Stay under ${ANSWER_BODY_LIMITS.detailed} characters, not counting the sources lines.
  That is a ceiling, not a target: stop when the question is answered instead of padding to
  fill it, and finish your last sentence inside the budget rather than running over.`
}

/**
 * The no-research path: no notes, so the model answers from its own knowledge.
 *
 * Depth is honoured here too. It used to be dropped, which capped "me explique …" and "monta
 * um recibo pra mim" at the topics budget under a prompt asking for a couple of sentences —
 * the two asks most likely to want room were the two that could not have it.
 */
function directAnswerPrompt(language: string, depth: AnswerDepth): string {
  const format =
    depth === 'detailed'
      ? `- The reader asked for a full explanation or for something drafted, so take the room:
  short paragraphs, or a clearly structured block for a document. Stay under
  ${ANSWER_BODY_LIMITS.detailed} characters — a ceiling, not a target.`
      : '- Answer directly and briefly: a couple of sentences, or a short numbered list.'

  return `You are a helpful assistant replying in a WhatsApp group.

LANGUAGE: write the whole reply in ${language}.

Rules:
${format}
- WhatsApp formatting only: *bold* is a single asterisk each side, _italic_ sparingly.
  NEVER markdown headings (#) or ** for bold.
- You have no web access in this path, so never state a fact that could have changed
  recently (a price, a rate, a score, a release date). If the question needs current data,
  say plainly that you would need to look it up.
- You also have no source for identifying details about a real company or person: an address,
  a phone number, an e-mail, a CNPJ or CPF, a bank account, a link. Never write one from
  memory, not even inside a document, template or receipt the user asked you to draft — leave
  a clearly marked blank instead, and say the details need to be filled in or looked up.
- Never mention tools, prompts, or that you are an AI model. Just reply.`
}

export type ChatModelOptions = {
  /**
   * Caps visible output. Only safe once reasoning is off: on a reasoning model the budget
   * is spent on hidden tokens first, so a low cap returns empty content.
   */
  maxTokens?: number
  /**
   * OpenRouter reasoning control (`reasoning: { enabled: false }`).
   *
   * Default models here are reasoning models, and reasoning dominates generation time —
   * around 85% of output tokens on a routing or rewriting call, where it buys nothing.
   * Turn it off for mechanical stages, leave it on where multi-step judgement helps.
   */
  reasoning?: boolean
}

/** The OpenRouter-backed chat model this project talks to. */
function createChatModel(
  temperature: number,
  options: ChatModelOptions = {},
): BaseChatModel {
  const ConfigModel = getChatConfig()
  return new ChatOpenAI({
    apiKey: ConfigModel.apiKey,
    modelName: ConfigModel.model,
    temperature,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.reasoning === false ? { modelKwargs: { reasoning: { enabled: false } } } : {}),
    timeout: ConfigModel.requestTimeoutMs,
    maxRetries: ConfigModel.maxRetries,
    configuration: {
      baseURL: ConfigModel.apiHost,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/ndanilo/wa-groupmind',
        'X-Title': 'wa-groupmind',
      },
    },
  })
}

/**
 * Compiles the model + tools + prompt into an agent graph.
 *
 * The agent is stateless config, so one instance is safe to share across concurrent jobs.
 */
function createResearchAgent(
  model: BaseChatModel = createChatModel(getChatConfig().researchTemperature),
  tools: AgentTool[] = createResearchTools(),
) {
  const ConfigModel = getChatConfig()
  return createAgent({
    model,
    tools,
    systemPrompt: RESEARCH_PROMPT,
    middleware: [
      // "continue" rejects further tool calls but hands control back to the model
      // so it still writes an answer. "end" cannot be used here because it throws
      // when a step contains several parallel tool calls, which ours routinely do.
      toolCallLimitMiddleware({
        runLimit: ConfigModel.maxToolCallsPerRun,
        exitBehavior: 'continue',
      }),
    ],
  })
}

export type ResearchResult = {
  messages: BaseMessage[]
  /** True when the loop was cut short instead of the model deciding it was done. */
  truncated: boolean
}

export type ResearchDigest = {
  /** The research agent's own answer: already synthesised, just not friendly. */
  findings: string
  /** Truncated raw tool output, so later stages can quote concrete details. */
  evidence: string[]
  /** Every URL the tools returned, deduplicated. */
  sources: string[]
}

/** Per-tool-result cap. Full pages would crowd out the findings and cost tokens. */
const MAX_EVIDENCE_CHARS = 1200
/*
How much of the research each writing stage gets to see.

The brief stays tight — huge evidence is what makes structured output crawl, and a poster
only needs a handful of figures. The answer stage gets more, because a reply budget it can
never fill with real material is an invitation to pad: 5000 characters of prose cannot come
out of 2500 characters of notes without something being invented.
*/
const DIGEST_BUDGETS = {
  brief: { findings: 2500, evidence: 3, evidenceChars: 500 },
  answer: { findings: 4000, evidence: 4, evidenceChars: 900 },
} as const

type DigestBudget = (typeof DIGEST_BUDGETS)[keyof typeof DIGEST_BUDGETS]

const MAX_SOURCES = 10
const URL_PATTERN = /https?:\/\/[^\s"'<>)\]}]+/g
/**
 * Hosts that are never a citable source for a written answer.
 *
 * Tavily happily returns video and social permalinks, and printing "Sources:
 * youtube.com/watch?v=…" under a news summary reads as unsourced. Same idea as the host
 * filter in lib/styleRefs.ts, different reason.
 */
const UNCITABLE_HOST = /(?:youtube\.com|youtu\.be|instagram\.com|facebook\.com|fbcdn\.net|tiktok\.com|x\.com|twitter\.com|reddit\.com)/i
/**
 * Per-depth length budgets for the whole message. WhatsApp accepts ~4000 chars, but a wall
 * of text in a group chat is its own failure — topics stays scannable, detailed explains.
 *
 * topics carries 1800 rather than 1500 so a full topic list and five source URLs both fit:
 * five long news links run past 500 characters on their own.
 *
 * detailed carries 5000 because that path only runs when someone explicitly asked to be
 * explained to, or asked for something to be drafted, and both want room. WhatsApp's own
 * ceiling on this protocol is 65,536 characters — the widely quoted 4096 is a Cloud API
 * limit and does not apply to Baileys — so the real cost is the reader's patience, since
 * WhatsApp collapses a long message behind "Ler mais".
 *
 * The budget is also stated in the prompt: a model that self-limits ends cleanly, whereas
 * capAnswer cutting in has to trim mid-sentence.
 */
const ANSWER_LIMITS = { topics: 1800, detailed: 5000 } as const
/**
 * Room set aside for the trailing sources block: a header plus five news URLs, which
 * tokenise and measure badly (a single g1 link runs past 80 characters).
 */
const SOURCES_RESERVE = 500
/**
 * What the prompt asks the model to stay under, so it self-limits on the same terms
 * capAnswer enforces: body only, sources excluded.
 */
const ANSWER_BODY_LIMITS = {
  topics: ANSWER_LIMITS.topics - SOURCES_RESERVE,
  detailed: ANSWER_LIMITS.detailed - SOURCES_RESERVE,
} as const
/** Matches the "at most five" in the answer prompts. */
const MAX_ANSWER_SOURCES = 5
/**
 * Hard ceiling on the sources block, so a freak long URL cannot squeeze out the answer.
 * Five long news links need roughly a third of the topics budget.
 */
const MAX_SOURCES_SHARE = 0.35
/** A trailing bare URL line, with or without a bullet WhatsApp would render literally. */
const SOURCE_LINE = /^(?:[-•*\d.)\s]+)?(https?:\/\/\S+)$/
/**
 * The line the URLs hang off. Matched by shape, not by wording, because OUTPUT_LANGUAGE
 * decides it — "Sources:", "Fontes:", "Fuentes:". Optionally with one URL inline.
 */
const SOURCE_HEADER = /^(.{1,24}?:)\s*(https?:\/\/\S+)?$/
/**
 * Headroom for the largest budget in a verbose language plus five source URLs, which tokenise
 * badly — a single 100-character link costs upwards of 30 tokens. Capping here is what
 * keeps the answer stage from running for minutes, so it has to clear ANSWER_LIMITS or the
 * character budget is fiction: the model would stop mid-sentence before reaching it.
 *
 * 5000 characters of Portuguese is roughly 2000 tokens at the pessimistic end, so 2600
 * leaves room for the sources without letting a runaway answer generate for a minute.
 */
const ANSWER_MAX_TOKENS = 2600

function asText(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

/**
 * Truncates notes without splitting the last token.
 *
 * A hard slice lands inside a URL often enough to matter, and the writing stages copy what
 * they are shown: half a link in the notes becomes a dead link in the answer.
 */
function clip(value: string, max: number): string {
  if (value.length <= max) return value

  const cut = value.slice(0, max)
  // The last whitespace, i.e. the start of the token the slice broke.
  const boundary = cut.search(/\s\S*$/)

  return `${boundary > max * 0.8 ? cut.slice(0, boundary) : cut}…`
}

type AnswerParts = {
  body: string
  /** The model's own header, kept verbatim so OUTPUT_LANGUAGE decides its wording. */
  header?: string
  sources: string[]
}

/**
 * Splits the trailing sources block off the body.
 *
 * Capping the whole string used to slice inside the URL list, snap back to the newline
 * after the header and send a bare "Sources…" with every source gone — a researched answer
 * that looked unsourced. Separating them makes the body the only thing that can be cut.
 */
function splitSources(text: string): AnswerParts {
  const lines = text.split('\n')
  const sources: string[] = []
  let index = lines.length - 1

  for (; index >= 0; index -= 1) {
    const line = (lines[index] ?? '').trim()
    if (line === '') continue

    const url = SOURCE_LINE.exec(line)?.[1]
    if (url === undefined) break
    sources.unshift(url)
  }

  if (sources.length === 0) return { body: text.trim(), sources: [] }

  const header = SOURCE_HEADER.exec((lines[index] ?? '').trim())
  const inline = header?.[2]
  if (inline !== undefined) sources.unshift(inline)

  return {
    body: lines.slice(0, header ? index : index + 1).join('\n').trim(),
    header: header?.[1],
    sources,
  }
}

/** Renders the sources block, dropping links that would eat into the answer itself. */
function renderSources(parts: AnswerParts, max: number): string {
  const kept = parts.sources.slice(0, MAX_ANSWER_SOURCES)
  const ceiling = Math.floor(max * MAX_SOURCES_SHARE)
  const render = () => (parts.header === undefined ? kept : [parts.header, ...kept]).join('\n')

  while (kept.length > 1 && render().length > ceiling) kept.pop()

  return kept.length === 0 ? '' : render()
}

/**
 * Caps the answer body without collapsing it. Returns at most `max` characters.
 *
 * `shorten` in infographic/schema.ts flattens whitespace, which is right for a poster
 * label and wrong here: it would turn a numbered list into one long line.
 */
function capBody(value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed

  // One character short of the budget, because the ellipsis still has to fit.
  const cut = trimmed.slice(0, Math.max(max - 1, 0))
  /*
  A blank line is a topic or paragraph boundary. A single newline is not: in the topics
  format it sits between a bold headline and the line carrying its fact, so cutting there
  strands the headline with nothing under it.
  */
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '))
  const safe = boundary > max * 0.5 ? cut.slice(0, boundary) : cut

  return `${safe.replace(/[\s,;:.]+$/, '')}…`
}

/**
 * Fits a finished answer into its budget: sources reserved first, body trimmed second.
 *
 * Both halves matter to the reader, but only one of them can be shortened without turning
 * into noise — half a URL cites nothing.
 */
export function capAnswer(value: string, max: number): string {
  // The prompt asks for one blank line between topics; models routinely leave three, and
  // that padding is what pushes an otherwise fine answer over the budget.
  const normalised = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const parts = splitSources(normalised)
  const tail = renderSources(parts, max)

  if (tail === '') return capBody(parts.body, max)

  // The floor only bites if a single URL is pathologically long; better a short answer
  // than a negative budget.
  const budget = Math.max(max - tail.length - 2, Math.floor(max * 0.5))
  const body = capBody(parts.body, budget)

  return body === '' ? tail : `${body}\n\n${tail}`
}

/**
 * The agent's answer, which is the last AI message carrying text.
 *
 * Not simply the last message: when the tool budget blocks a call, the run ends on a
 * ToolMessage reading "Tool call limit exceeded", and treating that as the findings would
 * feed the next stage a framework message instead of research.
 */
function lastAnswer(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !AIMessage.isInstance(message)) continue

    const text = asText(message.content).trim()
    if (text.length > 0) return text
  }

  return ''
}

/** True when the agent stopped before writing a final answer. */
function endedWithoutAnswer(messages: BaseMessage[]): boolean {
  const last = messages.at(-1)
  if (!last || !AIMessage.isInstance(last)) return true

  return asText(last.content).trim().length === 0
}

/** Collapses a finished agent run into just what the later stages need to see. */
export function digestResearch(messages: BaseMessage[]): ResearchDigest {
  const evidence: string[] = []
  const sources = new Set<string>()

  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) continue

    const body = asText(message.content)

    for (const url of body.match(URL_PATTERN) ?? []) {
      const clean = url.replace(/[.,;]+$/, '')
      if (UNCITABLE_HOST.test(clean)) continue
      sources.add(clean)
    }

    evidence.push(`${message.name ?? 'tool'}: ${clip(body, MAX_EVIDENCE_CHARS)}`)
  }

  return {
    findings: lastAnswer(messages),
    evidence,
    sources: [...sources].slice(0, MAX_SOURCES),
  }
}

function renderDigest(
  question: string,
  digest: ResearchDigest,
  truncated: boolean,
  budget: DigestBudget,
): string {
  const findings = clip(digest.findings, budget.findings)

  const evidence = digest.evidence
    .slice(0, budget.evidence)
    .map((item) => clip(item, budget.evidenceChars))

  const sections = [
    `The user asked:\n${question}`,
    `\nWhat the research found:\n${findings}`,
  ]

  if (evidence.length > 0) {
    sections.push(`\nRaw evidence (truncated):\n${evidence.join('\n\n')}`)
  }

  if (digest.sources.length > 0) {
    // Has to stay ahead of MAX_ANSWER_SOURCES: the answer can only cite what it sees here.
    sections.push(`\nSource URLs:\n${digest.sources.slice(0, MAX_ANSWER_SOURCES + 3).join('\n')}`)
  }

  if (truncated) {
    sections.push(
      '\nThe research was cut short before it finished, so these notes may be' +
        ' incomplete. Answer with what is here, and tell the reader plainly that' +
        ' the figure could not be fully confirmed.',
    )
  }

  return sections.join('\n')
}

export type LLMServiceOptions = {
  /** Model driving the tool-calling research loop. */
  model?: BaseChatModel
  /** Tools exposed to the research agent. */
  tools?: AgentTool[]
  /** Model that reduces the research to structured infographic copy. */
  briefer?: BaseChatModel
  /** Model that rewrites the research into the user-facing WhatsApp answer. */
  presenter?: BaseChatModel
  /** Model that routes the question to text or image. */
  classifier?: BaseChatModel
}

export class LLMService {
  private researchModel: BaseChatModel
  private briefModel: BaseChatModel
  private presenterModel: BaseChatModel
  private classifierModel: BaseChatModel
  private agent: ReturnType<typeof createResearchAgent>
  private briefAgent: ReturnType<typeof createAgent> | undefined
  private briefLanguage: string | undefined
  private classifierAgent: ReturnType<typeof createAgent> | undefined

  constructor(options: LLMServiceOptions = {}) {
    const ConfigModel = getChatConfig()
    this.researchModel = options.model ?? createChatModel(ConfigModel.researchTemperature)
    this.briefModel = options.briefer ?? createChatModel(ConfigModel.briefTemperature)
    // Rewriting notes into prose and routing a question are both mechanical: reasoning
    // only added latency (50s+ answers, 12s+ routing) without improving either result.
    this.presenterModel =
      options.presenter ??
      createChatModel(ConfigModel.answerTemperature, {
        maxTokens: ANSWER_MAX_TOKENS,
        reasoning: false,
      })
    this.classifierModel =
      options.classifier ??
      createChatModel(ConfigModel.classifierTemperature, { reasoning: false })

    // The agent is stateless config compiled into a graph, so build it once here
    // rather than on every request. Safe to share across concurrent jobs.
    this.agent = createResearchAgent(this.researchModel, options.tools ?? createResearchTools())
  }

  private getBriefAgent(language: string) {
    if (this.briefAgent && this.briefLanguage === language) return this.briefAgent
    this.briefLanguage = language
    this.briefAgent = createAgent({
      model: this.briefModel,
      tools: [],
      systemPrompt: briefPrompt(language),
      responseFormat: providerStrategy(infographicBriefSchema),
    })
    return this.briefAgent
  }

  /**
   * Stage 1: run the tool-calling loop and return the final agent state.
   *
   * Streamed rather than invoked so callers can report progress while it runs.
   * `onMessage` fires once per new message, in order.
   */
  async makeAIRequestAsync(
    userPrompt: string,
    onMessage: (message: BaseMessage) => void = () => {},
  ): Promise<ResearchResult> {
    const ConfigModel = getChatConfig()
    const stream = await this.agent.stream(
      { messages: [new HumanMessage(userPrompt)] },
      { streamMode: 'values', recursionLimit: ConfigModel.recursionLimit },
    )

    let messages: BaseMessage[] = []
    let reported = 0

    try {
      for await (const state of stream) {
        messages = state.messages

        for (const message of messages.slice(reported)) {
          onMessage(message)
        }
        reported = messages.length
      }
    } catch (error) {
      // Hitting the loop backstop is not a reason to throw away the research we
      // already have. Streaming means `messages` still holds every tool result.
      if (!(error instanceof GraphRecursionError)) throw error
      return { messages, truncated: true }
    }

    // The tool budget can also end a run mid-loop, without an exception.
    return { messages, truncated: endedWithoutAnswer(messages) }
  }

  /**
   * Stage 2: reduce a finished run to the copy for one poster.
   *
   * Structured rather than free text because the strings come back to us and get drawn
   * verbatim. A schema gives length limits the model must respect and a panel count we
   * can rely on, neither of which survives a prose prompt.
   */
  async writeInfographicBriefAsync(
    question: string,
    research: ResearchResult,
  ): Promise<InfographicBrief> {
    const digest = digestResearch(research.messages)
    const language = languageName(getOutputConfig().language)
    const agent = this.getBriefAgent(language)

    const layoutHint = prefersRankingLayout(question)
      ? `LAYOUT REQUIRED: ranking. Fill \`items\` with ${MIN_RANKING_ITEMS}–${MAX_RANKING_ITEMS} named entries from the notes (best first). Leave \`panels\` empty []. Do not invent aggregate stats panels.`
      : `LAYOUT: choose ranking if named items answer better, otherwise stats. For stats, prefer chart visuals when numbers move over time or compare.`

    const result = await agent.invoke({
      messages: [
        new HumanMessage(
          // Repeated here because a language instruction that appears only in the
          // system prompt loses to notes written in another language: the model
          // copies the notes' language into the fields.
          `Write every field of the brief in ${language}.\n${layoutHint}\n\n${renderDigest(question, digest, research.truncated, DIGEST_BUDGETS.brief)}`,
        ),
      ],
    })

    return normaliseBrief(result.structuredResponse as InfographicBrief)
  }

  private getClassifierAgent() {
    this.classifierAgent ??= createAgent({
      model: this.classifierModel,
      tools: [],
      systemPrompt: CLASSIFIER_PROMPT,
      responseFormat: providerStrategy(intentSchema),
    })
    return this.classifierAgent
  }

  /**
   * Routes a question to a reply shape.
   *
   * Only called when the free keyword pass in graph/intent.ts is inconclusive, so the
   * common case costs nothing.
   */
  async classifyIntentAsync(question: string): Promise<Intent> {
    const agent = this.getClassifierAgent()
    const result = await agent.invoke({
      messages: [new HumanMessage(`Question:\n${question}`)],
    })

    return normaliseIntent(result.structuredResponse as Intent)
  }

  /**
   * Rewrites a finished research run into the message a person reads.
   *
   * `research` may be undefined, which is the no-research path: the model answers from
   * its own knowledge under a prompt that forbids volatile facts.
   */
  async writeChatAnswerAsync(
    question: string,
    research?: ResearchResult,
    depth: AnswerDepth = 'topics',
  ): Promise<string> {
    const language = languageName(getOutputConfig().language)

    if (!research) {
      const response = await this.presenterModel.invoke([
        new SystemMessage(directAnswerPrompt(language, depth)),
        new HumanMessage(`Reply in ${language}.\n\n${question}`),
      ])
      return capAnswer(toWhatsAppText(asText(response.content)), ANSWER_LIMITS[depth])
    }

    const digest = digestResearch(research.messages)
    const detailed = depth === 'detailed'

    const formatHint = detailed
      ? '\nThe reader asked for an explanation, so write prose paragraphs.'
      : prefersRankingLayout(question)
        ? '\nThis question asks for a list: one topic per real name from the notes, bold headline plus one line each.'
        : '\nReply as three to six topics, each a bold headline plus one line. No prose paragraphs.'

    const response = await this.presenterModel.invoke([
      new SystemMessage(
        detailed ? detailedAnswerPrompt(language) : topicsAnswerPrompt(language),
      ),
      // Repeated here for the same reason as the brief stage: a language instruction that
      // lives only in the system prompt loses to notes written in another language.
      new HumanMessage(
        `Write the whole reply in ${language}.${formatHint}\n\n${renderDigest(question, digest, research.truncated, DIGEST_BUDGETS.answer)}`,
      ),
    ])

    return capAnswer(toWhatsAppText(asText(response.content)), ANSWER_LIMITS[depth])
  }
}
