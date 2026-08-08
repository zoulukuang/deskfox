feat-id: tray-health-status
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志 — REQ-099 托盘反映后台健康状态

**规模**:Medium(新增 3 文件 + 生成物 + 2 测试文件,改 fork-only 文件 3 处)
**分支**:`feat/small-cost-cleanup-batch`
**commit**:`cc7d688025`(branding 图标生成 + 产物)+ `d94720afb4`(desktop 接线 + 修 bug)
> 拆两笔:pre-commit §4.2 的 500 行阈值(base64 产物 + 测试),且两半天然可分别 revert(P4)。
**R4 override**:**不需要** —— `packages/desktop/`(除 `src-tauri/` 子路径)与 `packages/branding/` 均不在 pre-commit 黑名单

## 实际改动

| 文件 | 改动 | 行数(约) |
|---|---|---|
| `packages/desktop/src/main/deskfox/tray-status.ts` | 新增(fork-only):`TrayIconKey` / `TrayStatusView` / `TRAY_STATUS_READY` / `mapWatchdogStatusToTray` 纯函数 | +36 |
| `packages/desktop/src/main/deskfox/tray-status.test.ts` | 新增:7 测(3 态映射 + 互不相同 + memory-pressure/未知值 + 原型链 key) | +45 |
| `packages/desktop/src/main/deskfox/tray-icons.generated.ts` | 新增(脚本产物):3 态 × 2 模式 base64 常量 | +18 |
| `packages/desktop/src/main/deskfox/tray.ts` | 修自覆盖 bug(模块级 `currentStatusLabel`/`currentIcon`,`buildMenu()` 读它)+ `buildIcon(key)` 抽出 + `setTrayStatus(status)` 改签名并同时换图标 + `__resetTrayStateForTest` | ±60 |
| `packages/desktop/src/main/deskfox/tray.test.ts` | 新增:5 测(含 T1 bug-repro) | +80 |
| `packages/desktop/src/main/index.ts` | watchdog `emit` 回调追加 `setTrayStatus(status)`;import 加 `setTrayStatus` | +6 |
| `packages/desktop/test/electron-mock.ts` | 全局 mock 补 `Tray` / `Menu` / `nativeImage` / `crashReporter` / `netLog`(按该文件维护说明) | +40 |
| `packages/branding/scripts/gen-tray-icons.py` | 新增:三态图标生成脚本(Pillow,在既有 32×32 基图上合成徽标) | +150 |
| `packages/branding/src/assets/tray-icons/status/*.png` | 新增产物 6 张(`{ok,restarting,gave-up}-{color,template}.png`) | — |
| `packages/branding/__tests__/tray-icons.test.ts` | 新增:5 测(尺寸 / 彩色 md5 / template md5 / **template alpha 通道** / 生成物与内联常量一致) | +120 |

## 修了什么 bug

`setTrayStatus` 原实现先写 `statusItem.label`,紧接着 `tray.setContextMenu(buildMenu())`;而 `buildMenu()` 从模板重建、status 项 label **写死 `"状态:就绪"`** 并重新给 `statusItem` 赋值 → 刚设的文案当场被覆盖。这个"预留接口"不是没人调,是**调了也没用**。

**bug-repro 实证**:把 `buildMenu()` 的 `label: currentStatusLabel` 临时改回写死值,`tray.test.ts` 5 测中 **3 测转红**;恢复后全绿。

## 影响范围

- 主进程托盘:图标 + 菜单状态文案现在跟随看门狗状态;`memory-pressure`(memory-brake 另一条线,同 IPC 通道)与未知值走 `undefined` 分支 → 不改托盘。
- renderer 侧原有 toast 消费方(`packages/app/src/utils/sidecar-health.ts`)**零改动**,两条消费互不影响。
- 图标常量来源从 tray.ts 内联 base64 改为 generated 模块;运行时仍无文件 IO(性质不变)。

## 回归测试

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | 22/22 ✅ |
| `packages/desktop` 全量 `bun test src/main` | **160 pass / 0 fail**(基线 148,新增 12) |
| `packages/branding` 全量 `bun test` | **52 pass / 0 fail** |
| T1 bug-repro 反证 | 撤掉修复 → 3 fail ✅ |

## 真机端到端(macOS,local 渠道,2026-08-07)

打包 `bash packages/branding/scripts/build-deskfox-electron.sh -Env local --no-bundle`,
产物 `packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app`,带 `--remote-debugging-port=9222` 启动。
**全程只杀本地版**(`pkill -f "DeskFox 本地版.app/Contents/"`),user 的正式版一直在跑、未受影响(截图里两只狐狸并存可证)。

| 用例 | 手法 | 结果 |
|---|---|---|
| T7 重启态 | kill 本地版 sidecar(按端口 + 父进程校验,确保不误杀正式版)→ 看门狗 3 次失败(~15s)判死 | ✅ `utility.log`:`status changed { status: 'restarting', label: '状态:后台服务重启中…', icon: 'restarting' }` |
| T7 恢复 | respawn healthy | ✅ `status changed { status: 'ready', ... icon: 'ok' }`(约 1.2s 后) |
| T8 熔断 | 连续秒杀 6 次(每次间隔 20s,落在 120s 窗口内) | ✅ `too many restarts in window, giving up { restarts: 5 }` → `status changed { status: 'gave-up', label: '状态:后台服务已停止,请重启 DeskFox', icon: 'gave-up' }` |
| T9 视觉 | 菜单栏密集采样截图(restarting 窗口仅 ~1.2s) | ✅ 时间轴三帧:就绪(纯狐狸)→ 狐狸+实心圆点 → 就绪;熔断后截图为狐狸+挖洞感叹号,缩到菜单栏尺寸肉眼可辨 |
| T10 Windows | — | ⏸ **未验**,Win 端排期时补(彩色图标已生成入库) |

> 人眼抽查在**浅色蓝底菜单栏**下完成;深色菜单栏未单独截图,但 template 图标由系统自动反色、alpha 差异已由 T5' 机器断言覆盖。

## 回退方法

`git revert <commit>`。改动集中在 fork-only 文件,回退后托盘恢复为"固定图标 + 固定文案"的旧状态(含旧 bug),不影响看门狗自身与 renderer toast。

## 备注 / 后续

- 图标重新生成:`python3 packages/branding/scripts/gen-tray-icons.py`(幂等,自带三态差异断言)。徽标几何参数(`BADGE_CENTER` / `BADGE_R` / `MOAT_R` / 感叹号矩形)集中在脚本顶部,想调大小改常量重跑即可。
- 未做(1-spec 已声明):开机自启 / 静默常驻(REQ-027 补丁 4/5)、周期性预防重启、`memory-pressure` 接托盘。
