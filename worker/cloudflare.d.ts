// The few Cloudflare Workers runtime types the relay uses (instead of pulling in
// @cloudflare/workers-types for three declarations).

interface CacheStorage {
  /** The data centre's shared cache. */
  readonly default: Cache;
}

interface RequestInit {
  cf?: { cacheTtl?: number; cacheEverything?: boolean };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
