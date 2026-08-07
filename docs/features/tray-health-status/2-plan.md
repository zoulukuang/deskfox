feat-id: tray-health-status
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/desktop/src/main/deskfox/tray-status.ts` | **新增(fork-only)**:`TrayIconKey` + `mapWatchdogStatusToTray(status)` 纯函数 + 三态文案常量 | 新文件 |
| `packages/desktop/src/main/deskfox/tray-status.test.ts` | **新增**:T2/T3 | 新文件 |
| `packages/desktop/src/main/deskfox/tray-icons.generated.ts` | **新增(脚本产物)**:6 个 base64 常量(3 态 × {彩色, mac template}) | 生成文件 |
| `packages/desktop/src/main/deskfox/tray.ts` | ① 模块级 `currentStatusLabel`,`buildMenu()` 读它;② `setTrayStatus(status)` 改成写变量 → 重建菜单 → `tray.setImage(...)`;③ 图标常量改从 generated 模块取 | 改 fork-only 文件 |
| `packages/desktop/src/main/deskfox/tray.test.ts` | **新增**:T1 bug-repro(mock `electron`) | 新文件 |
| `packages/desktop/src/main/index.ts` | watchdog `emit` 回调追加 `setTrayStatus(status)`(1–2 行) | 改 fork-only 段 |
| `packages/branding/scripts/gen-tray-icons.*` | **新增**:从源 SVG 生成三态 × 两模式 PNG + 写 `tray-icons.generated.ts` | 新脚本 |
| `packages/branding/src/assets/tray-icons/status/*.png` | **新增产物**:`ok/restarting/gave-up` × `color/template` | 资源 |
| `packages/branding/__tests__/tray-icons.test.ts` | **新增**:T4/T5 md5 差异断言 | 新文件 |

## 施工顺序

1. **先修 bug**:`tray.ts` 自覆盖 + T1 bug-repro 测试(修前红 → 修后绿)。单独可 commit(`[bug-repro: ...]`,fix 与测试同 commit,R5)。
2. `tray-status.ts` 纯函数 + T2/T3。
3. 图标生成脚本 → 产物 PNG + generated 模块 + T4/T5 md5 断言。
4. `tray.ts` 接图标(`setImage`)、`index.ts` 接线。
5. `bun turbo typecheck --filter='!./packages/console/*'`;`cd packages/desktop && bun test src/main/deskfox`;`cd packages/branding && bun test`。
6. 打**本地版**(`local` 渠道,**只杀本地版,不碰正式版/预览版**)→ 真机 T7/T8/T9。
7. 回填 3-changelog → 请示 commit。

## 决策轨迹

- **接线放主进程 emit 回调,不新增 IPC**:托盘与看门狗同在主进程,经 renderer 绕一圈只会引入"窗口已隐藏/已销毁时收不到"的新失败模式。renderer 的 toast 消费方(`sidecar-health.ts`)保持不动,两条消费互不影响。
- **图标继续走内联 base64,不改成运行时读文件**:`tray.ts` 现有注释明确写了这条(对齐 Tauri `include_image!`,运行时无文件 IO,dev/打包一致)。改成读文件要处理 `asar`/`resources` 路径分叉,风险远大于收益。因此生成脚本的产物是**一个 TS 模块**,不是让运行时去找 PNG。
- **生成期工具优先选不改 lockfile 的方案**:`packages/branding` 目前无 `@resvg/resvg-js` 依赖,加 dep 会动 `packages/branding/package.json` + **`bun.lock`(黑名单)** → 平白多一笔 R4 override。优先用**本机 Python + Pillow**(已在本机,12.2.0)在既有 32×32 基图上合成徽标(实心圆 / 挖洞感叹号),无仓库依赖变更;若必须从 SVG 重渲,退而用仓外 `OPENCODE-PLAN/品牌设计/_tools`(已有 resvg)产出 PNG 后再入仓。**判据:能不动 `bun.lock` 就不动。**
- **徽标用 alpha 挖洞而非白色描边**:mac `setTemplateImage(true)` 丢弃颜色,白色徽标会被抹成黑色 → 与 restarting 版 md5 一致、两态不可分。挖洞让差异落在 alpha 层,彩色/模板两模式都成立。T5 就是这条的机器化断言。
- **映射函数返 `undefined` 表示"不改托盘"**:与 `sidecar-health.ts` 里"无需弹 toast 则 undefined"的既有约定同形,`memory-pressure` 和未知状态天然走这条,不需要新分支。
- **`setTrayStatus` 签名从 `label: string` 改成 `status`**:现在唯一调用方是新接的 emit 回调(改前全仓无消费方),签名改造零破坏面;把"状态 → 文案/图标"的映射收进纯函数,`tray.ts` 只剩展示。

## 风险 / 回退

| 风险 | 评估 | 处置 |
|---|---|---|
| 三态图标缩到 16pt 后肉眼难辨 | 中(徽标小) | T9 人眼抽查是硬门槛;不合格就加大圆点/调位置重生成 |
| Windows 托盘表现与 mac 不同 | 中(Win 无 template 概念,走彩色) | T10 延后到 Win 端真机;延后则在 changelog 显式记未验 |
| `tray.setImage` 频繁调用闪烁 | 低(状态切换频率极低) | 仅在状态实际变化时 setImage(映射函数返回值与上次比对) |
| 熔断态用户看到"已放弃"但不知道怎么办 | 中(UX) | 菜单文案带可执行指引(如"请重启 DeskFox"),与 renderer toast 文案对齐 |
| 回退 | 改动集中在 fork-only 文件 | 分 2 笔 commit(bug fix / feat),各自可 revert(P4) |

## 待办追踪

- [ ] T1 bug-repro + 自覆盖修复
- [ ] `tray-status.ts` + T2/T3
- [ ] 图标生成脚本 + 产物 + T4/T5
- [ ] `tray.ts` setImage + `index.ts` 接线
- [ ] typecheck + desktop/branding 单测
- [ ] 真机 T7/T8/T9(macOS 本地版)
- [ ] T10 Windows(可延后,须记录)
- [ ] 回填 3-changelog → 请示 commit
