import { currentDateTimeTool } from './datetime.js'
import { createWebExtractTool, createWebSearchTool } from './tavily.js'

export { currentDateTimeTool } from './datetime.js'
export { createWebExtractTool, createWebSearchTool } from './tavily.js'

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

export type ResearchTools = ReturnType<typeof createResearchTools>
