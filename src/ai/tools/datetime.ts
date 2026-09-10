import { tool } from 'langchain'
import { z } from 'zod'

/**
 * Hand-written tool, kept as the reference example of the `tool()` + zod pattern.
 *
 * It also does real work: a model has no idea what "today" is, so questions like
 * "the current dollar rate" are unanswerable until it can anchor itself in time.
 */
export const currentDateTimeTool = tool(
  ({ timeZone }) => {
    const now = new Date()
    const zone = timeZone ?? 'UTC'

    try {
      return JSON.stringify({
        iso: now.toISOString(),
        timeZone: zone,
        local: now.toLocaleString('en-CA', {
          timeZone: zone,
          dateStyle: 'full',
          timeStyle: 'long',
        }),
      })
    } catch {
      return `Unknown time zone "${zone}". Use an IANA name such as "America/Sao_Paulo", or omit the argument for UTC.`
    }
  },
  {
    name: 'get_current_datetime',
    description:
      "Get the current date and time. Call this before answering anything that depends on 'now' — today's date, current prices, recent events — so search queries and results can be judged against the real date.",
    schema: z.object({
      timeZone: z
        .string()
        .optional()
        .describe(
          'IANA time zone name, e.g. "America/Sao_Paulo" or "Europe/Lisbon". Defaults to UTC.',
        ),
    }),
  },
)
