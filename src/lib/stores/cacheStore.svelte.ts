interface CacheEntry {
  data: unknown;
  ts: number;
  ttl: number;
}

let _cache = $state<Map<string, CacheEntry>>(new Map());

function now(): number {
  return Date.now();
}

export const cacheStore = {
  get<T>(key: string): T | null {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (now() - entry.ts > entry.ttl) {
      _cache.delete(key);
      return null;
    }
    return entry.data as T;
  },

  set(key: string, data: unknown, ttl: number) {
    _cache.set(key, { data, ts: now(), ttl });
  },

  async fetch<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;
    const data = await fetcher();
    this.set(key, data, ttl);
    return data;
  },

  invalidate(prefix: string) {
    for (const key of _cache.keys()) {
      if (key.startsWith(prefix)) {
        _cache.delete(key);
      }
    }
  },

  invalidateAll() {
    _cache = new Map();
  },
};
