// DOM 收集、写回、还原、SPA 增量翻译、与 background 消息。
(() => {
  const SKIP = 'script,style,noscript,textarea,input,select,code,pre,svg,template,[contenteditable],[translate="no"],.notranslate,[data-notranslate]';
  const isTop = window.top === window.self;
  const originals = new Map(); // node -> 原始 nodeValue
  const bilingualSpans = [];
  const done = new WeakSet(); // 已翻译节点
  let translating = false, showingOriginal = false, moTimer = null, moStarted = false;
  const state = { translated: false, pageLang: null, targetLang: null };

  function isVisible(node) {
    const el = node.parentElement;
    if (!el || el.closest(SKIP)) return false;
    const r = document.createRange();
    r.selectNodeContents(node);
    const rect = r.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function collectSegments() {
    const segments = [];
    if (!document.body) return segments;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (done.has(node) || originals.has(node)) continue;
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || /^[\d\s.,%$€£¥/:;()\-]+$/.test(text)) continue;
      if (!isVisible(node)) continue;
      segments.push({ index: segments.length, text, node });
    }
    return segments;
  }

  function applyResults(segments, results, bilingual) {
    translating = true;
    segments.forEach((seg, i) => {
      const t = results[i];
      if (!t || t === seg.text) return;
      originals.set(seg.node, seg.node.nodeValue);
      done.add(seg.node);
      seg.node.nodeValue = t;
      if (bilingual) {
        const span = document.createElement('span');
        span.setAttribute('data-notranslate', '');
        span.style.cssText = 'display:block;color:#888;font-size:0.85em;';
        span.textContent = seg.text;
        seg.node.parentElement.insertBefore(span, seg.node.nextSibling);
        bilingualSpans.push(span);
      }
    });
    translating = false;
    state.translated = true;
  }

  function restoreOriginal() {
    translating = true;
    for (const [node, text] of originals) { node.nodeValue = text; done.delete(node); }
    originals.clear();
    for (const s of bilingualSpans) s.remove();
    bilingualSpans.length = 0;
    translating = false;
    state.translated = false;
  }

  function showToolbar() {
    if (!isTop) return;
    globalThis.trToolbar.show({
      sourceLang: state.pageLang || 'auto',
      targetLang: state.targetLang || 'zh-CN',
      showingOriginal,
      onSwitchLang: (_src, dst) => { state.targetLang = dst; doTranslate(state.pageLang || 'auto'); },
      onToggleOriginal: () => {
        if (showingOriginal) { doTranslate(state.pageLang || 'auto'); }
        else { restoreOriginal(); showingOriginal = true; showToolbar(); }
      },
      onClose: () => { restoreOriginal(); showingOriginal = false; globalThis.trToolbar.hide(); }
    });
  }

  async function requestTranslation(segments, sourceLang) {
    return chrome.runtime.sendMessage({
      type: 'translate-page',
      segments: segments.map(({ index, text }) => ({ index, text })),
      sourceLang: sourceLang || 'auto',
      targetLang: state.targetLang,
    });
  }

  async function doTranslate(sourceLang) {
    if (translating) return;
    restoreOriginal();
    showingOriginal = false;
    state.targetLang = state.targetLang || 'zh-CN';
    showToolbar();
    const segments = collectSegments();
    if (!segments.length) return;
    translating = true;
    if (isTop) globalThis.trToolbar.progress(0, segments.length);
    try {
      const resp = await requestTranslation(segments, sourceLang);
      if (!resp || !resp.ok) { if (isTop) globalThis.trToolbar.error((resp && resp.error) || '翻译服务不可用'); return; }
      applyResults(segments, resp.results, resp.bilingual);
      if (isTop) { if (resp.partial) globalThis.trToolbar.error('部分段落翻译失败，已保留原文'); else globalThis.trToolbar.done(); }
      startObserver();
    } catch (e) {
      if (isTop) globalThis.trToolbar.error(String((e && e.message) || e));
    } finally {
      translating = false;
    }
  }

  async function translateNew() {
    if (translating || !state.translated) return;
    const segments = collectSegments();
    if (!segments.length) return;
    translating = true;
    try {
      const resp = await requestTranslation(segments, state.pageLang);
      if (resp && resp.ok) applyResults(segments, resp.results, resp.bilingual);
    } catch { /* 增量失败静默，下次 mutation 再试 */ }
    finally { translating = false; }
  }

  function startObserver() {
    if (moStarted || !document.body) return;
    moStarted = true;
    new MutationObserver(() => {
      if (translating || !state.translated) return;
      clearTimeout(moTimer);
      moTimer = setTimeout(translateNew, 800);
    }).observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'tr-progress') { if (isTop) globalThis.trToolbar.progress(msg.done, msg.total); return; }
    if (msg.type === 'popup-get-state') { sendResponse({ translated: state.translated, showingOriginal, pageLang: state.pageLang }); return; }
    if (msg.type === 'popup-translate') { doTranslate(msg.sourceLang || state.pageLang || 'auto'); sendResponse({ ok: true }); return; }
    if (msg.type === 'popup-restore') { restoreOriginal(); showingOriginal = true; showToolbar(); sendResponse({ ok: true }); return; }
  });

  async function init() {
    if (!/^https?:$/.test(location.protocol)) return;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'page-init',
        lang: document.documentElement.lang || null,
        sample: ((document.body && document.body.innerText) || '').slice(0, 2000),
      });
    } catch { return; }
    if (!resp) return;
    state.pageLang = resp.pageLang;
    state.targetLang = resp.targetLang;
    if (resp.autoTranslate) doTranslate(resp.pageLang || 'auto');
  }
  init();
})();
