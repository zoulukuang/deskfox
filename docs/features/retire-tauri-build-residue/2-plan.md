feat-id: retire-tauri-build-residue
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 执行顺序(块 A + 块 B 一个分支)

1. **调研定边界**(动手前):确认所有"代码层活引用"性质 → 全是注释,无 source/调用;electron 链有等价 LO 保护;updater 安全守护现行载体 = `updater.ts`(electron-updater)+ `bridge-electron-updater.sh`(minisign 桥),与已删的 `minisign.pub`/`src-tauri/*.rs`/`tauri-overrides` 解耦。
2. **删 10 个文件**(块 A 5 + 块 B 5)。
3. **重写 `lo-bundle-strip.test.ts`**:守护对象迁到 electron 脚本 + verify.ts。
4. **清残留注释**(配套脚本/代码指向已删脚本的)。
5. **验证**:branding 全量测试 + 改过脚本 bash -n + typecheck。

## 关键决策

- **updater-config.test.ts → 删,不重写**:它守护的 Tauri updater 配置载体(`tauri-overrides` 的 pubkey / `src-tauri` Rust 守卫 / `minisign.pub`)换基座后均已不存在;electron updater 行为由 `packages/desktop/src/main/updater-controller.test.ts` 守护,公钥/签名由 electron-builder publish + `bridge-electron-updater.sh`(minisign)管。重写无对象可守 → 删除是正解。
- **tauri-overrides/*.json → 删**:全仓无任何**活链路**读取(bridge/deploy/desktop src 全空);仅 2 处注释引用(已随脚本名清理)。
- **lo-bundle-strip.test.ts 守护对象映射**(保护逻辑零丢失,只换瞄准文件):
  | 旧(已删脚本) | 新(electron 现行载体) |
  |---|---|
  | `build-deskfox.{sh,ps1}` 注入前 presets/extensions 校验 | `build-deskfox-electron.{sh,ps1}` presets 非空硬卡(精化:extensions 打包必丢空目录,降为警告) |
  | `build-deskfox.{sh,ps1}` 缺 LO 硬失败 + soffice 验证 | `build-deskfox-electron.{sh,ps1}` 发布物缺 LO 硬失败 + §5.5 post-build 验证 soffice+presets |
  | `pack-installer.{sh,ps1}` 发布闸 + NSIS 大小哨兵 | `smoke/verify.ts` L3 发布物校验(soffice.exe 存在 + latest.yml sha512==exe,electron-updater 口径) |
- **prepare-lo-bundle.{sh,ps1} 不删**:新旧共用配套,electron 链(`build-deskfox-electron.sh` L150)仍调用;其测试断言(L21-93)原样保留。
- **历史溯源注释保留**:`dialog-settings.tsx` L30 / `electron-builder.deskfox.config.ts` L25 解释「换基座前旧脚本有此逻辑、现已补回」的代码存在 why,提及已删脚本是正常历史引用,删了反丢失渊源 → 保留。
- **配套脚本注释**:`apply-icons`/`verify-deskfox-package`/`deploy-updater-manifest`/`prepare-lo-bundle`/`mirror-asset`/`upload-asset`/`bump-installer`/`media-gen cdp` 里指向已删脚本的注释 → 改指 `build-deskfox-electron.*` 或现行载体(`electron-builder.deskfox.config.ts` / `bridge-electron-updater.sh`)。

## 调研副产物:发现 updater-config.test.ts 全环境 broken(CI 红)

动手前跑 `bun test updater-config.test.ts` 实测 `0 pass/1 fail/1 error`(top-level readFileSync 已删的 `minisign.pub`),且它在 `test:ci`(=`bun test` 全跑)里 → CI branding 包此前一直红/被忽略。本 feat 删除后 CI 转绿。这是块 A 比块 B 更紧急的实证。
