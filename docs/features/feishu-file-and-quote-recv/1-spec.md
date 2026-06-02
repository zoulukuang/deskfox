feat-id: feishu-file-and-quote-recv
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书桥接 — 接收文件内容(REQ-035)+ 接收引用回复原文(REQ-036)

> 合并开发分支:feat/feishu-file-and-quote-recv
> 两个需求同属"消息携带的额外内容没接住"一类,代码落点相同(message-pipeline.ts),合并发车节省分支管理成本。
> 规模:Medium(REQ-036 🟢 + REQ-035 🟡)

---

## 核心架构决策：插件 agent 兼容性

**用户补充需求**:不仅 DeskFox 自身配置的模型可以处理这两类消息,通过插件形式接入的模型(例如 claude-code plugin agent)也必须能正常使用。

**方案**:将文件内容和引用原文全部注入为 `parts[]` 里的 **text part**,而非写进 system prompt。

| 注入位置 | 是否到达所有 agent | 说明 |
|---|---|---|
| `parts[].text` (用户消息) | ✅ 所有 agent | promptAsync body.parts,任何 agent 都处理用户消息 |
| `body.system` (系统 prompt) | ⚠️ 可能被覆盖 | claude-code plugin 有自己的 CLAUDE.md system prompt |
| `body.model` (模型选择) | ⚠️ 插件 agent 可能忽略 | claude-code 用自己的模型选择逻辑 |

**结论**:内容注入在用户消息层,与 `account.agent` 取值(`imbot`/`build`/`claude-code`/任何 plugin agent)完全解耦。

---

## REQ-036: 接收引用/回复消息的被引原文

### 期望行为
- 用户「引用/回复」某条消息再发问 → bot 在上下文中能读到被引原文
- 私聊/群聊均生效;兼容 /new、@提及、chatQueue
- 取不到被引原文时 graceful 降级(不阻断主流程)

### 实现方案
1. `ImMessageEvent` 新增 `parentId?: string`(从飞书 `msg.parent_id` 提取)
2. `message-pipeline.ts` 新增纯函数 `fetchParentMessageText(parentId, larkClient)`:调 `larkClient.im.v1.message.get` 拿父消息,按 `msg_type` 解析文本
3. `handle()` 中检测 `event.parentId` → 拼注入 text:

```
[引用原文]
{quoted_text}
[/引用原文]

{用户当前消息}
```

### R8 测试用例清单

| # | 测试用例 | 层级 | 预期 |
|---|---|---|---|
| Q1 | `fetchParentMessageText` 父消息 msg_type=text → 返回文本内容 | Logic 单测 | 返回父消息 text 字符串 |
| Q2 | `fetchParentMessageText` 父消息 msg_type=post → 返回 flatten 后文本 | Logic 单测 | 返回 post 富文本拼接文本 |
| Q3 | `fetchParentMessageText` 父消息 msg_type=image → 返回占位符 `[图片]` | Logic 单测 | 返回 `[图片]` 降级占位 |
| Q4 | `fetchParentMessageText` 父消息 msg_type=file → 返回占位符 `[文件:xxx]` | Logic 单测 | 返回 `[文件:文件名]` 降级占位 |
| Q5 | `fetchParentMessageText` 飞书 API 报错(无权限/404) → 返回 null | Logic 单测 | 返回 null,caller graceful 降级 |
| Q6 | pipeline.handle() 含 parentId → runOpencode 收到的 text 含引用原文块 | 集成 e2e mock | text 包含 `[引用原文]...{quoted_text}...[/引用原文]` |
| Q7 | pipeline.handle() 含 parentId 但 fetchParent 失败 → 正常走下去(不阻断) | 集成 e2e mock | 用 original text 走通,不 throw |
| Q8 | pipeline.handle() 无 parentId → text 不含引用块 | 集成 e2e mock | text 不含 `[引用原文]` |
| Q9 | 引用非文本消息(图/文件)→ text 含占位符 `[图片]`/`[文件:xxx]` | 集成 e2e mock | graceful 降级文本出现在引用块内 |

---

## REQ-035: 接收文件内容(读取喂 Claude)

### 期望行为
- 私聊/群聊(@提及)发送文件 → bot 下载 → 抽取文本 → 作为上下文喂 Claude
- 回显「已读取《文件名》(N 字)」
- 不支持的格式/过大文件 → 友好提示,不阻断

### MVP 格式支持清单

| 格式 | 处理方式 | 依赖 |
|---|---|---|
| txt / md / csv / json / 常见代码后缀 | 直接 UTF-8 读文本 | 无(Bun native) |
| docx | unzip + word/document.xml XML 文本抽取 | `fflate`(pure JS zip) |
| pdf | 提示"请转成 txt/docx 后发送(PDF 解析二期)" | 无 |
| xlsx / pptx / 其他 | 友好提示"暂不支持" | 无 |

**设计说明**:PDF 暂 graceful skip 原因 —— 纯 JS PDF 解析库(pdf-parse 等)内部大量使用 `Buffer.isBuffer()`，与 Bun plugin bundle CJS 模式存在兼容风险(同 `reference_bun_plugin_form_data_trap.md` 教训)。二期专项处理。

### 注入格式

```
[文件《filename.docx》已读取,共 N 字]

{extracted_text}

{用户当前消息文字(如有)}
```

### 文件内容上限:20,000 字符（超出截断并提示）

### 实现方案
1. `ImMessageEvent` 新增 `fileKey?: string` + `fileName?: string`(从 msg.content 解析 `file_key`/`file_name`)
2. 新文件 `file-content-extractor.ts`:
   - `detectFileFormat(fileName)` → 返回 `"text" | "docx" | "pdf" | "unsupported"`
   - `extractTextFromBuffer(buf, format, fileName)` → `{ text: string; truncated: boolean }`
3. `message-pipeline.ts` 新增 `handleFileMessage()` 方法:
   - 接收 `file` msg_type 消息
   - 调 `larkClient.im.v1.messageResource.get` 下载
   - 调 `extractTextFromBuffer` 解析
   - 拼注入 text + `runOpencode`

### R8 测试用例清单

| # | 测试用例 | 层级 | 预期 |
|---|---|---|---|
| F1 | `detectFileFormat("readme.txt")` → "text" | Logic 单测 | 返回 "text" |
| F2 | `detectFileFormat("data.csv")` → "text" | Logic 单测 | 返回 "text" |
| F3 | `detectFileFormat("report.docx")` → "docx" | Logic 单测 | 返回 "docx" |
| F4 | `detectFileFormat("slides.pdf")` → "pdf" | Logic 单测 | 返回 "pdf" |
| F5 | `detectFileFormat("image.png")` → "unsupported" | Logic 单测 | 返回 "unsupported" |
| F6 | `extractTextFromBuffer` txt 格式 → 返回 UTF-8 文本 | Logic 单测 | 返回文件文本内容 |
| F7 | `extractTextFromBuffer` docx 样本 → 返回段落文本 | Logic 单测 | 正确抽取 word/document.xml 段落文字 |
| F8 | `extractTextFromBuffer` 超 20000 字 → 截断 + truncated=true | Logic 单测 | text 截断,truncated=true |
| F9 | `extractTextFromBuffer` pdf → 返回 null/skip 提示 | Logic 单测 | 返回 pdf graceful skip 提示文本 |
| F10 | `handleFileMessage` 文件消息 → runOpencode parts 含提取文本 | 集成 e2e mock | parts 中出现 `[文件《xxx》已读取...]` |
| F11 | `handleFileMessage` 下载失败 → 友好回复,不 throw | 集成 e2e mock | 发出"下载失败"提示,不崩溃 |
| F12 | `handleFileMessage` 不支持格式 → 友好回复 | 集成 e2e mock | 发出"暂不支持"提示 |
| F13 | handle() file msg_type 允许通过(不被 skip) | 集成 e2e mock | 不走 skip 路径 |

---

## 不做的事(边界)

- PDF 文本提取(二期,Bun bundle 兼容性需专项处理)
- xlsx / pptx 内容提取(三期)
- 图片型内容 OCR(另见 REQ-031,vision 同源)
- 文件内容的流式传输(大文件全量截断 20000 字)
- 多文件同时发送(MVP 单文件,多文件提示"请逐个发送")
