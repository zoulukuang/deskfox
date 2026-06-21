feat-id: retire-tauri-build-residue
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 规模

Medium。**删 10 个 Tauri 残留文件(1735 行)** + 重写 1 个测试 + 清 ~10 处配套注释。0 改上游、0 R4、0 产品运行时逻辑变化(改的代码文件均为注释)。

## 删除文件(10 个,1735 行)

**块 A — broken 测试 + DEPRECATED 脚本 + tauri-overrides 残留:**
| 文件 | 删因 |
|---|---|
| `packages/branding/__tests__/updater-config.test.ts` | **全环境 broken**(readFileSync 已删的 `minisign.pub`/`src-tauri/*.rs`);守护对象=Tauri updater 配置已不存在,electron updater 由 `updater-controller.test.ts` 守护 |
| `packages/branding/scripts/verify-updater-artifacts.ts` | 已自标 `[DEPRECATED]`(Tauri updater 产物校验),无活调用(`verify.ts` 仅注释提及) |
| `packages/branding/tauri-overrides/{prod,beta,dev}.json` | Tauri `tauri build` 注入的 updater/appId 配置;换 Electron 后无任何活链路读取 |

**块 B — 旧 Tauri 构建脚本(被 `build-deskfox-electron.*` 取代):**
| 文件 | 行数 |
|---|---|
| `build-deskfox.sh` / `build-deskfox.ps1` | 612 / 346 |
| `pack-installer.sh` / `pack-installer.ps1` | 176 / 159 |
| `pack-preview-dev.sh` | 84(已自标 `[DEPRECATED]`) |

## 改写文件

- **`packages/branding/__tests__/lo-bundle-strip.test.ts`**:守护对象从已删脚本迁到 electron 现行载体(`build-deskfox-electron.{sh,ps1}` + `smoke/verify.ts`),**保护逻辑零丢失**(映射见 2-plan)。prepare-lo-bundle 部分(L21-93)原样保留。重写后 18 pass(原 20,合并等价断言)。

## 清理注释(指向已删脚本/tauri-overrides → 改指 electron 现行载体)

`apply-icons.{sh,ps1}` / `verify-deskfox-package.sh` / `deploy-updater-manifest.sh` / `prepare-lo-bundle.{sh,ps1}` / `mirror-asset-to-gitee.sh` / `upload-asset-to-oss.sh` / `bump-installer-version.ps1` / `media-gen/scripts/cdp-creation-xiaomi-all.ts`。

**刻意保留**(历史溯源 why,非操作指引):`dialog-settings.tsx` L30 / `electron-builder.deskfox.config.ts` L25 解释「换基座前旧脚本有此逻辑、现已补回」。

## 验证

- branding 全量测试:**47 pass / 0 fail**(删 broken 的 updater-config 后 → **CI `bun turbo test:ci` branding 包转绿**)。
- `lo-bundle-strip.test.ts`:18 pass(LO 守护等价覆盖)。
- 6 个改过的 `.sh` 脚本 `bash -n` 语法全过。
- typecheck:branding + media-gen + app **3/3 successful**。
- 全仓核验:代码层(.ts/.tsx/.sh/.ps1,排除 node_modules/dist)对已删脚本/tauri-overrides 仅剩 2 处刻意保留的历史溯源注释。

## 影响范围

- 无产品运行时变化(改的代码文件均注释);纯构建工具链 + 测试 + 文档残留清理。
- 修复了一个此前未被发现的 broken CI 测试(updater-config)。

## commit

本笔 commit:`chore(retire-tauri-build-residue): 删 10 个 Tauri 残留文件 + 迁测试守护 [feat: retire-tauri-build-residue]`(含 1-spec/2-plan 已先行 commit `7da780ae21`)

## 回退

`git revert` 本 commit 即恢复 10 个文件 + 测试 + 注释。无运行时状态。注:被删脚本均为 Tauri 死代码,恢复后亦不应被 electron 链调用。
