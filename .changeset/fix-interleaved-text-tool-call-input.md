---
'@tanstack/ai': patch
---

Fix tool-call `input` corruption when a `TEXT_MESSAGE_CONTENT` event interleaves between `TOOL_CALL_ARGS` events (#1017). Text events now mark the forced completion as inferred: later `TOOL_CALL_ARGS` revert the call to `input-streaming`, and the authoritative `TOOL_CALL_END` re-completes it with the full arguments instead of being skipped. The rendered part's `input` is also only populated when a strict `JSON.parse` of the accumulated arguments succeeds, so a lenient partial-JSON parse of truncated arguments can no longer surface a silently corrupted value — `input` stays unset and the raw `arguments` string remains the documented fallback.
