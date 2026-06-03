feat-id: feishu-file-and-quote-recv
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志 — feishu-file-and-quote-recv

## Commit 1: REQ-036 引用/回复原文注入上下文

**commit**: `9e430f5a9`
**分支**: `feat/feishu-file-and-quote-recv`
**规模**: ~120 行净代码(+3 文件)

### 改动文件

| 文件 | 类型 | 改动说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/wss-client.ts` | 上游改 | `ImMessageEvent` 新增 `parentId?: string`,从 `msg.parent_id` 提取 |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | 上游改 | 新增 `fetchParentMessageText()` 导出纯函数 + `handle()` 引用上下文注入 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | fork-only | 新增测试 Q1-Q9(5 unit + 4 integration) |
| `docs/features/feishu-file-and-quote-recv/1-spec.md` | fork-only | R8 测试用例清单 + 架构说明 |

### 关键实现决策

- **注入位置**: `parts[]` user message text part(非 system prompt),所有 opencode agent 均可接收
- **格式**: `[引用原文]\n{quoted_text}\n[/引用原文]\n\n{user msg}`
- **graceful 降级**: `fetchParentMessageText` 任何失败返 null,不阻断主流程
- **时机**: slash command 早退之后、`runOpencode` 之前(懒惰拉取,避免 /new 等命令无谓 API 调用)

### 测试结果
659 → 688(含本笔 29 新增)全通过,typecheck clean

---

## Commit 2: REQ-035 接收文件消息读取文本内容

**commit**: `6050a9bd8`
**分支**: `feat/feishu-file-and-quote-recv`
**规模**: ~350 行净代码(+3 文件)
**override-blacklist**: `bun.lock` — 新增 fflate 依赖必然修改,无 wrapper 替代方案

### 改动文件

| 文件 | 类型 | 改动说明 |
|---|---|---|
| `packages/adapter-feishu-lark/package.json` | fork-only | 新增 fflate 0.8.2 依赖 |
| `bun.lock` | 自动生成 | bun install 后 lockfile 更新(override-blacklist) |
| `packages/adapter-feishu-lark/src/feishu/file-content-extractor.ts` | fork-only(new) | 文件格式检测 + 文本抽取纯函数 |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | 上游改 | 新增 `handleFileMessage()` + `downloadFileBuffer()` + 消息类型门控加 file |
| `packages/adapter-feishu-lark/src/feishu/__tests__/file-content-extractor.test.ts` | fork-only(new) | 24 单测覆盖 F1-F9 + stripDocxXml |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | fork-only | 新增 F10-F13 集成测 |

### MVP 格式支持

| 格式 | 处理方式 |
|---|---|
| txt/md/csv/json/常见代码扩展名 | UTF-8 直读(TextDecoder) |
| docx | fflate unzip + word/document.xml XML 文本抽取 |
| pdf | graceful skip + 引导转 txt/docx(Bun bundle 兼容风险,二期) |
| 其他 | friendly "暂不支持" 提示 |

### fflate 选型理由(vs PDF 原因)

- `fflate` 使用 `Uint8Array` 而非 `Buffer`,绕开 Bun bundle CJS `Buffer.isBuffer()` 兼容问题
- PDF 纯 JS 解析库(如 pdf-parse)大量依赖 `Buffer`,与 Bun plugin bundle 存在已知兼容风险(见 `reference_bun_plugin_form_data_trap.md`)

### 关键实现决策

- **下载**: Bun-native `fetch()` + AbortController(30s 超时),同 image-downloader 模式
- **格式早退**: 不支持的格式在下载前判断,避免无谓网络请求
- **进度反馈**: 下载前发 `📄 收到文件《filename》,读取中...`(飞书文件较大,防 user 以为无响应)
- **内容截断**: MAX_TEXT_CHARS=20000,超限截断并标注
- **agent-agnostic**: 文件内容注入为 user message text part,与 agent 类型无关

### 测试结果
全量 688 tests pass,typecheck clean

---

---

## Commit 3: REQ-035 磁盘存储 + 注入格式升级 + MAX_TEXT_CHARS 50k

**commit**: `be11111fa`
**分支**: `feat/feishu-file-and-quote-recv`
**规模**: ~108 行净代码(4 文件)

### 改动文件

| 文件 | 类型 | 改动说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/file-content-extractor.ts` | fork-only | MAX_TEXT_CHARS 20000→50000 + 注释更新 |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | 上游改 | `downloadFileBuffer`→`downloadAndSaveFile`(加 chatId/fileName 参数,磁盘写入);新增 `formatFileSize/getFormatDisplay` helpers;`handleFileMessage` 注入格式升级;PDF 路径:下载保存→直接回复(zero LLM token);`PipelineOptions` 加 `feishuFilesRoot` 字段 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/file-content-extractor.test.ts` | fork-only | 描述字符串同步 50k |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | fork-only | F10 断言含"已保存"+"路径:";F12b 改用 fetch mock + 验路径信息;buildFilePipeline 传 feishuFilesRoot 隔离 tmpDir |

### 关键实现决策

- **磁盘路径**: `{feishuFilesRoot}/{safeChatId}/{YYYYMMDD}-{safeFileName}` — chatId/fileName 中 `/\\:*?"<>|` 替换为 `_`
- **txt/docx 注入格式**:
  ```
  [文件《report.docx》已保存]
  路径: /...feishu-files/oc_xxx/20260603-report.docx
  大小: 45KB | 格式: DOCX

  文件内容(共 N 字):
  {extracted_text}
  ```
- **PDF 处理**: 下载保存 → 直接回 `路径+大小+格式(PDF，内容提取暂不支持)` — 不调 LLM
- **unsupported 保持原样**: 早退"暂不支持",不下载
- **`feishuFilesRoot` 选项**: 单测传 tmpDir 隔离,生产走 `IMBOT_WORKSPACE/feishu-files`

### 测试结果
688 tests pass(全量),typecheck clean

---

## 回退方法

三笔均可独立 `git revert`:
- `git revert be11111fa` — 回退磁盘存储 + 注入格式升级
- `git revert 6050a9bd8` — 回退 REQ-035 文件接收(内存版)
- `git revert 9e430f5a9` — 回退 REQ-036 引用回复

影响范围:仅 `adapter-feishu-lark` 包,不影响主程序 / UI / 其他插件。
