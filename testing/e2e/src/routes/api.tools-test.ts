import { createFileRoute } from '@tanstack/react-router'
import {
  EventType,
  chat,
  chatParamsFromRequestBody,
  maxIterations,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import type { AnyTextAdapter, StreamChunk } from '@tanstack/ai'
import type { TestRuntimeContext } from '@/lib/tools-test-tools'
import { createTextAdapter } from '@/lib/providers'
import { getToolsForScenario } from '@/lib/tools-test-tools'

const runtimeContextScenarios = new Set([
  'server-context',
  'client-context',
  'client-server-context',
])

function createRuntimeContextAdapter(scenario: string): AnyTextAdapter {
  return {
    kind: 'text',
    name: 'runtime-context-test',
    model: 'runtime-context-test',
    '~types': {
      providerOptions: {},
      inputModalities: ['text'],
      messageMetadataByModality: {},
      toolCapabilities: [],
      toolCallMetadata: undefined,
      systemPromptMetadata: undefined,
    },
    async *chatStream(options): AsyncGenerator<StreamChunk> {
      const model = 'runtime-context-test'
      const runId = options.runId ?? 'runtime-context-run'
      const threadId = options.threadId ?? 'runtime-context-thread'
      const messageId = `${runId}-message`
      const hasToolResult = options.messages.some(
        (message) => message.role === 'tool',
      )

      yield {
        type: EventType.RUN_STARTED,
        runId,
        threadId,
        model,
        timestamp: Date.now(),
      }

      if (!hasToolResult) {
        const toolName =
          scenario === 'client-context'
            ? 'read_client_context'
            : 'read_server_context'
        const toolCallId = `${scenario}-tool-call`

        yield {
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: 'Reading runtime context.',
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: toolName,
          toolName,
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '{}',
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TOOL_CALL_END,
          toolCallId,
          toolCallName: toolName,
          toolName,
          input: {},
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          model,
          finishReason: 'tool_calls',
          timestamp: Date.now(),
        }
        return
      }

      yield {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: 'Runtime context was read.',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.RUN_FINISHED,
        runId,
        threadId,
        model,
        finishReason: 'stop',
        timestamp: Date.now(),
      }
    },
    structuredOutput: async () => ({ data: {}, rawText: '{}' }),
  }
}

/**
 * Regression adapter for issue #1017.
 *
 * Emits a TEXT_MESSAGE_CONTENT delta between two TOOL_CALL_ARGS deltas, as
 * providers are allowed to do. Pre-fix, the interleaved text force-completed
 * the tool call with a lenient partial-JSON parse of the truncated arguments
 * (`{"city":"New Yo"}`) and the authoritative TOOL_CALL_END was skipped,
 * leaving the client-rendered tool-call part's `input` silently corrupted.
 */
function createInterleavedArgsAdapter(): AnyTextAdapter {
  return {
    kind: 'text',
    name: 'interleaved-args-test',
    model: 'interleaved-args-test',
    '~types': {
      providerOptions: {},
      inputModalities: ['text'],
      messageMetadataByModality: {},
      toolCapabilities: [],
      toolCallMetadata: undefined,
      systemPromptMetadata: undefined,
    },
    async *chatStream(options): AsyncGenerator<StreamChunk> {
      const model = 'interleaved-args-test'
      const runId = options.runId ?? 'interleaved-args-run'
      const threadId = options.threadId ?? 'interleaved-args-thread'
      const messageId = `${runId}-message`
      const toolCallId = 'interleaved-args-tool-call'
      const hasToolResult = options.messages.some(
        (message) => message.role === 'tool',
      )

      yield {
        type: EventType.RUN_STARTED,
        runId,
        threadId,
        model,
        timestamp: Date.now(),
      }

      // Second iteration: the tool ran, answer with text and finish.
      if (hasToolResult) {
        yield {
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: 'It is 72F in New York City.',
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          model,
          timestamp: Date.now(),
        }
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          model,
          finishReason: 'stop',
          timestamp: Date.now(),
        }
        return
      }

      // First iteration: tool-call args split in two, with a text delta
      // interleaved between them.
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: 'get_weather',
        toolName: 'get_weather',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: '{"city":"New Yo',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: 'Let me check the weather. ',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: 'rk City"}',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId,
        toolCallName: 'get_weather',
        toolName: 'get_weather',
        model,
        timestamp: Date.now(),
      }
      yield {
        type: EventType.RUN_FINISHED,
        runId,
        threadId,
        model,
        finishReason: 'tool_calls',
        timestamp: Date.now(),
      }
    },
    structuredOutput: async () => ({ data: {}, rawText: '{}' }),
  }
}

export const Route = createFileRoute('/api/tools-test')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestSignal = request.signal

        if (requestSignal?.aborted) {
          return new Response(null, { status: 499 })
        }

        const abortController = new AbortController()

        let params
        try {
          params = await chatParamsFromRequestBody(await request.json())
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : 'Bad request',
            { status: 400 },
          )
        }

        const fp = params.forwardedProps
        const scenario =
          typeof fp.scenario === 'string' ? fp.scenario : 'text-only'
        const testId: string | undefined =
          typeof fp.testId === 'string' ? fp.testId : undefined
        const aimockPort: number | undefined =
          fp.aimockPort != null ? Number(fp.aimockPort) : undefined

        try {
          // Special error scenario: return a stream that immediately errors
          if (scenario === 'error') {
            const errorStream =
              (async function* (): AsyncGenerator<StreamChunk> {
                yield {
                  type: EventType.RUN_STARTED,
                  runId: 'error-test',
                  threadId: 'error-test',
                  timestamp: Date.now(),
                }
                yield {
                  type: EventType.RUN_ERROR,
                  message: 'Test error: Something went wrong during generation',
                  timestamp: Date.now(),
                  code: 'provider_error',
                  // Mirrors a provider's structured error body forwarded by the
                  // adapters as `rawEvent`. Asserts it survives SSE transport,
                  // the strip-to-spec middleware, and reaches the consumer.
                  rawEvent: {
                    provider_name: 'test-provider',
                    raw: { reason: 'upstream overloaded' },
                  },
                }
              })()
            return toServerSentEventsResponse(errorStream, { abortController })
          }

          const adapterOptions = runtimeContextScenarios.has(scenario)
            ? { adapter: createRuntimeContextAdapter(scenario) }
            : scenario === 'interleaved-args'
              ? { adapter: createInterleavedArgsAdapter() }
              : createTextAdapter('openai', undefined, aimockPort, testId)

          const tools = getToolsForScenario(scenario)
          const runtimeContext: TestRuntimeContext =
            scenario === 'client-server-context' &&
            typeof fp.runtimeUserId === 'string'
              ? {
                  userId: fp.runtimeUserId,
                  tenantId: 'server-tenant-context',
                  source: 'forwarded-props',
                }
              : {
                  userId: 'server-user-context',
                  tenantId: 'server-tenant-context',
                  source: 'server-route',
                }

          const stream = chat({
            ...adapterOptions,
            messages: params.messages,
            tools,
            context: runtimeContext,
            threadId: params.threadId,
            runId: params.runId,
            agentLoopStrategy: maxIterations(20),
            abortController,
          })

          return toServerSentEventsResponse(stream, { abortController })
        } catch (error) {
          console.error('[Tools Test API] Error:', error)
          if (
            (error instanceof Error && error.name === 'AbortError') ||
            abortController.signal.aborted
          ) {
            return new Response(null, { status: 499 })
          }
          const message =
            error instanceof Error ? error.message : 'An error occurred'
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      },
    },
  },
})
