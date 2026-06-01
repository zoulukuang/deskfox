feat-id: package-verify-script
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 落点

- 脚本:`packages/branding/scripts/verify-deskfox-package.sh`(对称 `build-deskfox.sh`)。
- **为什么放 branding/scripts 而非 media-gen/scripts**:它验的是**整个 .app 打包产物**(结构/身份/sidecar),不只 media-gen;跟 `build-deskfox.sh` / `build-media-gen-plugin.sh` 同目录,语义上是"打包配套工具"。

## 结构

- 参数 `-Env <dev|beta|prod>`(默认 prod),映射 `.app` 名 + 期望 Bundle ID(真相源 `tauri-overrides/<env>.json`)。
- `SCRIPT_DIR` → `REPO_ROOT` 自推导,**0 本机硬编码**(/tmp 原型版有 `/Volumes/ExtSSD` 硬编码,入仓前必须去掉)。
- A 层:`file`/`stat`/`PlistBuddy`/`xattr`/`grep` 文件级断言;catalog model id 从 `catalog.data.json` 提取逐个 grep。
- B 层:`opencode-cli serve 127.0.0.1:47821` 后台起,轮询日志 `listening on`(≤15s)→ curl 健康 → 扫 fatal/uncaught → kill;再 `bun import` plugin.js 验 ESM 可加载。
- `pass/fail` 计数,退出码 `fail==0 ? 0 : 1`。

## 决策

- **不内联 export PATH**:对齐 `build-deskfox.sh`,依赖调用环境(`~/.zshenv` 提供 bun/cargo),保持脚本干净可跨机。加 `command -v bun` 守卫友好报错。
- **不为这个 feat 再写单测**:它本身就是测试工具,"给测试脚本写测试"是套娃;以**实跑通过**为验证(prod 23/23)。R5 精神满足,changelog 记录实跑证据。
- **B 层 sidecar 用 serve 而非 --version**:serve 启 HTTP server 更能证明"真能跑"(进程不崩 + 端口活 + 日志干净),比 `--version` 冒烟更有信息量。
- **端口 47821 固定**:loopback 冒烟够用,跑完即 kill,不留监听。

## 取舍

- C 层 GUI 不做(见 1-spec)。若将来要补创作模式下拉的真桌面验证,走 `e2e-tauri-mac/` 新写 spec,而非塞进本脚本。
