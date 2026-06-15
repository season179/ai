import type { InternalLogger } from '../logger/internal-logger'
import type {
  ActivityErrorEvent,
  ActivityFinishEvent,
  ActivityObserver,
  ActivityStartEvent,
} from './types'

/**
 * Fan an event out to each observer's hook in registration order, awaiting each
 * one. A hook that throws is logged and skipped — observers are strictly
 * non-fatal, so a broken observer can never break the activity it watches.
 */
async function runHooks<TEvent>(
  observers: ReadonlyArray<ActivityObserver> | undefined,
  event: TEvent,
  select: (
    observer: ActivityObserver,
  ) => ((event: TEvent) => void | Promise<void>) | undefined,
  phase: 'onStart' | 'onFinish' | 'onError',
  logger: InternalLogger,
): Promise<void> {
  if (!observers || observers.length === 0) return
  for (const observer of observers) {
    const hook = select(observer)
    if (!hook) continue
    try {
      await hook.call(observer, event)
    } catch (error) {
      logger.errors(
        `observer "${observer.name ?? 'anonymous'}" ${phase} hook failed`,
        { error, source: 'observer' },
      )
    }
  }
}

export function notifyObserverStart(
  observers: ReadonlyArray<ActivityObserver> | undefined,
  event: ActivityStartEvent,
  logger: InternalLogger,
): Promise<void> {
  return runHooks(observers, event, (o) => o.onStart, 'onStart', logger)
}

export function notifyObserverFinish(
  observers: ReadonlyArray<ActivityObserver> | undefined,
  event: ActivityFinishEvent,
  logger: InternalLogger,
): Promise<void> {
  return runHooks(observers, event, (o) => o.onFinish, 'onFinish', logger)
}

export function notifyObserverError(
  observers: ReadonlyArray<ActivityObserver> | undefined,
  event: ActivityErrorEvent,
  logger: InternalLogger,
): Promise<void> {
  return runHooks(observers, event, (o) => o.onError, 'onError', logger)
}
