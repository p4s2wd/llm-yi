const LANGS = [['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский']];
const $ = (s) => document.querySelector(s);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings || {};

  for (const [v, l] of LANGS) $('#target').add(new Option(l, v));
  $('#target').value = settings.targetLang || 'zh-CN';
  $('#target').onchange = () =>
    chrome.storage.local.set({ settings: { ...settings, targetLang: $('#target').value } });

  let page = { translated: false };
  try { page = (await chrome.tabs.sendMessage(tab.id, { type: 'popup-get-state' }, { frameId: 0 })) || page; } catch {}
  $('#status').textContent = page.pageLang ? `页面语言: ${page.pageLang}` : '无法检测页面语言';

  const btn = $('#action');
  btn.textContent = page.translated ? '显示原文' : '翻译此页';
  btn.onclick = async () => {
    try {
      if (page.translated) await chrome.tabs.sendMessage(tab.id, { type: 'popup-restore' });
      else await chrome.tabs.sendMessage(tab.id, { type: 'popup-translate', targetLang: $('#target').value });
      window.close();
    } catch {
      $('#status').textContent = '此页面无法翻译';
    }
  };

  const domain = tab.url ? new URL(tab.url).hostname : '';
  const sites = (await chrome.storage.local.get('sites')).sites || {};
  if (!/^https?:/.test(tab.url || '')) $('#site').disabled = true;
  $('#site').value = sites[domain] || '';
  $('#site').onchange = async (e) => {
    const next = { ...sites };
    if (e.target.value) next[domain] = e.target.value;
    else delete next[domain];
    await chrome.storage.local.set({ sites: next });
  };

  $('#settings').onclick = () => chrome.runtime.openOptionsPage();
}
init();
