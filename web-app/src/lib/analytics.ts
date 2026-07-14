import posthog from 'posthog-js'
import type { Properties } from 'posthog-js'

export type BiyanAnalyticsEventName =
  | 'app_launched'
  | 'app_backgrounded'
  | 'screen_viewed'
  | 'analytics_consent_updated'
  | 'chat_created'
  | 'chat_selected'
  | 'message_sent'
  | 'assistant_response_started'
  | 'assistant_response_completed'
  | 'assistant_step_completed'
  | 'assistant_response_failed'
  | 'generation_cancelled'
  | 'message_regenerated'
  | 'message_edited'
  | 'provider_added'
  | 'provider_imported'
  | 'provider_connected'
  | 'models_refreshed'
  | 'model_selected'
  | 'api_mode_changed'
  | 'web_search_toggled'
  | 'web_search_decision_recorded'
  | 'web_search_completed'
  | 'attachment_added'
  | 'attachment_processing_failed'
  | 'context_compacted'
  | 'auto_run_started'
  | 'auto_run_completed'
  | 'mcp_server_added'
  | 'mcp_server_started'
  | 'mcp_tool_invoked'
  | 'mcp_routing_completed'
  | 'image_generation_started'
  | 'image_generation_completed'
  | 'image_generation_failed'
  | 'image_asset_saved'
  | 'stream_latency_recorded'
  | 'token_usage_recorded'
  | 'quota_error_shown'
  | 'network_error_shown'
  | 'rage_click_detected'

export type BiyanAnalyticsProperties = Record<string, unknown>

type PostHogWithSessionRecording = typeof posthog & {
  get_session_id?: () => string
  startSessionRecording?: () => void
  stopSessionRecording?: () => void
}

const SENSITIVE_KEY_RE =
  /(?:prompt|content|api_?key|apikey|token|secret|password|credential|file_?name|filename|base64|b64|data_?url|image_?data|document_?content|transcript|raw|body|request|response|url|host|path|text)$/i

const SAFE_KEY_EXCEPTIONS = new Set([
  'app_version',
  'attachment_count',
  'build_channel',
  'build_number',
  'connected_server_count',
  'document_count',
  'duration_ms',
  'enabled',
  'error_kind',
  'fallback_reason',
  'finish_reason',
  'has_attachments',
  'has_documents',
  'has_tools',
  'image_count',
  'input_tokens',
  'locale',
  'llm_accepted',
  'llm_invoked',
  'message_count',
  'message_length_bucket',
  'model_capabilities',
  'model_id',
  'output_tokens',
  'platform',
  'provider_id',
  'route',
  'screen',
  'selected_server_count',
  'session_id',
  'source',
  'source_count',
  'status',
  'theme',
  'tool_count',
  'tool_kind',
  'tool_name',
  'tools_enabled',
  'total_latency_ms',
  'total_tokens',
  'blocked_reason',
  'role_id',
  'transport',
  'web_search_depth',
  'web_search_enabled',
  'web_search_intent',
  'web_search_mode',
  'web_search_reason',
  'web_search_transport',
])

function configuredPostHog() {
  return posthog as PostHogWithSessionRecording
}

function hasPostHogEnv() {
  return (
    typeof POSTHOG_KEY !== 'undefined' &&
    typeof POSTHOG_HOST !== 'undefined' &&
    Boolean(POSTHOG_KEY) &&
    Boolean(POSTHOG_HOST)
  )
}

function normalizeKey(key: string) {
  return key.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
}

function isSensitiveKey(key: string) {
  const normalized = normalizeKey(key)
  if (SAFE_KEY_EXCEPTIONS.has(normalized)) return false
  return SENSITIVE_KEY_RE.test(normalized)
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 160)
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
      )
      .slice(0, 20)
      .map((item) => (typeof item === 'string' ? item.slice(0, 80) : item))
  }
  return undefined
}

export function sanitizeAnalyticsProperties(
  properties: BiyanAnalyticsProperties | Properties = {}
): Properties {
  const sanitized: Properties = {}

  for (const [key, value] of Object.entries(properties)) {
    if (isSensitiveKey(key)) continue
    const sanitizedValue = sanitizeValue(value)
    if (sanitizedValue !== undefined) {
      sanitized[normalizeKey(key)] = sanitizedValue as Properties[string]
    }
  }

  return sanitized
}

function currentTheme() {
  if (typeof document === 'undefined') return 'unknown'
  if (document.documentElement.classList.contains('dark')) return 'dark'
  if (document.documentElement.classList.contains('light')) return 'light'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return 'system'
}

export function getBiyanAnalyticsContext(
  properties: BiyanAnalyticsProperties = {}
): Properties {
  const sessionId = configuredPostHog().get_session_id?.()
  const pathname =
    typeof window === 'undefined' ? undefined : window.location.pathname

  return sanitizeAnalyticsProperties({
    platform: 'desktop',
    app_version: typeof VERSION !== 'undefined' ? VERSION : 'unknown',
    build_channel: typeof IS_DEV !== 'undefined' && IS_DEV ? 'dev' : 'production',
    locale:
      typeof navigator === 'undefined'
        ? undefined
        : navigator.language || navigator.languages?.[0],
    theme: currentTheme(),
    route: pathname,
    session_id: sessionId,
    ...properties,
  })
}

export function registerBiyanAnalyticsSuperProperties(
  properties: BiyanAnalyticsProperties = {}
) {
  if (!hasPostHogEnv()) return
  posthog.register(getBiyanAnalyticsContext(properties))
}

export function trackBiyanEvent(
  eventName: BiyanAnalyticsEventName,
  properties: BiyanAnalyticsProperties = {}
) {
  if (!hasPostHogEnv()) return

  try {
    posthog.capture(eventName, getBiyanAnalyticsContext(properties))
  } catch (error) {
    console.warn('[analytics] Failed to capture event', eventName, error)
  }
}

export function setBiyanAnalyticsConsent(enabled: boolean) {
  if (!hasPostHogEnv()) return

  if (enabled) {
    posthog.opt_in_capturing()
    registerBiyanAnalyticsSuperProperties()
    trackBiyanEvent('analytics_consent_updated', { enabled: true })
    return
  }

  trackBiyanEvent('analytics_consent_updated', { enabled: false })
  configuredPostHog().stopSessionRecording?.()
  posthog.opt_out_capturing()
}

export function startBiyanSessionReplay() {
  if (!hasPostHogEnv()) return
  configuredPostHog().startSessionRecording?.()
}
