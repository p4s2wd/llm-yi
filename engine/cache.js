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

export function createCache(storage, { max = 3000 } = {}) {
  let map = null; // key -> { t: lastTouchMs, v: translated }
  async function load() {
    if (!map) {
      const stored = await storage.get('cache');
      map = new Map(Object.entries(stored.cache || {}));
    }
    return map;
  }
  return {
    async get(text, targetLang) {
      const m = await load();
      const k = cacheKey(text, targetLang);
      if (!m.has(k)) return undefined;
      m.get(k).t = Date.now();
      return m.get(k).v;
    },
    async set(text, targetLang, value) {
      const m = await load();
      m.set(cacheKey(text, targetLang), { t: Date.now(), v: value });
      if (m.size > max) {
        const oldest = [...m.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, m.size - max);
        for (const [k] of oldest) m.delete(k);
      }
      await storage.set({ cache: Object.fromEntries(m) });
    },
  };
}
