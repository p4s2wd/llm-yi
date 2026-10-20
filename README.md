# Local LLM Translate

Chrome MV3 整页翻译扩展，翻译后端为可配置的 OpenAI 兼容 API（默认 vLLM qwen35-122b）。

## 安装
1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选本目录。
2. 点扩展图标 → 设置 → 填 API 地址（含 /v1）、Key、模型名 → 测试连接。

## 使用
- 打开任意英文页面自动整页翻译（可在设置/popup 调整规则）。
- 页面左上角工具条：切换语言、显示原文/译文、关闭。
- popup：手动翻译/还原、目标语言、本站总是/永不翻译。

## 开发
- 单元测试：`npm test`（engine/ 纯逻辑，node --test）。
- 人工验证：`python3 -m http.server 8080 -d test-pages` 后访问
  http://localhost:8080/static-article.html 与 spa-dynamic.html。
- 改代码后需在 chrome://extensions 点扩展的"重新加载"。

## 注意
- API key 只存 chrome.storage.local，不写文件不进 git。
- 翻译请求必须关思考模式（engine/api.js 已固定 enable_thinking:false）。
