// 页面翻译工具条（closed shadow DOM）。与 content.js 共享 isolated world，
// 通过 globalThis.trToolbar 暴露命令式 API。
(() => {
  const LANGS = [
    ['auto', '自动检测'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'],
    ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'],
  ];
  let host = null, els = {}, cb = {};
  let minTimer = null; // done() 后 3 秒自动收纳的定时器句柄

  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:8px;left:8px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .bar{font:13px/1.4 system-ui,sans-serif;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:6px 8px;box-shadow:0 2px 6px rgba(0,0,0,.25)}
        select,button{font:inherit;border:1px solid #dadce0;border-radius:4px;background:#fff;padding:2px 6px;cursor:pointer}
        .status{color:#5f6368;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .status.err{color:#d93025}
        .badge{width:28px;height:28px;padding:0;border-radius:50%;background:#fff;border:1px solid #dadce0;box-shadow:0 1px 3px rgba(0,0,0,.2);opacity:.75;cursor:pointer;font:13px/26px system-ui,sans-serif;text-align:center}
        .badge:hover{opacity:1}
      </style>
      <div class="bar">
        <select class="src"></select><span>→</span><select class="dst"></select>
        <button class="toggle">显示原文</button>
        <span class="status"></span>
        <button class="close" title="关闭">✕</button>
      </div>
      <button class="badge" title="展开翻译工具条" style="display:none">译</button>`;
    const q = (s) => shadow.querySelector(s);
    els = { bar: q('.bar'), badge: q('.badge'), src: q('.src'), dst: q('.dst'), toggle: q('.toggle'), status: q('.status') };
    for (const [v, label] of LANGS) els.src.add(new Option(label, v));
    for (const [v, label] of LANGS) if (v !== 'auto') els.dst.add(new Option(label, v));
    els.src.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.dst.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.toggle.onclick = () => cb.onToggleOriginal && cb.onToggleOriginal();
    q('.close').onclick = () => cb.onClose && cb.onClose();
    // 徽标点击：从收纳态展开工具条，沿用上次内容与回调，此后不再自动收纳（直到下一次 done()）
    els.badge.onclick = () => expand();
    document.documentElement.appendChild(host);
  }

  // 收纳为小徽标：隐藏完整工具条，仅显示"译"徽标
  function minimize() {
    els.bar.style.display = 'none';
    els.badge.style.display = '';
  }
  // 展开完整工具条：隐藏徽标，恢复显示
  function expand() {
    els.badge.style.display = 'none';
    els.bar.style.display = '';
  }

  globalThis.trToolbar = {
    show({ sourceLang = 'auto', targetLang = 'zh-CN', showingOriginal = false, onSwitchLang, onToggleOriginal, onClose } = {}) {
      ensure();
      clearTimeout(minTimer); minTimer = null; // 全新翻译：取消挂起的收纳
      expand(); // 复位为展开态
      cb = { onSwitchLang, onToggleOriginal, onClose };
      els.src.value = sourceLang;
      els.dst.value = targetLang;
      els.toggle.textContent = showingOriginal ? '显示译文' : '显示原文';
      els.status.textContent = '';
      els.status.className = 'status';
      host.style.display = '';
    },
    progress(done, total) {
      if (!host) return;
      clearTimeout(minTimer); minTimer = null; // 翻译中：取消收纳，保持展开
      expand();
      els.status.textContent = `翻译中 ${done}/${total}`;
      els.status.className = 'status';
    },
    done() {
      if (!host) return;
      clearTimeout(minTimer); minTimer = null;
      els.status.textContent = '';
      // 完成后 3 秒自动收纳为小徽标
      minTimer = setTimeout(minimize, 3000);
    },
    error(msg) {
      if (!host) return;
      clearTimeout(minTimer); minTimer = null; // 错误期间不会被收纳
      expand(); // 若此刻处于收纳态，先展开，确保错误可见
      els.status.textContent = msg;
      els.status.className = 'status err';
    },
    hide() { if (host) host.style.display = 'none'; },
  };
})();
