export const DEFAULTS = {
  baseUrl: 'http://localhost:8000/v1',
  apiKey: '',
  model: 'qwen35-122b',
  targetLang: 'zh-CN',
  concurrency: 3,
  bilingual: false,
  autoTranslateNonTarget: true,
};

export function loadSettings(storage) {
  return storage.get('settings').then((stored) => {
    const s = { ...DEFAULTS };
    const p = stored.settings || {};
    for (const k of Object.keys(DEFAULTS)) if (k in p) s[k] = p[k];
    return s;
  });
}

export function saveSettings(storage, patch) {
  return loadSettings(storage).then((cur) => {
    const next = { ...cur };
    for (const k of Object.keys(DEFAULTS)) if (k in patch) next[k] = patch[k];
    return storage.set({ settings: next }).then(() => next);
  });
}
