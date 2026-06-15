import type { TokenUsage } from '../types'

/**
 * The kind of activity an {@link ActivityObserver} event describes.
 *
 * `chat` is included so the same observer contract can cover chat in the
 * future; today the activity functions that fire observer events are the media
 * activities (`image`, `video`, `audio`, `speech`, `transcription`). Chat
 * observability is served by `otelMiddleware`.
 */
export type ActivityKind =
  | 'chat'
  | 'image'
  | 'video'
  | 'audio'
  | 'speech'
  | 'transcription'

/** Fields present on every activity observer event. */
export interface ActivityEventBase {
  /**
   * Stable id correlating the `onStart` / `onFinish` / `onError` events of a
   * single activity call.
   */
  requestId: string
  /** Adapter/provider name (e.g. `"openai"`). Emitted as `gen_ai.system`. */
  provider: string
  /** Model id. Emitted as `gen_ai.request.model`. */
  model: string
  /** Provider-specific options passed to the activity, if any. */
  modelOptions?: unknown
}

/**
 * Fired before the adapter request begins. Carries the common identity fields
 * plus the `activity` discriminator; `otelObserver` uses it to open a span.
 *
 * Request inputs (prompt, size, voice, …) are intentionally not duplicated onto
 * this event — they are already published on the `aiEventClient`
 * `*:request:started` events for anyone who needs them.
 */
export interface ActivityStartEvent extends ActivityEventBase {
  activity: ActivityKind
}

/** Fired after the activity completes successfully. */
export interface ActivityFinishEvent extends ActivityEventBase {
  activity: ActivityKind
  /** Wall-clock duration of the activity call, in milliseconds. */
  durationMs: number
  /** Unified usage, when the provider reported it. */
  usage?: TokenUsage
}

/** Fired when the activity throws before completing. */
export interface ActivityErrorEvent extends ActivityEventBase {
  activity: ActivityKind
  /** Wall-clock duration until the failure, in milliseconds. */
  durationMs: number
  /** The thrown value (typically an `Error`). */
  error: unknown
}

/**
 * Activity-agnostic observability hook.
 *
 * A thin lifecycle observer registerable on any activity via its `observers`
 * option. Unlike the chat middleware pipeline (which can rewrite config,
 * chunks, and tool calls), an observer is read-only and single request →
 * response shaped — the right fit for media activities. Ship `otelObserver()`
 * for OpenTelemetry, or implement the three hooks directly for custom backends.
 *
 * Hooks are awaited in registration order and are non-fatal: a hook that throws
 * is logged and skipped, never breaking the activity. Keep them cheap — they
 * run inline with the request.
 */
export interface ActivityObserver {
  /** Optional name, surfaced in diagnostics when a hook throws. */
  name?: string
  /** Called before the adapter request begins. */
  onStart?: (event: ActivityStartEvent) => void | Promise<void>
  /** Called after the activity completes successfully. */
  onFinish?: (event: ActivityFinishEvent) => void | Promise<void>
  /** Called when the activity throws before completing. */
  onError?: (event: ActivityErrorEvent) => void | Promise<void>
}
