// DOM 收集、逐批写回（tr-batch 分批上屏）、还原、SPA 增量翻译、与 background 消息。
(() => {
  const SKIP = 'script,style,noscript,textarea,input,select,code,pre,svg,template,[contenteditable],[translate="no"],.notranslate,[data-notranslate]';
  const isTop = window.top === window.self;
  const originals = new Map(); // node -> { original, translated }
  const bilingualSpans = [];
  const done = new WeakSet(); // 已翻译节点
  let translating = false, showingOriginal = false, moTimer = null, moStarted = false;
  let gen = 0; // 请求代际计数：用户操作递增，使迟到的响应作废
  let pending = false; // 请求期间是否有 DOM 变更，完成后补翻
  let activeGen = null; // 当前在途请求的代际（防止 frame 间/换代后的 tr-batch 串写）
  let activeSegments = null; // 在途请求的 segments（index -> {node,text} 映射）
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
      if (done.has(node)) {
        const rec = originals.get(node);
        const cur = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (rec && cur !== rec.original.replace(/\s+/g, ' ').trim() && cur !== rec.translated) { done.delete(node); originals.delete(node); }
        else continue;
      } else if (originals.has(node)) continue;
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || /^[\d\s.,%$€£¥/:;()\-]+$/.test(text)) continue;
      if (!isVisible(node)) continue;
      segments.push({ index: segments.length, text, node });
    }
    return segments;
  }

  function applyOne(seg, t, bilingual) {
    if (!t || originals.has(seg.node) || done.has(seg.node)) return; // tr-batch 已应用过则最终响应到达也幂等跳过；空文本不写回
    if (t === seg.text) return; // 兜底原文不写回
    t = t.replace(/\s+/g, ' ').trim(); // 写回前归一化，与 collectSegments 的检测形成闭环，防无限重译
    originals.set(seg.node, { original: seg.node.nodeValue, translated: t });
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
  }

  function applyResults(segments, results, bilingual) {
    translating = true;
    segments.forEach((seg, i) => applyOne(seg, results[i], bilingual));
    translating = false;
    state.translated = true;
  }

  function restoreOriginal() {
    cancelRechecks(); // 用户还原或开始新一轮翻译，取消挂起的延迟重判，防止其稍后覆盖用户意图
    activeGen = null; // 迟到的 tr-batch（背景 job 未取消）一律丢弃，防止覆盖刚还原的内容
    activeSegments = null;
    gen++;
    pending = false;
    translating = true;
    for (const [node, v] of originals) { node.nodeValue = v.original; done.delete(node); }
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

  async function requestTranslation(segments, sourceLang, gen) {
    return chrome.runtime.sendMessage({
      type: 'translate-page',
      segments: segments.map(({ index, text }) => ({ index, text })),
      sourceLang: sourceLang || 'auto',
      targetLang: state.targetLang,
      gen,
    });
  }

  async function doTranslate(sourceLang) {
    if (translating) return;
    restoreOriginal();
    const myGen = ++gen; // 必须在 restoreOriginal 之后捕获：它内部的 gen++ 会使更早的代际作废
    showingOriginal = false;
    state.targetLang = state.targetLang || 'zh-CN';
    showToolbar();
    const segments = collectSegments();
    if (!segments.length) return;
    translating = true;
    activeGen = myGen; activeSegments = segments; // 请求发出前置位，tr-batch 只认这组指针
    if (isTop) globalThis.trToolbar.progress(0, segments.length);
    try {
      const resp = await requestTranslation(segments, sourceLang, myGen);
      if (myGen !== gen) return; // 等待期间用户已操作，丢弃迟到响应
      if (!resp || !resp.ok) { if (isTop) globalThis.trToolbar.error((resp && resp.error) || '翻译服务不可用'); return; }
      applyResults(segments, resp.results, resp.bilingual);
      if (isTop) { if (resp.partial) globalThis.trToolbar.error('部分段落翻译失败，已保留原文'); else globalThis.trToolbar.done(); }
      startObserver();
    } catch (e) {
      if (isTop) globalThis.trToolbar.error(String((e && e.message) || e));
    } finally {
      if (myGen === gen) { // 只有当代请求才有权清标志，被作废的迟到响应不得干扰新一代
        translating = false;
        if (pending && state.translated) { pending = false; setTimeout(translateNew, 800); }
      }
    }
  }

  async function translateNew() {
    if (translating || !state.translated) return;
    const myGen = gen;
    for (const n of originals.keys()) if (!n.isConnected) originals.delete(n);
    for (let i = bilingualSpans.length - 1; i >= 0; i--) if (!bilingualSpans[i].isConnected) bilingualSpans.splice(i, 1);
    const segments = collectSegments();
    if (!segments.length) return;
    translating = true;
    activeGen = myGen; activeSegments = segments;
    try {
      const resp = await requestTranslation(segments, state.pageLang, myGen);
      if (myGen !== gen) return; // 等待期间用户已操作，丢弃迟到响应
      if (resp && resp.ok) applyResults(segments, resp.results, resp.bilingual);
    } catch { /* 增量失败静默，下次 mutation 再试 */ }
    finally {
      if (myGen === gen) { // 只有当代请求才有权清标志，被作废的迟到响应不得干扰新一代
        translating = false;
        if (pending && state.translated) { pending = false; setTimeout(translateNew, 800); }
      }
    }
  }

  function startObserver() {
    if (moStarted || !document.body) return;
    moStarted = true;
    new MutationObserver(() => {
      if (translating) { pending = true; return; } // 在途请求期间的变更不丢失，完成后补翻
      if (!state.translated) return;
      clearTimeout(moTimer);
      moTimer = setTimeout(translateNew, 800);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'tr-batch') {
      if (msg.gen !== activeGen || !activeSegments) return; // 本 frame 无在途请求或已换代，丢弃
      for (const item of msg.items || []) {
        const seg = activeSegments[item.index];
        if (seg) applyOne(seg, item.ok ? item.text : null, msg.bilingual);
      }
      if (isTop) globalThis.trToolbar.progress(msg.done, msg.total);
      return;
    }
    if (msg.type === 'popup-get-state') { sendResponse({ translated: state.translated, showingOriginal, pageLang: state.pageLang }); return; }
    if (msg.type === 'popup-translate') { if (msg.targetLang) state.targetLang = msg.targetLang; doTranslate(msg.sourceLang || state.pageLang || 'auto'); sendResponse({ ok: true }); return; }
    if (msg.type === 'popup-restore') { restoreOriginal(); showingOriginal = true; showToolbar(); sendResponse({ ok: true }); return; }
  });

  async function askPageInit() {
    try {
      return await chrome.runtime.sendMessage({
        type: 'page-init',
        lang: document.documentElement.lang || null,
        sample: ((document.body && document.body.innerText) || '').slice(0, 2000),
      });
    } catch { return null; }
  }

  // JS 重渲染页面的正文在 document_idle 时可能还没出现，语言判定会用导航碎片做出错误结论。
  // 3s/10s 各重判一次：正文渲染完成后样本足够成熟，background 会给出新的判定。
  let recheckTimers = [];
  function cancelRechecks() { recheckTimers.forEach(clearTimeout); recheckTimers = []; }
  async function recheck() {
    if (state.translated || translating || showingOriginal) return;
    const resp = await askPageInit();
    if (!resp || !resp.autoTranslate) return;
    // await 期间用户可能已手动翻译/还原/关闭，或另一次 recheck 已开翻——复查守卫再动手
    if (state.translated || translating || showingOriginal) return;
    state.pageLang = resp.pageLang;
    state.targetLang = resp.targetLang;
    doTranslate(resp.pageLang || 'auto');
  }

  async function init() {
    if (!/^https?:$/.test(location.protocol)) return;
    const resp = await askPageInit();
    if (!resp) return;
    state.pageLang = resp.pageLang;
    state.targetLang = resp.targetLang;
    if (resp.autoTranslate) doTranslate(resp.pageLang || 'auto');
    // document_end 时 JS 渲染页面可能连正文都没有（0 段不触发翻译）——无条件排重判，recheck 守卫会自动跳过已完成/在途的情况
    if (isTop) recheckTimers = [setTimeout(recheck, 3000), setTimeout(recheck, 10000)];
  }
  init();
})();
