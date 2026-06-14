---
feat-id: media-gen-alibaba
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 多模态生成 — 阿里全能力适配(第一竖切) — spec

> **完整需求 / 架构论证**见跨 feat 规划 [`OPENCODE-PLAN/需求池/多模态生成-通用plugin框架.md`](../../../../OPENCODE-PLAN/需求池/多模态生成-通用plugin框架.md)(REQ-030),尤其 §0 架构评审修订 + §0.4/§0.5 阿里能力实测矩阵。本 spec 只摘本竖切的需求与验收。

## 触发原因

user 要"在 opencode/DeskFox 填好 provider API Key 后,图片/视频/语音生成开箱即用,不用单独装 MCP/写 prompt 触发"。REQ-030 决定走 opencode plugin 路径(不动 fork 核心),并先以**阿里(DashScope / 通义万相)** 打通全流程,验证可行后再接第二家抽通用层。

## 用户故事

| 角色 | 想做什么 | 验收 |
|---|---|---|
| 非编码用户 | 已连阿里供应商,聊天里说"画一只橘色狐狸" | AI 自动调工具 → 30-60s 出图,内嵌显示 |
| 同上 | "把这段话翻成英文" / "把这段文字转语音" | 调翻译/语音合成工具,秒级返回 |
| 同上 | "做一段狐狸奔跑的视频" | 1-3 分钟返回 mp4 链接 |
| 同上 | @提及本地录音"识别成文字" | 本地文件自动上传 → 返回识别文字 |
| 同上 | @提及本地图片"把背景换成绿色" | 调改图工具 → 背景正确替换、对象保留 |

## 验收标准

- [x] 6 大能力 API 全部实测打通:文生图(标准/高清)/ 图生图(改图)/ 文生视频 / 图生视频 / 翻译 / 语音合成 / 语音识别(见 3-changelog 模型矩阵)
- [x] AI 按意图自动调用对应工具(强工具模型如 Claude 下稳定)
- [x] 本地文件输入(音频/图片)自动处理:ASR 走 OSS 上传;改图走 base64
- [x] 失败有中文友好提示(审核驳回/额度/鉴权/超时)
- [x] 0 改上游(R1);新功能全在 `packages/media-gen` 新包
- [x] 单元测试覆盖核心逻辑;真厂商端到端人眼验过
- [x] 编译成 `dist/plugin.js`,DeskFox 边车可加载;user 桌面确认 6 能力可用

## 架构选型(摘 REQ-030 §2 + §0)

- **决策 A**:走 opencode plugin 的 `tool` 注册,**不动** fork 核心(`provider.ts` BUNDLED_PROVIDERS)。plugin 系统无 hook 能替代 chat language model,但 `tool` + `ctx.metadata` 足以实现"AI 自动调多媒体工具 + 进度心跳",且 upstream 怎么改都不影响。
- **决策 B**:UX 走"AI 智能编排"(说"画图"→AI 自动 tool call),不做"模型下拉直选"(那条必须改 fork 核心)。
- **决策 C(本竖切修订)**:**先竖切打穿阿里一家、不提前抽象**;通用层等接第二家(minimax)时从两份真实代码的重复里抽出(REQ-030 §0.1 第 1 条)。
- **MVP 边界**:不碰 Rust(下载/上传纯 JS;插件边车进程调不到 Tauri 命令)、不做 OSS 链接持久化(直接显示厂商公网链接)、`/media` 命令兜底留后续。

## 不做什么(本竖切)

- ❌ 不动 opencode 核心 / 不发 npm 包
- ❌ 不做"模型下拉直选"UX
- ❌ 不做图片持久化(OSS 链接 24h 过期,隔天 404,留二期)
- ❌ 不做拖拽/粘贴附件直接改图(需读 session attachment parts,留 follow-up;当前 workaround:@提及文件)
- ❌ 不做 `/media` 显式命令兜底(留抽象那一刀一起)
