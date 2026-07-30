import { expect, test } from '../fixtures'
import {
  getMessages,
  runTest,
  selectScenario,
  waitForTestComplete,
} from './helpers'

/**
 * Regression tests for issue #1017.
 *
 * The `interleaved-args` scenario streams a TEXT_MESSAGE_CONTENT delta between
 * two TOOL_CALL_ARGS deltas (`{"city":"New Yo` + `rk City"}`). Pre-fix, the
 * interleaved text force-completed the tool call: its `input` was populated
 * from a lenient partial-JSON parse of the truncated arguments
 * (`{"city":"New Yo"}`), and the authoritative TOOL_CALL_END was skipped
 * because the call was already `input-complete` — permanently corrupting
 * `input` while `arguments` held the full JSON.
 */
test.describe('Interleaved Text/Args (tools-test page)', () => {
  test('tool-call input matches the full arguments despite interleaved text', async ({
    page,
    testId,
    aimockPort,
  }) => {
    await selectScenario(page, 'interleaved-args', testId, aimockPort)
    await runTest(page)
    await waitForTestComplete(page)

    const messages = await getMessages(page)
    const toolCallParts = messages
      .flatMap((msg) => msg.parts || [])
      .filter((part) => part.type === 'tool-call')

    expect(toolCallParts).toHaveLength(1)
    const part = toolCallParts[0]
    expect(part.name).toBe('get_weather')
    expect(part.state).toBe('input-complete')
    expect(part.arguments).toBe('{"city":"New York City"}')
    // The corrupted pre-fix value was {"city":"New Yo"}.
    expect(part.input).toEqual({ city: 'New York City' })
  })
})
