# local-test —— DeskFox 本地版构建/测试工具

本地版(`OPENCODE_CHANNEL=local`、appId `ai.deskfox.app.local`、数据隔离)做 GUI 真机验收时用的两个脚本。
都耦合 fork 构建产物(`packages/desktop/dist-deskfox/…本地版.app`、`packages/desktop/out/`、asar、`packages/app/vite.js` 的 channel),所以**就近放在 fork 里**(不在规划仓)。

## 何时用

改了渲染层(`packages/app`/`packages/ui` 的 UI)、要在**真·本地版 app** 上做真实触发验收(SOP 第 7 阶段)时。

## verify-running-build.sh —— 真实触发前置闸

证明你将要测的本地版.app **就是刚构建那个**,而不是过期包(防"在旧产物上报已验证":重打包静默失败 → `.app` 没更新 → 徽标还是旧的)。

```bash
bash packages/desktop/scripts/local-test/verify-running-build.sh
# exit 0 = 产物可信(asar 不旧于 out/、徽标 channel=local、确有进程加载该 asar);非 0 = 先修再测
```

## repack-local.sh —— 零联网快速重打包

只改了 JS、想快速出一个能测的新 `.app`:绕开 electron-builder(它每次联网、国内常 10 分钟超时静默失败),外科式把最新 `out/` 重打进 `app.asar`(纯 JS 进 asar、`.node` 进 unpacked)。

```bash
OPENCODE_CHANNEL=local bun run build              # 先出新 out/
bash packages/desktop/scripts/local-test/repack-local.sh   # 零联网重打 .app + 写 build stamp
bash packages/desktop/scripts/local-test/verify-running-build.sh   # 必须 exit 0
open "packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
```

## 配套(分布在别处)

- **L2/L3 GUI 测试本体**:`packages/app/e2e/`(regression mock harness + cdp 真机 harness)。
- **方法论 / 铁律 / SOP**:规划仓 OPENCODE-PLAN `协作方案/前端自动化测试-工具与方法论.md`、`协同方式SOP-模块交付流水线.md`。
- **会话 dump 工具**:全局 skill `dump-session`(`~/.claude/skills/`),跨项目通用、不绑 fork 构建。
