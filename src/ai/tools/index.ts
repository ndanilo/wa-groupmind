import { currentDateTimeTool } from './datetime.js'
import { createWebExtractTool, createWebSearchTool } from './tavily.js'

export { currentDateTimeTool } from './datetime.js'
export {
  createWebExtractTool,
  createWebSearchTool,
  FRESHNESS_KEY,
  searchSettings,
  type Freshness,
} from './tavily.js'

/**
 * Default toolset: know the date, search, then read what you found.
 *
 * This is the smallest set that can answer "what is X right now", and small sets are
 * the point — every extra tool is more schema in the prompt and one more thing the
 * model can pick wrongly.
 *
 * `get_current_datetime` stays available for a question that needs arithmetic on dates,
 * but it is no longer on the critical path: the current date is stated in the research
 * message, because relying on the model to ask for it meant one run knew what "today" was
 * and the next one did not.
 */
export function createResearchTools() {
  return [currentDateTimeTool, createWebSearchTool(), createWebExtractTool()]
}

export type ResearchTools = ReturnType<typeof createResearchTools>
