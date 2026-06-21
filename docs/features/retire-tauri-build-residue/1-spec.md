feat-id: retire-tauri-build-residue
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — 清退 Tauri 构建残留(脚本 + broken 测试 + tauri-overrides)

> ✅ **2026-06-21 user 口头审签(「A+B 都做,当前分支直接做」)→ 已实施完成,实际改动见 [3-changelog](./3-changelog.md)。** Medium 改动,1-spec 经 user 审签锁版。
> 分支:`chore/retire-tauri-build-scripts`。源起:Electron 迁移残留盘点 D 批「删旧 Tauri 脚本」的可行性研究。

## 背景:调研确认了两层问题,都真实存在

### 第一层 — 旧 Tauri 构建脚本是 Electron 链死代码(D 本体)
换基座(Tauri→Electron, 2026-06-15)后,下列脚本(~1527 行)被 `build-deskfox-electron.{sh,ps1}` 取代,**无任何运行时/构建调用**:

| 脚本 | 行数 | 状态 |
|---|---|---|
| `build-deskfox.sh` | 612 | 死代码(electron 脚本注释标「取代」,不 source/调用) |
| `build-deskfox.ps1` | 346 | 同上 |
| `pack-installer.sh` | 176 | 死代码(electron 链无 pack-installer,NSIS 走 electron-builder) |
| `pack-installer.ps1` | 159 | 同上 |
| `pack-preview-dev.sh` | 84 | **已自标 `[DEPRECATED]`**(L2「换 Electron 后作废,勿运行」) |

**证据(调研实测)**:
- 3 个非脚本/非测试引用(`dialog-settings.tsx` L30 / `media-gen/cdp-creation-xiaomi-all.ts` L11 / `electron-builder.deskfox.config.ts` L25)**全是注释**,无运行时调用。
- 配套脚本(`apply-icons` / `prepare-lo-bundle` / `verify-deskfox-package` / `deploy-updater-manifest` / `bump-installer-version` / `mirror-asset-to-gitee` / `upload-asset-to-oss`)对旧脚本的引用**全是注释/文档字符串**,无 source/调用。
- electron 链(`build-deskfox-electron.sh` L88/L150)**复用** `apply-icons.sh`/`prepare-lo-bundle.sh`/`bump-installer-version.*` —— 这些是新旧共用配套,**不删**,仅注释提了旧脚本名。
- **关键安全点:测试要求的全部 LO 保护逻辑,electron 脚本已有等价/更优实现**:
  - 缺 LO 发布物硬失败:`build-deskfox-electron.sh` L157-160 / `.ps1` L154-156
  - `--no-bundle`/Tier3 放行:sh L110/L221 / ps1 L53/L56
  - presets 非空硬卡:sh L148-151 / ps1 L144-149(比旧脚本更精准:presets 硬依赖 / extensions 仅警告)
  - post-build 验证最终包含 soffice + 非空 presets:两端 §5.5
  - NSIS 大小哨兵 → 迁到 `branding/smoke/verify.ts`(升级为 electron-updater 口径:latest.yml sha512 == exe 实算)

### 第二层 — 调研暴露的更紧急独立问题:换基座遗留 broken 测试
**`packages/branding/__tests__/updater-config.test.ts` 全环境 broken**(实测 `0 pass / 1 fail / 1 error`):
- 加载即崩:top-level `readFileSync(packages/desktop/minisign.pub)` —— 该文件 git 0 跟踪 + 不存在。
- 另读已删的 `packages/desktop/src-tauri/src/{constants,cli}.rs`(git 0 跟踪,上游 `b4147c8d08 consolidate` 移除)。
- 读 Tauri 时代 `packages/branding/tauri-overrides/{prod,beta,dev}.json`(3 文件仍在,Tauri updater 配置残留)。
- 最后改动在换基座**之前**(`feat: 启用自动升级`),换基座后无人更新。
- 它在 `test:ci`(= `bun test` 全跑)里 → **CI `bun turbo test:ci` 在 branding 包当前应是红的**(或被忽略),换基座守护的对象(tauri.conf updater pubkey / Rust 守卫)大部分已不存在。

## 该不该做:建议「做」,分两块(可一个 feat)

### 块 A(更紧急):修 broken 测试 updater-config.test.ts
判断「Tauri updater 配置守护」是否还需要、迁到哪:
- minisign 公钥守护现行载体 = `packages/desktop/minisign.pub`?(需确认换基座后公钥落点)+ electron-updater publish config。
- `tauri-overrides/{env}.json` 是否仍被任何链路读取?(若纯残留 → 连带清理)
- Rust 守卫(constants.rs UPDATER_ENABLED / cli.rs OPENCODE_DISABLE_AUTOUPDATE)已随 Rust 端删除 → 对应断言删除。
- 产出:要么**删**该测试(守护对象已不存在)、要么**重写**为 electron-updater 口径守护。

### 块 B:删 5 个旧脚本 + 迁测试 + 清注释
1. 删 `build-deskfox.{sh,ps1}` / `pack-installer.{sh,ps1}` / `pack-preview-dev.sh`。
2. `lo-bundle-strip.test.ts` 的 L96-170(8 个 test,针对 build-deskfox/pack-installer)**重写指向** `build-deskfox-electron.{sh,ps1}` + `verify.ts`(保护逻辑已等价存在,只换瞄准文件);L21-93(prepare-lo-bundle,新旧共用)**不动**。
3. 清 ~10 处配套脚本/代码注释里对旧脚本的过时引用(改指 electron 脚本或删过时步骤)。
4. 历史 docs(spec/plan/changelog/INDEX/installer-versions.md)**不回填**(历史快照)。

## 风险

- **低-中**。最大风险 = 测试迁移时误丢「防发不含 LibreOffice 坏包」的守护(有 bug-repro 背景)。缓解:逐项对照本 spec 的「保护等价矩阵」,electron 脚本已全有,迁移是换瞄准文件而非重写逻辑。
- 块 A 需先确认 updater 守护的现行载体,别盲删守护。

## 验收标准

- [ ] 5 个旧脚本删除;全仓 `grep` 无任何**代码层**活引用(注释清理干净)。
- [ ] `lo-bundle-strip.test.ts` 重写后全绿,且断言覆盖等价的 LO 守护(缺 LO 硬失败 / soffice 验证 / NSIS 哨兵)。
- [ ] `updater-config.test.ts` 修复后全绿(删 or 重写),CI `bun turbo test:ci` branding 包转绿。
- [ ] `tauri-overrides/` 残留判定:确认无引用则清理。
- [ ] typecheck 全绿 + branding 单测全绿 + pre-push 闸过。

## 待 user 决策点

1. **做不做?** 块 A(broken 测试,CI 红)建议至少做;块 B(删脚本)可选但收益高(清 1527 行死代码 + 消除 grep 噪音)。
2. **范围:** A+B 一个 feat,还是先做 A(紧急)、B 另排?
3. 确认后此 1-spec 签名锁版,进入 2-plan 实施。
