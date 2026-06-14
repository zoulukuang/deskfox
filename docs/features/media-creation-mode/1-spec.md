feat-id: media-creation-mode
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec · 创作模式(media-creation-mode)

> 需求/架构/原型详见 `OPENCODE-PLAN/多模态创作模式/`(产品与架构方案.md / 模型填入机制-需求规格.md / prototype.html)。本 spec 只锁本仓实现侧的验收口径。

## 背景

REQ-030 第一竖切 `media-gen-alibaba` 已把阿里 7 能力做通,但触发方式是"AI 自动调工具"。2026-05-26 多轮迭代后 user 拍板**否决** AI 自动调,改为显式 **"创作模式"**:底部工具栏一个统一模式菜单(💬 Chat 默认 + 文生图/图片编辑/文生视频/图生视频/语音合成/语音识别/专业翻译),选哪个模式左侧 `Agent ▾ 模型 ▾` 原地换成 `类型 ▾ 生成模型 ▾`,输入即生成对应媒体。

## 验收标准

- 模式菜单:Chat + 各创作能力(能力按"已连供应商有可用模型"过滤);选模式后左侧出该能力的模型下拉(+ 语音合成出音色)。
- 发送拦截:创作模式下回车/发送走创作生成(不进普通聊天);Chat 模式一切照旧。
- ＋附图:图片编辑/图生视频把附件图(base64 data URL)作为参考图传给模型。
- 结果呈现:产出**落当前项目根 `creations/<分类>/`**;聊天流里给轻量卡(提示词 + 输入缩略图 + 小结果 + 「已保存:路径」+ 打开/文件夹),**融入聊天滚动流**(非独立区)。
- 样式:全用 DeskFox 既有 token + `@opencode-ai/ui` Select,不自创样式,跟随主题。
- 隔离:结果本地渲染,不写入 opencode session。

## 架构选型

- 前端 fork-frontend(prompt-input 注入)+ 模块级 store + 本地客户端;引擎复用 `packages/media-gen` 的 dispatch/registry(读 auth.json 需 node:fs → 走插件本地 `Bun.serve` 服务,R6 绑 127.0.0.1)。
- "无模型引导"交互已定稿(原型 prototype-空状态与引导.html),**本期不实现**,留待通用引擎架构一并做(见 `OPENCODE-PLAN/需求池/多模态创作-后续路线-通用引擎与自助配置.md`)。
