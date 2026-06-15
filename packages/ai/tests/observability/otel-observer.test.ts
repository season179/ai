import { describe, expect, it } from 'vitest'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { otelObserver } from '../../src/observability/otel'
import { usageAttributes } from '../../src/observability/usage-attributes'
import { createFakeMeter, createFakeTracer } from '../middlewares/fake-otel'
import type {
  ActivityKind,
  ActivityStartEvent,
} from '../../src/observability/types'
import type { TokenUsage } from '../../src/types'

function startEvent(
  overrides: Partial<ActivityStartEvent> = {},
): ActivityStartEvent {
  return {
    activity: 'image',
    requestId: 'req-1',
    provider: 'openai',
    model: 'gpt-image-1',
    ...overrides,
  } as ActivityStartEvent
}

describe('otelObserver', () => {
  it('opens a CLIENT span with gen_ai attributes on start', () => {
    const { tracer, spans } = createFakeTracer()
    const observer = otelObserver({ tracer })

    observer.onStart?.(startEvent())

    expect(spans).toHaveLength(1)
    const span = spans[0]!
    expect(span.kind).toBe(SpanKind.CLIENT)
    expect(span.name).toBe('image_generation gpt-image-1')
    expect(span.attributes['gen_ai.system']).toBe('openai')
    expect(span.attributes['gen_ai.operation.name']).toBe('image_generation')
    expect(span.attributes['gen_ai.request.model']).toBe('gpt-image-1')
    expect(span.ended).toBe(false)
  })

  it('maps each activity to the right gen_ai.operation.name', () => {
    const cases: Array<[ActivityKind, string]> = [
      ['image', 'image_generation'],
      ['video', 'video_generation'],
      ['audio', 'audio_generation'],
      ['speech', 'text_to_speech'],
      ['transcription', 'transcription'],
      ['chat', 'chat'],
    ]
    for (const [activity, operation] of cases) {
      const { tracer, spans } = createFakeTracer()
      const observer = otelObserver({ tracer })
      observer.onStart?.(
        startEvent({ activity, requestId: activity } as Partial<ActivityStartEvent>),
      )
      expect(spans[0]!.attributes['gen_ai.operation.name']).toBe(operation)
    }
  })

  it('attaches usage attributes and ends the span on finish', () => {
    const { tracer, spans } = createFakeTracer()
    const { meter, records } = createFakeMeter()
    const observer = otelObserver({ tracer, meter })

    observer.onStart?.(startEvent())
    observer.onFinish?.({
      activity: 'image',
      requestId: 'req-1',
      provider: 'openai',
      model: 'gpt-image-1',
      durationMs: 1500,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        unitsBilled: 1,
        cost: 0.04,
      },
    })

    const span = spans[0]!
    expect(span.ended).toBe(true)
    expect(span.attributes['gen_ai.usage.cost']).toBe(0.04)
    expect(span.attributes['tanstack.ai.usage.units_billed']).toBe(1)

    expect(records).toHaveLength(1)
    expect(records[0]!.name).toBe('gen_ai.client.operation.duration')
    expect(records[0]!.value).toBe(1.5)
    expect(records[0]!.attributes?.['gen_ai.operation.name']).toBe(
      'image_generation',
    )
  })

  it('finishes cleanly when no usage is reported', () => {
    const { tracer, spans } = createFakeTracer()
    const observer = otelObserver({ tracer })

    observer.onStart?.(startEvent({ activity: 'video' }))
    observer.onFinish?.({
      activity: 'video',
      requestId: 'req-1',
      provider: 'openai',
      model: 'gpt-image-1',
      durationMs: 10,
    })

    expect(spans[0]!.ended).toBe(true)
    expect(spans[0]!.attributes['gen_ai.usage.cost']).toBeUndefined()
  })

  it('records the exception and ERROR status on error', () => {
    const { tracer, spans } = createFakeTracer()
    const { meter, records } = createFakeMeter()
    const observer = otelObserver({ tracer, meter })

    observer.onStart?.(startEvent())
    const error = new TypeError('boom')
    observer.onError?.({
      activity: 'image',
      requestId: 'req-1',
      provider: 'openai',
      model: 'gpt-image-1',
      durationMs: 200,
      error,
    })

    const span = spans[0]!
    expect(span.ended).toBe(true)
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.status.message).toBe('boom')
    expect(span.exceptions[0]!.exception).toBe(error)
    expect(records[0]!.attributes?.['error.type']).toBe('TypeError')
  })

  it('keys spans by requestId so concurrent calls do not collide', () => {
    const { tracer, spans } = createFakeTracer()
    const observer = otelObserver({ tracer })

    observer.onStart?.(startEvent({ requestId: 'a', model: 'model-a' }))
    observer.onStart?.(startEvent({ requestId: 'b', model: 'model-b' }))
    // Finish the second one first — should end the model-b span, not model-a.
    observer.onFinish?.({
      activity: 'image',
      requestId: 'b',
      provider: 'openai',
      model: 'model-b',
      durationMs: 5,
    })

    const spanA = spans.find((s) => s.attributes['gen_ai.request.model'] === 'model-a')!
    const spanB = spans.find((s) => s.attributes['gen_ai.request.model'] === 'model-b')!
    expect(spanB.ended).toBe(true)
    expect(spanA.ended).toBe(false)
  })

  it('applies spanNameFormatter and attributeEnricher', () => {
    const { tracer, spans } = createFakeTracer()
    const observer = otelObserver({
      tracer,
      spanNameFormatter: (e) => `custom:${e.activity}`,
      attributeEnricher: () => ({ 'app.tenant': 'acme' }),
    })

    observer.onStart?.(startEvent())
    expect(spans[0]!.name).toBe('custom:image')
    expect(spans[0]!.attributes['app.tenant']).toBe('acme')
  })

  it('keeps the span when a formatter throws', () => {
    const { tracer, spans } = createFakeTracer()
    const observer = otelObserver({
      tracer,
      spanNameFormatter: () => {
        throw new Error('formatter broke')
      },
    })

    observer.onStart?.(startEvent())
    // Falls back to the default name instead of losing the span.
    expect(spans).toHaveLength(1)
    expect(spans[0]!.name).toBe('image_generation gpt-image-1')
  })
})

describe('usageAttributes', () => {
  it('emits guarded media + cost fields, omitting absent ones', () => {
    const usage: TokenUsage = {
      promptTokens: 10,
      completionTokens: 0,
      totalTokens: 10,
      durationSeconds: 12.5,
      unitsBilled: 3,
    }
    const attrs = usageAttributes(usage)

    expect(attrs['gen_ai.usage.input_tokens']).toBe(10)
    expect(attrs['tanstack.ai.usage.duration_seconds']).toBe(12.5)
    expect(attrs['tanstack.ai.usage.units_billed']).toBe(3)
    // No cost reported → key absent.
    expect('gen_ai.usage.cost' in attrs).toBe(false)
  })
})
