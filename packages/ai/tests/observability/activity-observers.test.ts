import { describe, expect, it, vi } from 'vitest'
import {
  generateAudio,
  generateImage,
  generateSpeech,
  generateTranscription,
  generateVideo,
} from '../../src/index'
import { otelObserver } from '../../src/observability/otel'
import { createFakeTracer } from '../middlewares/fake-otel'
import type {
  ActivityErrorEvent,
  ActivityFinishEvent,
  ActivityObserver,
  ActivityStartEvent,
} from '../../src/observability/types'

function recordingObserver() {
  const events = {
    start: [] as Array<ActivityStartEvent>,
    finish: [] as Array<ActivityFinishEvent>,
    error: [] as Array<ActivityErrorEvent>,
  }
  const observer: ActivityObserver = {
    name: 'rec',
    onStart: (e) => {
      events.start.push(e)
    },
    onFinish: (e) => {
      events.finish.push(e)
    },
    onError: (e) => {
      events.error.push(e)
    },
  }
  return { observer, events }
}

describe('activity observers — wiring', () => {
  it('generateImage fires start then finish with usage', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'image' as const,
      name: 'openai',
      model: 'gpt-image-1',
      generateImages: vi.fn(async () => ({
        images: [{ url: 'https://example.com/i.png' }],
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          unitsBilled: 1,
          cost: 0.04,
        },
      })),
    }

    const result = await generateImage({
      adapter: adapter as any,
      prompt: 'a sunset',
      observers: [observer],
    })

    expect(result.images).toHaveLength(1)
    expect(events.start).toHaveLength(1)
    expect(events.start[0]!.activity).toBe('image')
    expect(events.start[0]!.provider).toBe('openai')
    expect(events.finish).toHaveLength(1)
    expect(events.finish[0]!.usage?.cost).toBe(0.04)
    expect(events.error).toHaveLength(0)
    // start/finish share the correlation id
    expect(events.finish[0]!.requestId).toBe(events.start[0]!.requestId)
  })

  it('generateImage fires error and rethrows', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'image' as const,
      name: 'openai',
      model: 'gpt-image-1',
      generateImages: vi.fn(async () => {
        throw new Error('image boom')
      }),
    }

    await expect(
      generateImage({
        adapter: adapter as any,
        prompt: 'x',
        observers: [observer],
        debug: false,
      }),
    ).rejects.toThrow('image boom')

    expect(events.start).toHaveLength(1)
    expect(events.finish).toHaveLength(0)
    expect(events.error).toHaveLength(1)
    expect((events.error[0]!.error as Error).message).toBe('image boom')
  })

  it('generateImage with otelObserver produces a span', async () => {
    const { tracer, spans } = createFakeTracer()
    const adapter = {
      kind: 'image' as const,
      name: 'openai',
      model: 'gpt-image-1',
      generateImages: vi.fn(async () => ({
        images: [{ url: 'https://example.com/i.png' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0.02 },
      })),
    }

    await generateImage({
      adapter: adapter as any,
      prompt: 'a sunset',
      observers: [otelObserver({ tracer })],
    })

    expect(spans).toHaveLength(1)
    expect(spans[0]!.attributes['gen_ai.operation.name']).toBe('image_generation')
    expect(spans[0]!.attributes['gen_ai.usage.cost']).toBe(0.02)
    expect(spans[0]!.ended).toBe(true)
  })

  it('generateSpeech fires start/finish', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'tts' as const,
      name: 'openai',
      model: 'gpt-4o-mini-tts',
      generateSpeech: vi.fn(async () => ({
        audio: 'base64',
        format: 'mp3',
        contentType: 'audio/mpeg',
        usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
      })),
    }

    await generateSpeech({
      adapter: adapter as any,
      text: 'hello',
      observers: [observer],
    })

    expect(events.start[0]!.activity).toBe('speech')
    expect(events.finish[0]!.usage?.promptTokens).toBe(5)
  })

  it('generateTranscription fires start/finish', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'transcription' as const,
      name: 'openai',
      model: 'whisper-1',
      transcribe: vi.fn(async () => ({
        text: 'hello world',
        language: 'en',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationSeconds: 4,
        },
      })),
    }

    await generateTranscription({
      adapter: adapter as any,
      audio: 'base64',
      observers: [observer],
    })

    expect(events.start[0]!.activity).toBe('transcription')
    expect(events.finish[0]!.usage?.durationSeconds).toBe(4)
  })

  it('generateAudio fires start/finish', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'audio' as const,
      name: 'fal',
      model: 'fal-ai/diffrhythm',
      generateAudio: vi.fn(async () => ({
        audio: { url: 'https://example.com/a.mp3', contentType: 'audio/mpeg' },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, unitsBilled: 1 },
      })),
    }

    await generateAudio({
      adapter: adapter as any,
      prompt: 'an upbeat track',
      observers: [observer],
    })

    expect(events.start[0]!.activity).toBe('audio')
    expect(events.finish[0]!.usage?.unitsBilled).toBe(1)
  })

  it('generateVideo (non-streaming) fires start/finish for the submit', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'video' as const,
      name: 'openai',
      model: 'sora-2',
      createVideoJob: vi.fn(async () => ({ jobId: 'job-1', model: 'sora-2' })),
      getVideoStatus: vi.fn(),
      getVideoUrl: vi.fn(),
    }

    const job = await generateVideo({
      adapter: adapter as any,
      prompt: 'a cat',
      observers: [observer],
    })

    expect(job.jobId).toBe('job-1')
    expect(events.start[0]!.activity).toBe('video')
    expect(events.finish).toHaveLength(1)
    expect(events.finish[0]!.usage).toBeUndefined()
  })

  it('generateVideo (streaming) fires finish with usage at completion', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'video' as const,
      name: 'openai',
      model: 'sora-2',
      createVideoJob: vi.fn(async () => ({ jobId: 'job-1', model: 'sora-2' })),
      getVideoStatus: vi.fn(async () => ({ status: 'completed' as const })),
      getVideoUrl: vi.fn(async () => ({
        url: 'https://example.com/v.mp4',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, unitsBilled: 1 },
      })),
    }

    const stream = generateVideo({
      adapter: adapter as any,
      prompt: 'a cat',
      stream: true,
      pollingInterval: 1,
      observers: [observer],
    })
    for await (const _chunk of stream) {
      // drain
    }

    expect(events.start[0]!.activity).toBe('video')
    expect(events.finish).toHaveLength(1)
    expect(events.finish[0]!.usage?.unitsBilled).toBe(1)
    expect(events.error).toHaveLength(0)
  })

  it('generateVideo (streaming) fires error when the job fails', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'video' as const,
      name: 'openai',
      model: 'sora-2',
      createVideoJob: vi.fn(async () => ({ jobId: 'job-1', model: 'sora-2' })),
      getVideoStatus: vi.fn(async () => ({
        status: 'failed' as const,
        error: 'generation failed',
      })),
      getVideoUrl: vi.fn(),
    }

    const stream = generateVideo({
      adapter: adapter as any,
      prompt: 'a cat',
      stream: true,
      pollingInterval: 1,
      observers: [observer],
      debug: false,
    })
    for await (const _chunk of stream) {
      // drain — error surfaces as a RUN_ERROR chunk, not a throw
    }

    expect(events.finish).toHaveLength(0)
    expect(events.error).toHaveLength(1)
    expect(events.error[0]!.activity).toBe('video')
  })

  it('generateVideo (streaming) fires a terminal error if the consumer abandons mid-poll', async () => {
    const { observer, events } = recordingObserver()
    const adapter = {
      kind: 'video' as const,
      name: 'openai',
      model: 'sora-2',
      createVideoJob: vi.fn(async () => ({ jobId: 'job-1', model: 'sora-2' })),
      // Never completes, so the poll loop keeps running until we abandon it.
      getVideoStatus: vi.fn(async () => ({ status: 'in_progress' as const })),
      getVideoUrl: vi.fn(),
    }

    const stream = generateVideo({
      adapter: adapter as any,
      prompt: 'a cat',
      stream: true,
      pollingInterval: 1,
      observers: [observer],
      debug: false,
    })
    for await (const chunk of stream) {
      // Abandon once the job is created — onStart has fired and the span is open.
      if ((chunk as { name?: string }).name === 'video:job:created') break
    }

    expect(events.start).toHaveLength(1)
    expect(events.finish).toHaveLength(0)
    // The `finally` cleanup fires a cancellation error so the span is ended.
    expect(events.error).toHaveLength(1)
  })

  it('a throwing observer never breaks the activity', async () => {
    const adapter = {
      kind: 'image' as const,
      name: 'openai',
      model: 'gpt-image-1',
      generateImages: vi.fn(async () => ({
        images: [{ url: 'https://example.com/i.png' }],
      })),
    }
    const brokenObserver: ActivityObserver = {
      name: 'broken',
      onStart: () => {
        throw new Error('observer broke')
      },
    }

    const result = await generateImage({
      adapter: adapter as any,
      prompt: 'x',
      observers: [brokenObserver],
      debug: false,
    })

    expect(result.images).toHaveLength(1)
  })
})
