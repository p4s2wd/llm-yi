// 页面翻译工具条（closed shadow DOM）。与 content.js 共享 isolated world，
// 通过 globalThis.trToolbar 暴露命令式 API。
// 设计：默认永远收纳为小圆点徽标，仅点击徽标展开面板；支持拖拽到视口任意位置，
// 位置跨页面记忆（chrome.storage.local）；出错时徽标变红，细节点击徽标后可见。
(() => {
  const LANGS = [
    ['auto', '自动检测'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'],
    ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'],
  ];
  const POS_KEY = 'toolbarPos'; // { x, y } 视口左上角坐标，全局记忆
  const DEFAULT_POS = { x: 8, y: 8 };
  let host = null, els = {}, cb = {};
  let minTimer = null; // 面板展开后自动收起的定时器
  let expanded = false;
  let pos = { ...DEFAULT_POS };
  let posLoaded = false;

  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:8px;left:8px;z-index:2147483647;cursor:default';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .bar{font:13px/1.4 system-ui,sans-serif;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:6px 8px;box-shadow:0 2px 6px rgba(0,0,0,.25)}
        select,button{font:inherit;border:1px solid #dadce0;border-radius:4px;background:#fff;padding:2px 6px;cursor:pointer}
        .status{color:#5f6368;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .status.err{color:#d93025}
        .badge{display:flex;align-items:center;justify-content:center;width:28px;height:28px;font:14px/1 system-ui,sans-serif;color:rgba(255,255,255,.95);background:#1a73e8;border:none;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:grab;opacity:.55;transition:opacity .15s}
        .badge:hover{opacity:.92}
        .badge:active{cursor:grabbing}
        .badge.err{background:#d93025;opacity:.85}
        .dragging{cursor:grabbing!important;user-select:none}
        .dragging *{cursor:grabbing!important;user-select:none}
      </style>
      <div class="bar" style="display:none">
        <select class="src"></select><span>→</span><select class="dst"></select>
        <button class="toggle">显示原文</button>
        <span class="status"></span>
        <button class="mini" title="收起">—</button>
        <button class="close" title="关闭">✕</button>
      </div>
      <button class="badge" title="翻译工具条">译</button>`;
    const q = (s) => shadow.querySelector(s);
    els = { bar: q('.bar'), badge: q('.badge'), src: q('.src'), dst: q('.dst'), toggle: q('.toggle'), status: q('.status') };
    for (const [v, label] of LANGS) els.src.add(new Option(label, v));
    for (const [v, label] of LANGS) if (v !== 'auto') els.dst.add(new Option(label, v));
    els.src.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.dst.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.toggle.onclick = () => cb.onToggleOriginal && cb.onToggleOriginal();
    q('.mini').onclick = minimizePane;
    q('.close').onclick = () => cb.onClose && cb.onClose();
    makeDraggable(els.badge, { isBar: false, onClick: expandPane });
    makeDraggable(els.bar, { isBar: true });
    document.documentElement.appendChild(host);
    loadPosOnce().then(() => { if (host) { clampToActive(); applyHost(); } });
  }

  // ---- 位置管理 ----
  function activeSize() {
    // host 尺寸 = 当前可见元素尺寸
    const r = host.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function clampToActive() {
    const { w, h } = activeSize();
    pos.x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w));
    pos.y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - h));
  }
  function applyHost() {
    host.style.left = `${Math.round(pos.x)}px`;
    host.style.top = `${Math.round(pos.y)}px`;
  }
  async function loadPosOnce() {
    if (posLoaded) return;
    posLoaded = true;
    try {
      const o = await chrome.storage.local.get(POS_KEY);
      if (o[POS_KEY] && typeof o[POS_KEY].x === 'number' && typeof o[POS_KEY].y === 'number') pos = { x: o[POS_KEY].x, y: o[POS_KEY].y };
    } catch { /* 存储不可用时保持默认 */ }
  }
  function persistPos() {
    try { chrome.storage.local.set({ [POS_KEY]: { x: Math.round(pos.x), y: Math.round(pos.y) } }).catch(() => {}); } catch {}
  }

  // ---- 拖拽 ----
  // 不用 setPointerCapture（<button> 上不可靠）：pointermove/up 挂 window，
  // 无论指针滑出元素/被其他按钮截走都能继续拖拽；点击/拖拽用 4px 位移阈值区分。
  function makeDraggable(el, { isBar = false, onClick } = {}) {
    let drag = null; // { sx, sy, ox, oy, moved }
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 面板内的控件（下拉/按钮）保持自身交互，不做拖拽
      if (isBar && e.target && e.target.closest && e.target.closest('select,button')) return;
      drag = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return; // 4px 内视作点击
      drag.moved = true;
      e.preventDefault();
      host.classList.add('dragging');
      pos.x = drag.ox + dx;
      pos.y = drag.oy + dy;
      const { w, h } = activeSize();
      pos.x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w));
      pos.y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - h));
      applyHost();
    });
    const up = (e) => {
      if (!drag) return;
      const wasMoved = drag.moved;
      drag = null;
      host.classList.remove('dragging');
      if (wasMoved) persistPos();
      else if (el === els.badge && onClick) onClick();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---- 展开 / 收纳 ----
  function expandPane() {
    clearTimeout(minTimer);
    expanded = true;
    els.badge.style.display = 'none';
    els.bar.style.display = '';
    clampToActive(); // 面板比徽标宽，靠右边缘时向内收
    applyHost();
    // 展开态无操作自动收起：悬停拖延，防正要操作时突然消失
    minTimer = setTimeout(collapseOnIdle, 6000);
  }

  function collapseOnIdle() {
    if (host && host.matches(':hover')) { minTimer = setTimeout(collapseOnIdle, 3000); return; }
    minimizePane();
  }

  function minimizePane() {
    clearTimeout(minTimer);
    expanded = false;
    els.bar.style.display = 'none';
    els.badge.style.display = '';
    clampToActive();
    applyHost();
  }

  globalThis.trToolbar = {
    // 默认收纳：仅在指定位置出现小圆点，绝不自动弹出面板
    show({ sourceLang = 'auto', targetLang = 'zh-CN', showingOriginal = false, onSwitchLang, onToggleOriginal, onClose } = {}) {
      ensure();
      cb = { onSwitchLang, onToggleOriginal, onClose };
      els.src.value = sourceLang;
      els.dst.value = targetLang;
      els.toggle.textContent = showingOriginal ? '显示译文' : '显示原文';
      els.status.textContent = '';
      els.status.className = 'status';
      els.badge.className = 'badge';
      els.badge.title = '翻译工具条（可拖拽）';
      clearTimeout(minTimer);
      minimizePane();
      host.style.display = '';
    },
    progress(done, total) {
      if (!host) return;
      clearTimeout(minTimer); // 翻译在途不收起已展开的面板
      els.status.textContent = `翻译中 ${done}/${total}`;
      els.status.className = 'status';
      if (!expanded) els.badge.title = `翻译中 ${done}/${total}`;
    },
    done() {
      if (!host) return;
      els.status.textContent = '';
      els.badge.title = '翻译工具条（可拖拽）';
      if (expanded) { clearTimeout(minTimer); minTimer = setTimeout(minimizePane, 3000); } // 展开中的面板完成后自动收起
    },
    error(msg) {
      if (!host) return;
      clearTimeout(minTimer);
      els.status.textContent = msg;
      els.status.className = 'status err';
      // 不强制展开（默认收起原则）；徽标变红提示，细节悬停/点击查看
      els.badge.className = 'badge err';
      els.badge.title = String(msg).slice(0, 200);
    },
    hide() { if (host) host.style.display = 'none'; },
  };
})();
