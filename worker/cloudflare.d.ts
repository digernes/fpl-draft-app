// The few Cloudflare Workers runtime types the relay uses (instead of pulling in
// @cloudflare/workers-types for a handful of declarations).

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

// Durable Objects, as the polls and the win chance's records use them (poll.ts, in-play.ts):
// a stub's fetch, and the storage's key-value calls, which a SQLite-backed object keeps in
// its database.

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  /** Several keys at once, atomically. */
  put(entries: Record<string, unknown>): Promise<void>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
}
