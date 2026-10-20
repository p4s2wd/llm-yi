export function normLang(lang) {
  return String(lang || '').toLowerCase().split('-')[0];
}

export function pickPageLang(declared, detection, minPct = 50) {
  const d = normLang(declared) || null;
  const top = detection && Array.isArray(detection.languages) ? detection.languages[0] : null;
  const t = top && typeof top.percentage === 'number' && top.percentage >= minPct ? (normLang(top.language) || null) : null;
  if (!d) return t;
  if (t && detection.isReliable && t !== d) return t;
  return d;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function shouldAutoTranslate({ pageLang, targetLang, siteRule, autoTranslateNonTarget }) {
  if (siteRule === 'never') return false;
  if (!pageLang || pageLang === 'und' || normLang(pageLang) === normLang(targetLang)) return false;
  if (siteRule === 'always') return true;
  return !!autoTranslateNonTarget;
}
