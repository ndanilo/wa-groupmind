import pino from 'pino'

import { config } from '../config/env.js'

export const logger = pino({
  level: config.logLevel,
  // pino-pretty is a dev dependency, so plain JSON lines are used in production.
  ...(config.isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
})

/**
 * Flattens an unknown throwable into loggable fields.
 *
 * Errors have non-enumerable properties, so passing one straight to pino logs `error: {}`
 * and throws away the message and stack.
 */
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: String(error.cause) } : {}),
    }
  }
  return { value: String(error) }
}
