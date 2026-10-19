# Chrome 本地模型整页翻译扩展 — 设计文档

日期：2026-10-20 · 状态：已确认 · 目录：`/Users/shuang/code/ai/chrome`

## 1. 目标

做一个类似 Google 翻译官方插件的 Chrome MV3 扩展，用**可配置的本地模型**（当前为 vLLM 部署的 `qwen35-122b`）替代 Google 翻译服务。

**功能范围（已确认）**
- 整页翻译：点工具栏图标即整页译成目标语言，一键还原原文。
- 自动翻译规则：按语言、按站点自动整页翻译。

**明确不做**：划词/右键翻译、弹窗手动翻译、文档/图片翻译。

## 2. 已验证事实（实测，非假设）

- 端点：`POST http://localhost:8000/v1/chat/completions`，`Authorization: Bearer <key>` 可用。
- 模型 `qwen35-122b` 存在，后端 vLLM 0.32。
- `chat_template_kwargs: {"enable_thinking": false}` 生效（`reasoning_tokens: 0`）——**必须默认关闭思考模式**，否则延迟翻数倍。
- 小请求延迟 ~0.45s，批量整页翻译可行。
- 鉴权 key 由用户在设置页填入，不硬编码进仓库。

## 3. 架构（Manifest V3，纯静态无构建）

- `background.js`（service worker）：翻译引擎。接收内容脚本任务，管理并发队列、缓存、API 调用，按 tab 跟踪任务（切页/关闭即中止）。
- `content.js`：注入所有页面（`all_frames: true` 覆盖 iframe）。负责 DOM 遍历、分块、写回、MutationObserver 监听 SPA 新内容、注入页面工具条。
- `popup.html`：工具栏弹窗。显示/隐藏"翻译此页"、语言选择、"为本站自动翻译"开关。
- `options.html`：设置页。API 地址/key/模型、并发数、双语显示、默认目标语言、测试连接。
- `manifest.json`：`host_permissions: <all_urls>`（注入任意页 + 访问可配置 API）。

数据流：`content.js` 收集文本块 → 消息发给 `background.js` → 并发调 vLLM → 返回同序 JSON → `content.js` 写回 DOM。

## 4. 翻译引擎

- **分块**：按块级元素分组文本节点，单请求 ≤ ~1200 字符，每请求 5~15 段。
- **协议**：system prompt 要求"只输出同长度 JSON 数组"；解析失败重试 1 次并降级为逐段请求；跳过纯数字/代码/已是目标语言的段。
- **请求体**：固定带 `chat_template_kwargs: {enable_thinking: false}`、`temperature: 0.3`。
- **缓存**：`segment + 目标语言` 哈希 → 译文，存 `chrome.storage.local`（LRU 上限 3000 条），重复站点秒出。

## 5. 页面 UI（对齐 Google Translate）

- 页面左上角注入 closed shadow DOM 工具条：源/目标语言下拉、"显示原文/译文"切换、进度指示、关闭按钮。
- 错误态：API 不可达时工具条显示"翻译服务不可用 → 打开设置"。
- 双语显示为设置项（译文下方灰字附原文），默认关。

## 6. 自动翻译规则

- 语言级：检测到页面语言为 X 时自动整页翻译（默认：非中文全翻中文）。
- 站点级覆盖：`域名 → 永不翻译 / 总是翻译`，popup 一键设置。
- 语言检测：`<html lang>` + `chrome.i18n.detectLanguage` 正文采样。

## 7. 边界处理

- 跳过：`script/style/code/pre/textarea/input/[contenteditable]`、`translate="no"` 元素。
- SPA 动态内容：MutationObserver 防抖 800ms 增量翻译。
- 失败：单块重试 1 次后保留原文，工具条标"部分完成"。

## 8. 验证方式

- `chrome://extensions` 加载已解压扩展（无构建步骤，纯静态文件）。
- 附 2 个本地测试页（静态长文 + SPA 动态加载）验证整页/动态/还原。
- 设置页"测试连接"按钮验证 API。

## 9. 安全

- API key 仅存 `chrome.storage.local`，不进仓库、不进代码。
- `.gitignore` 忽略任何含密钥的本地文件。
