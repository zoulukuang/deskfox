feat-id: package-verify-script
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — 打包产物自动化验证脚本

## 需求

打完 DeskFox 完整包(`.app`/`.dmg`)后,需要一个**零 GUI、零焦点干扰**的一键自检,自动确认:
1. 包结构 / 二进制架构 / 三档身份(Bundle ID)/ Gatekeeper 状态都对;
2. 当期改进(媒体 catalog 数据内联)真进了包;
3. 包不是"文件齐全但跑不起来的空壳"—— sidecar 能真启动、plugin 能真加载。

## 背景

- Mac 是 WKWebView,**不支持 CDP `remote-debugging-port`**(那是 Windows WebView2 才有),所以 `packages/media-gen/scripts/cdp-catalog-verify.ts` 那套 GUI 自动验证在 Mac 跑不了。
- 项目已有的 Mac 端 GUI 黑盒 e2e(`e2e-tauri-mac/`)走 `osascript + cliclick`,**会占用 user 电脑、需辅助功能权限、且现有 specs 不覆盖 catalog**。
- 直接动因:`media-catalog-data-extract`(数据 TS 数组→内联 JSON)的运行时正确性,本质是"数据内联后能否正确加载",**不需要 GUI** 就能验证。把这类"无需 GUI 即可自动验证"的层固化成脚本,稳定 > 一切。

## 范围:A + B 两层(不做 C 层 GUI)

- **A 层 包完整性**:文件级断言,纯静态。
- **B 层 sidecar headless 冒烟**:真启动 `.app` 内 `opencode-cli serve` + plugin.js ESM 加载。
- **C 层 GUI 黑盒**(创作模式下拉肉眼级)**显式排除** —— 投入大、占用 user 电脑、测的还不是 prod 包,留给手动目视。

## 验收标准

1. `bash packages/branding/scripts/verify-deskfox-package.sh -Env prod` 对刚 build 的 prod 包全过,退出码 0。
2. 支持 `-Env dev|beta|prod` 三档,按档校验对应 `.app` 名 + Bundle ID。
3. **无任何本机绝对路径硬编码**(开源仓 + Win/Mac 双端;路径由 `SCRIPT_DIR` 自推导)。
4. 找不到包 / 缺 bun 时友好报错并以非 0 退出。
5. 0 改上游、0 R4。

## R8 测试用例清单(动工前列,逐条勾)

| # | 验什么 | 层级 | 预期 | 结果 |
|---|---|---|---|---|
| T1 | prod 包实跑全过 | CDP/运行时(脚本自身) | 退出 0,FAIL=0 | ✅ 23/23 |
| T2 | sidecar 真启动监听 + HTTP 响应(运行时·native 风险点) | 运行时 | listening + 2/3/4xx | ✅ |
| T3 | plugin.js ESM 真加载(bundle 不坏,运行时·native 风险点) | 运行时 | 导出非空 | ✅ MediaGenPlugin/default/server |
| T4 | 三档身份校验正确(prod=ai.deskfox.app 无后缀) | 静态 | Bundle ID 匹配 | ✅ |
| T5 | 找不到包时友好退出 | 静态 | 非 0 + 指引 build | 设计内置(if 前置) |
| T6 | 无本机硬编码路径 | 静态(review) | grep 无 /Volumes /Users 等 | ✅ SCRIPT_DIR 推导 |

> 运行时·native 风险点(T2/T3)已显式列入 —— 这正是"CDP 自测 ≠ 真桌面 QA"之外、能在 Mac 自动覆盖的运行时层。
