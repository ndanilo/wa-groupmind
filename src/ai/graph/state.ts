import * as z from 'zod'
import { StateSchema } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

import type { InfographicBrief } from '../infographic/schema.js'
import type { GeneratedImage } from '../services/ImageService.js'
import type { SavedInfographic } from '../lib/imageStore.js'

/*
Shared state for the assistant graph.

mode defaults to text — an image is only produced when classify sets mode=image.
researchMessages / brief / image are optional because each branch fills a different subset.
*/

export const AssistantState = new StateSchema({
  question: z.string(),
  mode: z.enum(['text', 'image']).default('text'),
  needsResearch: z.boolean().default(true),
  /** topics = scannable bold headlines (default). detailed = prose, only when asked. */
  depth: z.enum(['topics', 'detailed']).default('topics'),
  /** How recent the sources must be. Sets Tavily's topic and time range for the run. */
  freshness: z.enum(['day', 'week', 'none']).default('none'),
  intentSource: z.enum(['keyword', 'llm']).default('keyword'),
  researchMessages: z.array(z.custom<BaseMessage>()).default(() => []),
  truncated: z.boolean().default(false),
  /** Every citable URL the run retrieved. */
  sources: z.array(z.string()).default(() => []),
  /** The subset the answer actually cited, which is what the reader gets linked to. */
  citedSources: z.array(z.string()).default(() => []),
  /** Publication dates of the freshest and oldest source, when Tavily supplied them. */
  newestSource: z.string().optional(),
  oldestSource: z.string().optional(),
  answer: z.string().default(''),
  brief: z.custom<InfographicBrief>().optional(),
  imagePrompt: z.string().default(''),
  styleReferences: z.array(z.string()).default(() => []),
  image: z.custom<GeneratedImage>().optional(),
  saved: z.custom<SavedInfographic>().optional(),
  costUsd: z.number().optional(),
})

export type AssistantStateType = typeof AssistantState.State
export type AssistantStateUpdate = typeof AssistantState.Update
