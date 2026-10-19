export function normLang(lang) {
  return String(lang || '').toLowerCase().split('-')[0];
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
  if (!pageLang || normLang(pageLang) === normLang(targetLang)) return false;
  if (siteRule === 'always') return true;
  return !!autoTranslateNonTarget;
}
