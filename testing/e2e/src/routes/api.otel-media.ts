import { createFileRoute } from '@tanstack/react-router'
import { generateImage } from '@tanstack/ai'
import { otelObserver } from '@tanstack/ai/observability'
import { createImageAdapter } from '@/lib/media-providers'
import type { Provider } from '@/lib/types'
import type {
  AttributeValue,
  Context,
  Span,
  SpanContext,
  SpanStatus,
  Tracer,
} from '@opentelemetry/api'

interface CapturedSpan {
  name: string
  kind?: number
  attributes: Record<string, AttributeValue>
  status: SpanStatus
  ended: boolean
}

/**
 * Single-request in-memory tracer (mirrors `api.otel-usage.ts`). Everything
 * happens inside one POST, so spans collect into a local array returned in the
 * response body.
 */
function createLocalCaptureTracer(): {
  tracer: Tracer
  spans: Array<CapturedSpan>
} {
  const spans: Array<CapturedSpan> = []
  let spanSeq = 0
  const tracer: Tracer = {
    startSpan(name, options = {}, _ctx?: Context): Span {
      const id = `span-${spanSeq++}`
      const attributes: Record<string, AttributeValue> = {}
      for (const [k, v] of Object.entries(options.attributes ?? {})) {
        if (v !== undefined) attributes[k] = v as AttributeValue
      }
      const captured: CapturedSpan = {
        name,
        kind: options.kind,
        attributes,
        status: { code: 0 },
        ended: false,
      }
      spans.push(captured)
      const span: Span = {
        spanContext(): SpanContext {
          return { traceId: 'otel-media-trace', spanId: id, traceFlags: 1 }
        },
        setAttribute(key, value) {
          captured.attributes[key] = value as AttributeValue
          return span
        },
        setAttributes(next) {
          for (const [k, v] of Object.entries(next)) {
            captured.attributes[k] = v as AttributeValue
          }
          return span
        },
        addEvent() {
          return span
        },
        addLink() {
          return span
        },
        addLinks() {
          return span
        },
        setStatus(status) {
          captured.status = status
          return span
        },
        updateName(next) {
          captured.name = next
          return span
        },
        end() {
          captured.ended = true
        },
        isRecording() {
          return !captured.ended
        },
        recordException() {},
      }
      return span
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startActiveSpan(...args: Array<any>) {
      const fn = args[args.length - 1] as (span: Span) => unknown
      const name = args[0] as string
      const span = tracer.startSpan(name, {})
      try {
        return fn(span)
      } finally {
        span.end()
      }
    },
  }
  return { tracer, spans }
}

/**
 * Drives `generateImage` with an `otelObserver` against the same aimock mount
 * the image-gen feature tests use, and returns the captured spans. End-to-end
 * proof for #720: the activity-agnostic observer emits a `gen_ai.*` span tagged
 * `image_generation` for a non-chat activity, through the public
 * `@tanstack/ai/observability` subpath.
 */
export const Route = createFileRoute('/api/otel-media')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await import('@/lib/llmock-server').then((m) => m.ensureLLMock())
        const body = await request.json()
        const data = body.forwardedProps ?? body.data ?? body
        const { prompt, provider, testId, aimockPort } = data as {
          prompt: string
          provider: Provider
          testId?: string
          aimockPort?: number
        }

        const adapter = createImageAdapter(provider, aimockPort, testId)
        const { tracer, spans } = createLocalCaptureTracer()

        try {
          await generateImage({
            adapter,
            prompt,
            observers: [otelObserver({ tracer })],
          })
        } catch (error) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }

        return new Response(JSON.stringify({ ok: true, spans }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
