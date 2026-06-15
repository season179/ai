// Public entry for the `@tanstack/ai/observability` subpath.
//
// Exposed here (not from the package root) so that importing `@tanstack/ai`
// never eagerly requires `@opentelemetry/api`, which is an optional peer
// dependency — mirroring how `otelMiddleware` lives at `@tanstack/ai/middlewares/otel`.
// The pure observer types are re-exported from the root for ergonomics; the
// `otelObserver` value lives only here.
export { otelObserver } from './otel'
export type { OtelObserverOptions } from './otel'
export type {
  ActivityKind,
  ActivityObserver,
  ActivityEventBase,
  ActivityStartEvent,
  ActivityFinishEvent,
  ActivityErrorEvent,
} from './types'
