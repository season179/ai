import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { errorMessage, errorTypeName } from '../utilities/errors'
import { usageAttributes } from './usage-attributes'
import type {
  AttributeValue,
  Exception,
  Meter,
  Span,
  Tracer,
} from '@opentelemetry/api'
import type { ActivityKind, ActivityObserver, ActivityStartEvent } from './types'

/**
 * `gen_ai.operation.name` per activity. Chat uses the GenAI semconv value;
 * media operations have no semconv entry yet, so these are the de-facto names
 * consumed by GenAI backends (PostHog, Langfuse, …). Documented in
 * `docs/advanced/otel.md`.
 */
const OPERATION_NAME: Record<ActivityKind, string> = {
  chat: 'chat',
  image: 'image_generation',
  video: 'video_generation',
  audio: 'audio_generation',
  speech: 'text_to_speech',
  transcription: 'transcription',
}

export interface OtelObserverOptions {
  /** OTel `Tracer` used to start one span per activity call. */
  tracer: Tracer
  /**
   * Optional OTel `Meter`. When provided, the observer records the
   * `gen_ai.client.operation.duration` histogram (seconds) — the same metric
   * the chat `otelMiddleware` emits. Omit to disable metrics.
   */
  meter?: Meter
  /** Override the default span name (`"<operation> <model>"`). */
  spanNameFormatter?: (event: ActivityStartEvent) => string
  /** Add extra attributes to the span at start. */
  attributeEnricher?: (
    event: ActivityStartEvent,
  ) => Record<string, AttributeValue>
}

function safeCall<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn()
  } catch (err) {
    // Keep the observer non-fatal but surface broken extension callbacks, so a
    // throwing spanNameFormatter/attributeEnricher never loses the whole span.
    console.warn(`[otelObserver] ${label} failed`, err)
    return undefined
  }
}

/**
 * An {@link ActivityObserver} that emits one OpenTelemetry span per activity
 * call, tagged with the right `gen_ai.operation.name` for the activity
 * (`image_generation`, `text_to_speech`, …). Register it on any media activity
 * via its `observers` option.
 *
 * Reuses the same `gen_ai.usage.*` attribute set as the chat `otelMiddleware`,
 * so cost, totals, cache/reasoning details, duration billing, and media unit
 * counts land identically across activities.
 *
 * @example
 * ```ts
 * import { generateImage } from '@tanstack/ai'
 * import { otelObserver } from '@tanstack/ai/observability'
 * import { openaiImage } from '@tanstack/ai-openai'
 * import { trace, metrics } from '@opentelemetry/api'
 *
 * const observer = otelObserver({
 *   tracer: trace.getTracer('my-app'),
 *   meter: metrics.getMeter('my-app'),
 * })
 *
 * await generateImage({
 *   adapter: openaiImage('gpt-image-1'),
 *   prompt: 'A serene mountain landscape at sunset',
 *   observers: [observer],
 * })
 * ```
 */
export function otelObserver(options: OtelObserverOptions): ActivityObserver {
  const { tracer, meter, spanNameFormatter, attributeEnricher } = options

  const durationHistogram = meter?.createHistogram(
    'gen_ai.client.operation.duration',
    {
      description: 'GenAI client operation duration',
      unit: 's',
    },
  )

  // Spans live only for the duration of a single activity call; keyed by the
  // event's requestId so concurrent calls don't collide.
  const spans = new Map<string, Span>()

  const recordDuration = (
    activity: ActivityKind,
    provider: string,
    model: string,
    durationMs: number,
    errorType?: string,
  ): void => {
    if (!durationHistogram) return
    durationHistogram.record(durationMs / 1000, {
      'gen_ai.system': provider,
      'gen_ai.operation.name': OPERATION_NAME[activity],
      'gen_ai.request.model': model,
      ...(errorType ? { 'error.type': errorType } : {}),
    })
  }

  return {
    name: 'otel',

    onStart(event) {
      const operationName = OPERATION_NAME[event.activity]
      const name =
        safeCall('spanNameFormatter', () => spanNameFormatter?.(event)) ??
        `${operationName} ${event.model}`
      const span = tracer.startSpan(name, {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.system': event.provider,
          'gen_ai.operation.name': operationName,
          'gen_ai.request.model': event.model,
        },
      })
      const enriched = safeCall('attributeEnricher', () =>
        attributeEnricher?.(event),
      )
      if (enriched) span.setAttributes(enriched)
      spans.set(event.requestId, span)
    },

    onFinish(event) {
      const span = spans.get(event.requestId)
      spans.delete(event.requestId)
      if (span) {
        if (event.usage) span.setAttributes(usageAttributes(event.usage))
        span.end()
      }
      recordDuration(
        event.activity,
        event.provider,
        event.model,
        event.durationMs,
      )
    },

    onError(event) {
      const span = spans.get(event.requestId)
      spans.delete(event.requestId)
      if (span) {
        span.recordException(event.error as Exception)
        const message = errorMessage(event.error)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          ...(message !== undefined ? { message } : {}),
        })
        span.end()
      }
      recordDuration(
        event.activity,
        event.provider,
        event.model,
        event.durationMs,
        errorTypeName(event.error),
      )
    },
  }
}
