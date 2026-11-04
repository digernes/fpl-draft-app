// The deployed site's data.json as the Durable Objects read it: asked for at most every
// SITE_MS (Cloudflare's cache answers within that, past GitHub Pages' own ten minutes) and
// kept in memory between requests. A failed read waits as long, with the last one read, if any.

export const SITE_MS = 5 * 60 * 1000; // data.json changes about every ten minutes while matches are on

/** What every reader needs of it: the rest is each one's own (shared/data.ts). */
type Checked = { meta: { season: string }; matches: unknown[]; gameweeks: unknown[] };

export class Site<T extends Checked> {
  private readonly url: string | undefined;
  private data: T | undefined;
  private asked: number | undefined;

  constructor(url: string | undefined) {
    this.url = url;
  }

  async get(now: number): Promise<T | undefined> {
    if (!this.url || (this.asked !== undefined && now - this.asked < SITE_MS)) return this.data;
    this.asked = now;
    try {
      const bucket = Math.floor(now / SITE_MS);
      const res = await fetch(`${this.url}/data.json?v=${bucket}`, { cf: { cacheTtl: SITE_MS / 1000, cacheEverything: true } });
      const data = res.ok ? ((await res.json()) as T) : undefined;
      if (data?.meta?.season && Array.isArray(data.matches) && Array.isArray(data.gameweeks)) this.data = data;
    } catch {
      // The last one stands.
    }
    return this.data;
  }
}
