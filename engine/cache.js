// 32-bit FNV-1a: at 3000 entries collision chance ~0.1% — acceptable for a cache (worst case: one wrong cached translation until eviction).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function cacheKey(text, targetLang) {
  return `${targetLang}:${fnv1a(text)}`;
}

export function createCache(storage, { max = 3000, persistDelayMs = 400 } = {}) {
  let loading = null; // Promise<Map<key,{t,v}>> — dedups concurrent first loads
  let dirtyTimer = null;

  function load() {
    if (!loading) {
      loading = storage.get('cache').then((stored) => {
        const raw = stored.cache && typeof stored.cache === 'object' ? stored.cache : {};
        return new Map(Object.entries(raw));
      });
    }
    return loading;
  }

  function persist(m) {
    return storage.set({ cache: Object.fromEntries(m) });
  }

  function schedulePersist(m) {
    if (dirtyTimer) clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      persist(m).catch(() => {}); // quota/IO errors must not crash the SW; cache is best-effort
    }, persistDelayMs);
  }

  return {
    async get(text, targetLang) {
      const m = await load();
      const k = cacheKey(text, targetLang);
      if (!m.has(k)) return undefined;
      m.get(k).t = Date.now();
      schedulePersist(m);
      return m.get(k).v;
    },
    async set(text, targetLang, value) {
      const m = await load();
      m.set(cacheKey(text, targetLang), { t: Date.now(), v: value });
      if (m.size > max) {
        const oldest = [...m.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, m.size - max);
        for (const [k] of oldest) m.delete(k);
      }
      schedulePersist(m);
    },
    async flush() {
      if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; }
      const m = await load();
      await persist(m);
    },
  };
}
