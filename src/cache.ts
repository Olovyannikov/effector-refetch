import { createStore } from 'effector';
import type { CacheAdapter, CacheEntry } from './types';

/**
 * Scope-level cache adapter override. Set it per fork to give every query in that
 * scope an isolated cache — the one-liner that makes multi-tenant SSR safe:
 *
 *   // server, per request
 *   const cache = inMemoryCache();
 *   const scope = fork({ values: [[$queryCache, cache]] });
 *   await allSettled(todosQuery.start, { scope });
 *   const payload = { values: serialize(scope), cache: dehydrate(cache) };
 *
 *   // client
 *   const cache = inMemoryCache();
 *   hydrate(cache, payload.cache);
 *   const scope = fork({ values: [...fromJSON(payload.values), [$queryCache, cache]] });
 *
 * `null` (default) — every query uses its own configured adapter (module-level,
 * shared across scopes; fine for a single-client app). In a shared scope adapter,
 * entries are namespaced per query: `name` ?? the effect's sid ?? a creation
 * counter — give queries stable `name`s when the server and client bundles may
 * initialize modules in a different order.
 */
export const $queryCache = createStore<CacheAdapter | null>(null, {
  serialize: 'ignore',
  name: '$queryCache',
});

/** Optional observers for cache activity. */
export interface CacheEvents {
  onHit?: (key: string) => void;
  onMiss?: (key: string) => void;
  onExpired?: (key: string) => void;
  onEvicted?: (key: string) => void;
}

export interface InMemoryCacheOptions extends CacheEvents {
  /** Drop entries older than this (ms) on access. */
  maxAge?: number;
  /** Keep at most this many entries (LRU eviction). */
  maxEntries?: number;
  /** Clock, overridable in tests. Default: () => Date.now(). */
  now?: () => number;
}

/** In-memory cache with optional GC (maxAge / maxEntries, LRU) and events. */
export function inMemoryCache(options: InMemoryCacheOptions = {}): CacheAdapter {
  const { maxAge, maxEntries, now = () => Date.now(), onHit, onMiss, onExpired, onEvicted } = options;
  const store = new Map<string, CacheEntry>();

  const expired = (entry: CacheEntry) => maxAge != null && now() - entry.storedAt >= maxAge;

  return {
    get: (key) => {
      const entry = store.get(key);
      if (!entry) {
        onMiss?.(key);
        return null;
      }
      if (expired(entry)) {
        store.delete(key);
        onExpired?.(key);
        onMiss?.(key);
        return null;
      }
      // LRU touch: move to most-recently-used
      store.delete(key);
      store.set(key, entry);
      onHit?.(key);
      return entry;
    },
    set: (key, value, storedAt) => {
      store.delete(key);
      store.set(key, { value, storedAt });
      if (maxEntries != null) {
        while (store.size > maxEntries) {
          const oldest = store.keys().next().value;
          if (oldest === undefined) break;
          store.delete(oldest);
          onEvicted?.(oldest);
        }
      }
    },
    remove: (key) => {
      store.delete(key);
    },
    purge: () => {
      store.clear();
    },
    dump: () => Array.from(store, ([key, entry]) => ({ key, value: entry.value, storedAt: entry.storedAt })),
  };
}

/** A serializable cache entry produced by {@link dehydrate}. */
export interface DehydratedEntry {
  key: string;
  value: unknown;
  storedAt: number;
}

/**
 * Snapshot a cache adapter into a JSON-serializable array — typically on the
 * server after queries have run, to embed alongside effector's `serialize(scope)`.
 * Only adapters that implement `dump` (e.g. `inMemoryCache`) can be dehydrated;
 * others return `[]` (web-storage adapters already persist themselves).
 */
export function dehydrate(cache: CacheAdapter): DehydratedEntry[] {
  return typeof cache.dump === 'function' ? cache.dump() : [];
}

/**
 * Restore entries (from {@link dehydrate}) into a cache adapter — typically on the
 * client before the app starts, so cached keys hit instead of refetching. The
 * original `storedAt` is preserved, so `staleAfter` ages from the server's fetch time.
 */
export function hydrate(cache: CacheAdapter, entries: readonly DehydratedEntry[]): void {
  for (const e of entries) cache.set(e.key, e.value, e.storedAt);
}

interface StoredRecord extends CacheEntry {
  /** Schema/data version — a mismatch invalidates the entry (migration). */
  v?: string | number;
}

export interface WebStorageCacheOptions {
  prefix?: string;
  /** Bump to invalidate all previously stored entries (migration). */
  version?: string | number;
  /** Drop entries older than this (ms) on access. */
  maxAge?: number;
  now?: () => number;
}

function webStorageCache(getStorage: () => Storage, options: WebStorageCacheOptions): CacheAdapter {
  const { prefix = 'eq:', version, maxAge, now = () => Date.now() } = options;
  const k = (key: string) => `${prefix}${key}`;
  return {
    get: (key) => {
      try {
        const raw = getStorage().getItem(k(key));
        if (!raw) return null;
        const rec = JSON.parse(raw) as StoredRecord;
        if (version !== undefined && rec.v !== version) {
          getStorage().removeItem(k(key));
          return null;
        }
        if (maxAge != null && now() - rec.storedAt >= maxAge) {
          getStorage().removeItem(k(key));
          return null;
        }
        return { value: rec.value, storedAt: rec.storedAt };
      } catch {
        return null;
      }
    },
    set: (key, value, storedAt) => {
      try {
        const rec: StoredRecord = { value, storedAt, v: version };
        getStorage().setItem(k(key), JSON.stringify(rec));
      } catch {
        /* quota / serialization — ignore */
      }
    },
    remove: (key) => {
      try {
        getStorage().removeItem(k(key));
      } catch {
        /* ignore */
      }
    },
    purge: () => {
      try {
        const storage = getStorage();
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && key.startsWith(prefix)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
      } catch {
        /* ignore */
      }
    },
  };
}

export function localStorageCache(options: WebStorageCacheOptions = {}): CacheAdapter {
  return webStorageCache(() => localStorage, options);
}

export function sessionStorageCache(options: WebStorageCacheOptions = {}): CacheAdapter {
  return webStorageCache(() => sessionStorage, options);
}

/** Never stores, never restores. Useful for tests. */
export function voidCache(): CacheAdapter {
  return {
    get: () => null,
    set: () => {},
    remove: () => {},
    purge: () => {},
  };
}
