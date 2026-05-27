feat-id: media-creation-mode
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog · 创作模式

## 改动概要

把 media-gen 从"AI 自动调工具"改造成显式**创作模式**:底部统一模式菜单 + 左侧随模式变化的模型/参数 + 输入即生成,结果融入聊天滚动流、产出落当前项目根 `creations/`。fork-frontend + 本地生成服务,引擎复用 media-gen-alibaba。

## commit 列表(feat/media-gen-alibaba 分支)

| hash | 内容 |
|---|---|
| 73902adbd | 后端骨架 catalog/registry/dispatch + 8 单测 |
| 7dafe76a1 | 本地生成服务 /generate(SSE,端口 51737,R6) |
| d37367a1f | 前端客户端 media-creation(列模型 + SSE) |
| 65816fb72 | 创作模式 store(模块级单例) |
| 7b1c610f9 | UI:模式菜单 + 左侧随动 + send 拦截 + 结果渲染 |
| 991025f21 | 下拉对齐现有样式(去高度上限 + 显模型名) |
| 34096651b | 修回车误入聊天 + 菜单加宽 + 音色选择 + 改名(配音→语音合成/转写→语音识别) |
| 80fea5dee | 结果区加上限滚动容器(后被 a30f1f94c 取代) |
| 2da6b77b0 | ＋附件图传给图片编辑/图生视频 |
| a86f12b64 | 结果落盘分类文件夹 + /files 列表 |
| a0cda8680 | 轻量结果卡(提示词+输入缩略图+小结果+已保存路径+打开)+ 清附件 |
| 90808c616 | CDP 创作模式交互层自测脚本 |
| e026d0509 | 产出落盘改到当前项目根(而非全局 ~/.deskfox) |
| a30f1f94c | 结果卡从输入框上方独立条挪进聊天滚动流 |

## 影响范围

- 新增 fork-only:`packages/media-gen/src/{catalog,registry,dispatch,server,asset-save}.ts` + scripts(cdp-uxtest/gentest 等);`packages/app/src/components/media-creation-{store.ts,bar.tsx,results.tsx}` + `utils/media-creation.ts`。
- 改上游(FORK marker):`prompt-input.tsx`(注入 loadModels + 创作拦截 + 工具栏守卫)、`message-timeline.tsx`(结果卡挂载)、`session-composer-region.tsx`(早期挂载点,后移除)、`index.css`(模式菜单 scoped 样式)。

## 测试 / 回归

- media-gen 单测 28 pass(含 server/registry/dispatch/upload/capabilities)。
- CDP 真机端到端:模式切换、文生图生成、结果融入聊天流、产出落项目根 —— 全验通(数据层)。
- 视觉/原生交互由 user 真桌面 QA 确认无问题(2026-05-27)。
- 全仓 typecheck 17/17。

## 回退方法

`prompt-input.tsx` / `message-timeline.tsx` FORK 段可单独 revert(创作档守卫去掉即回纯 Chat);media-gen 新文件纯增量,删除不影响上游。本地服务端口 51737。

## 待办

无模型引导 UI + 通用引擎/Layer3/模型自助配置(见 `OPENCODE-PLAN/需求池/多模态创作-后续路线-通用引擎与自助配置.md`)。
