export function fakeStorage(init = {}) {
  const db = { ...init };
  return {
    db,
    async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in db) out[k] = db[k]; return out; },
    async set(obj) { Object.assign(db, obj); },
  };
}
