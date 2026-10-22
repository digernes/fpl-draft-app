// The few Cloudflare Workers runtime types the relay uses (instead of pulling in
// @cloudflare/workers-types for four declarations).

interface CacheStorage {
  /** The data centre's shared cache. */
  readonly default: Cache;
}

interface RequestInit {
  cf?: { cacheTtl?: number; cacheEverything?: boolean };
}

interface ScheduledController {
  /** When the timer fired, in ms since the epoch. */
  readonly scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
