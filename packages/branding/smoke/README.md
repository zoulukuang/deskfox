# DeskFox 全量冒烟测试系统(CDP 驱动)

> [fork-only] 长期复用。目的:很多 bug(供应商点连接整屏崩、Office/PDF 预览空白)只有
> "真去点一遍"才暴露,单测 / 类型检查 / "代码在不在" 都抓不到。本系统连上正在运行的
> DeskFox(CDP 9222),系统化把【每个供应商连接弹窗 / 每个面板 / 每个设置页 / 文件树里
> 每种类型的文件预览】点一遍,捕获 渲染崩溃 / 未捕获异常 / console.error,出一张问题清单。
> [feat: smoke-test-system] 2026-06-13

## 前置

1. DeskFox dev 版在跑,且开了远程调试端口:`--remote-debugging-port=9222`。
2. Python 依赖:`pip install websocket-client`。

## 跑

```bash
# 全量扫描(boot/providers/panels/settings/files)
python packages/branding/smoke/smoke.py

# 只跑某几个 probe(不 reload,保留当前界面状态)
python packages/branding/smoke/smoke.py --only providers,files --no-boot
```

产出(同目录,已 gitignore,属一次性扫描工件):
- `smoke-report.md` — 人读问题清单(崩溃 / 警告 / 跳过 / 通过)
- `smoke-report.json` — 结构化结果(供后续程序化处理)

## probe 一览

| probe | 测什么 | 抓哪类 bug |
|---|---|---|
| `boot` | reload 后启动健康 + 启动期 console 报错 | 启动崩溃 / 启动期异常 |
| `providers` | 设置→提供商,逐个点「连接」开弹窗 | GetBot 那类**点连接整屏崩溃** |
| `panels` | 标题栏开关(侧边栏/文件树/审查/状态/新建会话) | 面板切换崩溃 |
| `settings` | 逐个切设置页(通用/快捷键/服务器/提供商/模型/飞书桥接) | 设置页渲染崩溃 |
| `files` | 文件树里可见的各类型文件逐个打开,断言"渲染出内容" | Office/PDF/HTML 那类**预览空白** |

## 判定口径

- **崩溃(crash)**:停在 `error.tsx` 全屏错误页(有「重启」按钮)或 `Runtime.exceptionThrown`。
- **警告(fail)**:动作没崩,但断言不过(弹窗没开 / 文件预览空白 / 伴随 console.error)。
- 文件预览断言:pdf/office→需要 `<canvas>`(pdf.js 画布);图片→`<img>` 已解码;html→`<iframe>`;
  md/代码/文本→有内容或 `<diffs-container>`。

## 设计约束(改这套时必读)

- **只用 CDP 真实输入**(`Input.dispatchMouseEvent` 点击 / `dispatchKeyEvent` 按 Esc),
  **绝不用 JS 合成键盘事件**——2026-06-13 用合成 Ctrl+, 开设置时按键漏进输入框,在真实会话里
  误触发了一次对话。优先用 DOM 坐标点击(找元素 → 取坐标 → CDP 点)。
- 每个 probe 自洽:自己打开所需界面、跑断言、用 Esc 收尾;崩了就 reload 复位再继续下一项。
- 与冷启动健康检查([[reference_cold_start_health_check]] 在 OPENCODE-PLAN/诊断工具/)互补:
  那个查启动时序,这个查交互面的"真去点"。

## 待扩展(后续迭代)

- `files` 目前只覆盖文件树里**当前可见**的叶子文件;要全类型覆盖,需切到固定测试 fixtures 项目
  并展开子文件夹(见 samples 思路)。
- `providers` 目前覆盖热门 + 列表可见项;全量 35+ 供应商需走"查看全部"弹窗再逐个点。
- 可加:命令面板(Ctrl+K)、模型选择器、创作模式、终端面板等 probe。
