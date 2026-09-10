const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

const optionalString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const stringWithDefault = (value: string | undefined, fallback: string): string =>
  optionalString(value) ?? fallback

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

/** `qr` prints a QR code to scan, `code` shows an 8-character code to type into WhatsApp. */
export type PairingMode = 'qr' | 'code'

const pairingMode: PairingMode = process.env.PAIRING_MODE === 'code' ? 'code' : 'qr'

const aspectRatios = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  'auto',
] as const
type AspectRatio = (typeof aspectRatios)[number]

const resolutions = ['512', '1K', '2K', '4K'] as const
type Resolution = (typeof resolutions)[number]

const outputFormats = ['png', 'jpeg', 'webp'] as const
type OutputFormat = (typeof outputFormats)[number]

const pickEnum = <T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] => {
  const trimmed = value?.trim()
  return trimmed && (allowed as readonly string[]).includes(trimmed)
    ? (trimmed as T[number])
    : fallback
}

export const config = {
  pairingMode,
  /** Digits only, including country code, e.g. 5511999999999. Required when pairingMode is 'code'. */
  phoneNumber: (process.env.PHONE_NUMBER ?? '').replace(/\D/g, ''),
  authDir: process.env.AUTH_DIR ?? '.auth',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxReconnectAttempts: int(process.env.MAX_RECONNECT_ATTEMPTS, 10),
  logMessageContent: bool(process.env.LOG_MESSAGE_CONTENT, true),
  /** Messages you send yourself. On by default so the monitor visibly reacts to your own phone. */
  logOwnMessages: bool(process.env.LOG_OWN_MESSAGES, true),
  isProduction: process.env.NODE_ENV === 'production',

  // --- Infographic trigger ---
  /** Empty means every group. Otherwise only these group JIDs fire the bot. */
  allowedGroupJids: csv(process.env.ALLOWED_GROUP_JIDS),
  /** Ignore messages older than this, so a reconnect backlog cannot trigger paid runs. */
  requestMaxAgeSeconds: int(process.env.REQUEST_MAX_AGE_SECONDS, 60),
  maxQuestionLength: int(process.env.MAX_QUESTION_LENGTH, 500),

  // --- Queue ---
  infographicConcurrency: int(process.env.INFOGRAPHIC_CONCURRENCY, 3),
  infographicMaxQueued: int(process.env.INFOGRAPHIC_MAX_QUEUED, 10),
  userCooldownMs: int(process.env.USER_COOLDOWN_MS, 5_000),
  jobTimeoutMs: int(process.env.JOB_TIMEOUT_MS, 300_000),

  // --- Behaviour ---
  /**
   * How the bot refers to itself in usage hints (without the leading @).
   * Does not affect mention detection — that uses the linked account's JID/LID.
   */
  botDisplayName: stringWithDefault(process.env.BOT_DISPLAY_NAME, 'bobesponja-ai'),
  sendAck: bool(process.env.SEND_ACK, true),
  typingIndicator: bool(process.env.TYPING_INDICATOR, true),
  saveGeneratedImages: bool(process.env.SAVE_GENERATED_IMAGES, true),
  /**
   * For editorial-tone posters, fetch real news photos via Tavily and pass them to the
   * image model as style references (mood/lighting only — not copied into the poster).
   */
  useImageReferences: bool(process.env.USE_IMAGE_REFERENCES, true),
  imageReferenceCount: int(process.env.IMAGE_REFERENCE_COUNT, 2),

  // --- AI providers ---
  openRouterApiKey: optionalString(process.env.OPENROUTER_API_KEY),
  tavilyApiKey: optionalString(process.env.TAVILY_API_KEY),
  chatModel: stringWithDefault(process.env.CHAT_MODEL, 'deepseek/deepseek-v4-flash-0731'),
  /** Per chat completion attempt. Structured briefs with a fat research digest routinely need >60s. */
  chatRequestTimeoutMs: int(process.env.CHAT_REQUEST_TIMEOUT_MS, 120_000),
  chatMaxRetries: int(process.env.CHAT_MAX_RETRIES, 2),
  imageModel: stringWithDefault(process.env.IMAGE_MODEL, 'bytedance-seed/seedream-4.5'),
  imageApiKey: optionalString(process.env.IMAGE_API_KEY),
  imageApiHost: stringWithDefault(process.env.IMAGE_API_HOST, 'https://openrouter.ai/api/v1'),
  imageAspectRatio: pickEnum(process.env.IMAGE_ASPECT_RATIO, aspectRatios, '9:16') as AspectRatio,
  imageResolution: pickEnum(process.env.IMAGE_RESOLUTION, resolutions, '2K') as Resolution,
  imageOutputFormat: pickEnum(
    process.env.IMAGE_OUTPUT_FORMAT,
    outputFormats,
    'jpeg',
  ) as OutputFormat,
  imagePalette: optionalString(process.env.IMAGE_PALETTE),
  imageRequestTimeoutMs: int(process.env.IMAGE_REQUEST_TIMEOUT_MS, 180_000),
  imageOutputDir: stringWithDefault(process.env.IMAGE_OUTPUT_DIR, 'generated-images'),
  outputLanguage: stringWithDefault(process.env.OUTPUT_LANGUAGE, 'pt-BR'),

  // --- Notification webhook ---
  /** Off by default, so an unchanged .env boots exactly as it did before the webhook existed. */
  notifyEnabled: bool(process.env.NOTIFY_ENABLED, false),
  /** Loopback by default: the port is unreachable from the network until you opt in. */
  notifyHost: stringWithDefault(process.env.NOTIFY_HOST, '127.0.0.1'),
  notifyPort: int(process.env.NOTIFY_PORT, 3001),
  notifyApiKey: optionalString(process.env.NOTIFY_API_KEY),
  /** Per file. WhatsApp itself refuses much more than this for images. */
  notifyMaxFileBytes: int(process.env.NOTIFY_MAX_FILE_BYTES, 10 * 1024 * 1024),
  notifyMaxFiles: int(process.env.NOTIFY_MAX_FILES, 4),
  notifyMaxMessageLength: int(process.env.NOTIFY_MAX_MESSAGE_LENGTH, 4_096),
  notifyConcurrency: int(process.env.NOTIFY_CONCURRENCY, 2),
  notifyMaxQueued: int(process.env.NOTIFY_MAX_QUEUED, 50),
  /** Empty means any recipient. Otherwise only these numbers or JIDs are accepted. */
  notifyAllowedRecipients: csv(process.env.NOTIFY_ALLOWED_RECIPIENTS),
  /** Prepended when a caller sends a local number. Empty means callers must include it. */
  notifyDefaultCountryCode: (process.env.NOTIFY_DEFAULT_COUNTRY_CODE ?? '').replace(/\D/g, ''),
  /** How long a finished job stays queryable through GET /notifications/:id. */
  notifyJobTtlMs: int(process.env.NOTIFY_JOB_TTL_MS, 3_600_000),
  /** How long a delivery waits for a reconnecting socket before giving up. */
  notifyReadyTimeoutMs: int(process.env.NOTIFY_READY_TIMEOUT_MS, 30_000),
  /** Whole-job ceiling, so a hung upload cannot hold a worker slot forever. */
  notifyJobTimeoutMs: int(process.env.NOTIFY_JOB_TIMEOUT_MS, 120_000),
} as const

/** Throws when a required AI key is missing. Called lazily so WhatsApp can still pair without keys. */
export function requireAiKeys(): {
  openRouterApiKey: string
  tavilyApiKey: string
} {
  if (!config.openRouterApiKey) {
    throw new Error('Missing required environment variable: OPENROUTER_API_KEY')
  }
  if (!config.tavilyApiKey) {
    throw new Error('Missing required environment variable: TAVILY_API_KEY')
  }
  return {
    openRouterApiKey: config.openRouterApiKey,
    tavilyApiKey: config.tavilyApiKey,
  }
}

/**
 * Throws when the webhook is enabled without a key.
 *
 * Checked at startup rather than per request: an enabled endpoint with an empty key would
 * silently accept anyone and let them send WhatsApp messages as you. Refusing to boot is the
 * only failure mode that cannot be missed.
 */
export function requireNotifyApiKey(): string {
  if (!config.notifyApiKey) {
    throw new Error('NOTIFY_ENABLED=true requires NOTIFY_API_KEY')
  }
  return config.notifyApiKey
}
