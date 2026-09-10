import { currentDateTimeTool } from './datetime.js'
import {
  createWebCrawlTool,
  createWebExtractTool,
  createWebMapTool,
  createWebSearchTool,
} from './tavily.js'

export { currentDateTimeTool } from './datetime.js'
export {
  createWebCrawlTool,
  createWebExtractTool,
  createWebMapTool,
  createWebSearchTool,
} from './tavily.js'

/**
 * Default toolset: know the date, search, then read what you found.
 *
 * This is the smallest set that can answer "what is X right now", and small sets are
 * the point — every extra tool is more schema in the prompt and one more thing the
 * model can pick wrongly.
 */
export function createResearchTools() {
  return [currentDateTimeTool, createWebSearchTool(), createWebExtractTool()]
}

/** Adds the whole-site tools. Useful for "summarise these docs" style questions. */
export function createAllTools() {
  return [...createResearchTools(), createWebMapTool(), createWebCrawlTool()]
}

export type ResearchTools = ReturnType<typeof createResearchTools>
export type AllTools = ReturnType<typeof createAllTools>
