// 页面翻译工具条（closed shadow DOM）。与 content.js 共享 isolated world，
// 通过 globalThis.trToolbar 暴露命令式 API。
(() => {
  const LANGS = [
    ['auto', '自动检测'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'],
    ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'],
  ];
  let host = null, els = {}, cb = {};

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
      </style>
      <div class="bar">
        <select class="src"></select><span>→</span><select class="dst"></select>
        <button class="toggle">显示原文</button>
        <span class="status"></span>
        <button class="close" title="关闭">✕</button>
      </div>`;
    const q = (s) => shadow.querySelector(s);
    els = { src: q('.src'), dst: q('.dst'), toggle: q('.toggle'), status: q('.status') };
    for (const [v, label] of LANGS) els.src.add(new Option(label, v));
    for (const [v, label] of LANGS) if (v !== 'auto') els.dst.add(new Option(label, v));
    els.src.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.dst.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.toggle.onclick = () => cb.onToggleOriginal && cb.onToggleOriginal();
    q('.close').onclick = () => cb.onClose && cb.onClose();
    document.documentElement.appendChild(host);
  }

  globalThis.trToolbar = {
    show({ sourceLang = 'auto', targetLang = 'zh-CN', showingOriginal = false, onSwitchLang, onToggleOriginal, onClose } = {}) {
      ensure();
      cb = { onSwitchLang, onToggleOriginal, onClose };
      els.src.value = sourceLang;
      els.dst.value = targetLang;
      els.toggle.textContent = showingOriginal ? '显示译文' : '显示原文';
      els.status.textContent = '';
      els.status.className = 'status';
      host.style.display = '';
    },
    progress(done, total) { if (host) { els.status.textContent = `翻译中 ${done}/${total}`; els.status.className = 'status'; } },
    done() { if (host) els.status.textContent = ''; },
    error(msg) { if (host) { els.status.textContent = msg; els.status.className = 'status err'; } },
    hide() { if (host) host.style.display = 'none'; },
  };
})();
