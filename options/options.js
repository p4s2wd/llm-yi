const LANGS = [['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский']];
const $ = (s) => document.querySelector(s);

async function init() {
  const stored = await chrome.storage.local.get('settings');
  const s = stored.settings || {};
  for (const [v, l] of LANGS) $('#targetLang').add(new Option(l, v));
  $('#baseUrl').value = s.baseUrl || 'http://localhost:8000/v1';
  $('#apiKey').value = s.apiKey || '';
  $('#model').value = s.model || 'qwen35-122b';
  $('#concurrency').value = s.concurrency || 3;
  $('#targetLang').value = s.targetLang || 'zh-CN';
  $('#bilingual').checked = !!s.bilingual;
  $('#autoLang').checked = s.autoTranslateNonTarget !== false;

  const save = async () => {
    const next = {
      baseUrl: $('#baseUrl').value.trim() || 'http://localhost:8000/v1',
      apiKey: $('#apiKey').value.trim(),
      model: $('#model').value.trim() || 'qwen35-122b',
      concurrency: Math.max(1, Math.min(8, Number($('#concurrency').value) || 3)),
      targetLang: $('#targetLang').value,
      bilingual: $('#bilingual').checked,
      autoTranslateNonTarget: $('#autoLang').checked,
    };
    await chrome.storage.local.set({ settings: next });
    $('#saved').textContent = '已保存';
    setTimeout(() => { $('#saved').textContent = ''; }, 1500);
  };
  document.querySelectorAll('input,select').forEach((el) => { el.onchange = save; });

  $('#test').onclick = async () => {
    $('#testResult').textContent = '测试中…';
    const r = await chrome.runtime.sendMessage({
      type: 'test-connection',
      baseUrl: $('#baseUrl').value.trim(),
      apiKey: $('#apiKey').value.trim(),
    });
    $('#testResult').textContent = r && r.ok
      ? '✔ 连接成功，可用模型:\n' + (r.models || []).join('\n')
      : '✘ 连接失败: ' + ((r && (r.error || r.status)) || '未知错误');
  };
}
init();
