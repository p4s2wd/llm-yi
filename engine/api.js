const LANG_NAMES = {
  'zh-CN': 'Simplified Chinese', en: 'English', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian',
};

export function langName(code) {
  return LANG_NAMES[code] || code;
}

export function chatCompletionsUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

export function buildChatBody({ model, segments, sourceLang, targetLang }) {
  const list = segments.map((s) => s.text);
  const totalChars = list.reduce((n, t) => n + t.length, 0);
  return {
    model,
    temperature: 0.3,
    max_tokens: Math.min(8000, 100 + totalChars * 2),
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      {
        role: 'system',
        content:
          `You are a professional translator. Translate each string from ${langName(sourceLang)} ` +
          `to ${langName(targetLang)}. Preserve meaning, tone and inline formatting. ` +
          `Output ONLY a JSON array of exactly ${list.length} translated strings in the same order. ` +
          `No explanations, no code fences.`,
      },
      { role: 'user', content: JSON.stringify(list) },
    ],
  };
}

export function parseTranslationResponse(text, expectedLen) {
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) {
    let obj = null;
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
    if (obj !== null && !Array.isArray(obj)) throw new Error('response is not an array');
    throw new Error('no JSON array in response');
  }
  let arr;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw new Error('invalid JSON in response: ' + e.message);
  }
  if (!Array.isArray(arr)) throw new Error('response is not an array');
  if (arr.length !== expectedLen) {
    throw new Error(`length mismatch: expected ${expectedLen}, got ${arr.length}`);
  }
  if (arr.some((x) => typeof x !== 'string')) throw new Error('non-string element in response');
  return arr;
}

export async function translateBatch(settings, segments, { sourceLang, targetLang, signal }) {
  const res = await fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(buildChatBody({ model: settings.model, segments, sourceLang, targetLang })),
  });
  if (!res.ok) {
    const err = new Error(`API HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  return parseTranslationResponse(content, segments.length);
}
