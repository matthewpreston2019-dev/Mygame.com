// Tiny key-value abstraction over Netlify Blobs with an in-memory fallback
// (used in unit tests or if Blobs is unavailable). Used for rate limits, usage counters and admin logs.

import { getStore } from '@netlify/blobs';

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  del(key: string): Promise<void>;
}

class MemoryKV implements KV {
  private m = new Map<string, unknown>();
  async get<T>(key: string) {
    return (this.m.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown) {
    this.m.set(key, value);
  }
  async list(prefix: string) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix));
  }
  async del(key: string) {
    this.m.delete(key);
  }
}

class BlobsKV implements KV {
  constructor(private name: string) {}
  private store() {
    return getStore({ name: this.name, consistency: 'strong' });
  }
  async get<T>(key: string) {
    return ((await this.store().get(key, { type: 'json' })) as T) ?? null;
  }
  async set(key: string, value: unknown) {
    await this.store().setJSON(key, value);
  }
  async list(prefix: string) {
    const res = await this.store().list({ prefix });
    return res.blobs.map((b) => b.key);
  }
  async del(key: string) {
    await this.store().delete(key);
  }
}

const memory = new Map<string, MemoryKV>();
const blobsBroken = new Set<string>();

/** Returns a KV that transparently falls back to memory if Blobs is not configured. */
export function kv(name: string): KV {
  const mem = memory.get(name) ?? new MemoryKV();
  memory.set(name, mem);
  if (process.env.NODE_ENV === 'test' || blobsBroken.has(name)) return mem;
  const blobs = new BlobsKV(name);
  const guard =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>, memFn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (blobsBroken.has(name)) return memFn(...a);
      try {
        return await fn(...a);
      } catch (err) {
        const msg = err instanceof Error ? err.name + ' ' + err.message : String(err);
        if (/MissingBlobsEnvironment|environment has not been configured/i.test(msg)) {
          blobsBroken.add(name);
          console.warn(`[lumora] Netlify Blobs unavailable for "${name}", using in-memory store`);
          return memFn(...a);
        }
        throw err;
      }
    };
  return {
    get: guard(blobs.get.bind(blobs), mem.get.bind(mem)) as KV['get'],
    set: guard(blobs.set.bind(blobs), mem.set.bind(mem)),
    list: guard(blobs.list.bind(blobs), mem.list.bind(mem)),
    del: guard(blobs.del.bind(blobs), mem.del.bind(mem)),
  };
}
