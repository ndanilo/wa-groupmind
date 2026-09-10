import type { onRequestAsyncHookHandler } from 'fastify'

/*
One static API key, compared as a plain string.

Deliberately the simplest thing that works, because two other guards carry most of the weight:
the app refuses to boot with NOTIFY_ENABLED=true and no key set, and NOTIFY_HOST defaults to
127.0.0.1 so nothing off-machine can reach the port. If this endpoint is ever exposed to the
public internet, upgrade to a timing-safe comparison and per-caller keys.
*/

export function apiKeyHook(expected: string): onRequestAsyncHookHandler {
  return async (request, reply) => {
    if (request.headers['x-api-key'] !== expected) {
      // Logged at warn: a wrong key on an endpoint that can send messages as you is worth seeing.
      request.log.warn({ url: request.url, ip: request.ip }, 'rejected request with invalid api key')
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'missing or invalid x-api-key header',
      })
    }
  }
}
