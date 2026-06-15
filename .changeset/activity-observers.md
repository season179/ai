---
'@tanstack/ai': minor
---

Add an activity-agnostic observability hook for non-chat activities (#720). The media activities — `generateImage`, `generateVideo`, `generateAudio`, `generateSpeech`, and `generateTranscription` — now accept an `observers` option taking lightweight `ActivityObserver`s (`onStart` / `onFinish` / `onError`, payload discriminated by `activity`). Observers are awaited in order and strictly non-fatal — a throwing observer is logged and skipped, never breaking the activity.

Ships `otelObserver()` on the new `@tanstack/ai/observability` subpath: it emits one `gen_ai.*` span per activity call, tagged with the correct `gen_ai.operation.name` (`image_generation`, `video_generation`, `audio_generation`, `text_to_speech`, `transcription`), and reuses the same `gen_ai.usage.*` attribute set as `otelMiddleware` — now including `tanstack.ai.usage.units_billed` for unit-billed media. With a `Meter` it also records the `gen_ai.client.operation.duration` histogram per activity. The `ActivityObserver` types are exported from the package root, while the `otelObserver` value lives on the subpath so importing `@tanstack/ai` never requires the optional `@opentelemetry/api` peer.
