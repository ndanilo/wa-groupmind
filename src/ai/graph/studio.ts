import { createAssistantGraph } from './graph.js'

/**
 * Entry point for the LangGraph dev server (`npm run langchain:server`).
 *
 * Studio renders the routing decision, every node's state update and each tool call,
 * which is a far better way to inspect a run than reading the pino output.
 *
 * Invoke it with just a question, e.g. { "question": "what is the current inflation rate?" }.
 */
export const graph = createAssistantGraph()
