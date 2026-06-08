---
feat-id: lo-bundle-macos
status: done
related: ./1-spec.md ./3-changelog.md
---

# 3-changelog — lo-bundle-macos

## Commit 1: macOS LO bundle 适配基础实现

**commit**: (待填)
**分支**: `feat/lo-bundle-macos`
**规模**: ~150 行净代码(3 文件改 + 1 新增)

### 改动文件

| 文件 | 类型 | 改动说明 |
|---|---|---|
| `packages/opencode/src/file/office-installer.ts` | fork-only（黑名单误伤）| `bundledSofficePath()` 加 darwin 分支;`detectSofficePath()` 和 `status()` bundled 检测加入 darwin |
| `packages/branding/scripts/build-deskfox.sh` | fork-only | 步骤 1.9:检测 LO bundle 存在性,条件注入 Tauri `--config` resources |
| `packages/branding/scripts/prepare-lo-bundle.sh` | fork-only 新增 | macOS bundle 准备脚本:下载 25.8.7 DMG → 挂载 → 剥皮 → 清除签名 |
| `docs/features/lo-bundle-macos/1-spec.md` | 文档新增 | |

### 关键设计决策

- **版本**: LO 25.8.7 Still 稳定线,与 Windows 保持一致(同一个 `LIBREOFFICE_VERSION` 常量)
- **bundle 路径**: `DeskFox.app/Contents/Resources/libreoffice/` = LibreOffice.app 重命名后放入 Tauri resources
- **soffice 路径**: `../Resources/libreoffice/Contents/MacOS/soffice`(相对于 sidecar execPath `Contents/MacOS/opencode-cli`)
- **条件打包**: build-deskfox.sh 检测 bundle 目录,存在则追加 `--config JSON` 给 Tauri;不存在则降级(warning + 正常 build)
- **签名策略**: prepare 脚本清除 LO 原有签名 → Tauri prod build 统一重签整个 .app
- **剥皮策略**: 同 Windows(help/gallery/template/autocorrect/wordbook/basic/xslt/presets/wizards/JDK)

### R4 override 论证（`office-installer.ts` 黑名单）

同 Windows lo-bundle 的 override 论证:该文件是 fork 新建 office→PDF 功能(上游 opencode 无此文件),黑名单按 `packages/opencode/` 路径前缀系统性误伤。改动 = 2 处新增 `process.platform === "darwin"` 条件 + `bundledSofficePath()` 新增 darwin 分支;不改核心检测/转换逻辑,可单独 revert。本季连续同类误伤(第 4 笔)。

### 测试结果

- typecheck 17/17 通过
- E1/E2/E3/E4 自动/脚本验证通过;E5 用户真桌面 QA 通过 2026-06-03

## Follow-up 1: LO 签名缺 allow-jit entitlement 修复(REQ-050,2026-06-06)

**commit**: (待填)
**分支**: `fix/macos-lo-jit-entitlement`
**规模**: Tiny(+1 flag / 1 文件)
**tag**: `[bug-repro: signed LO soffice missing allow-jit -> SIGABRT on Office preview]`

### 症状

签名版 Mac 上整个 Office 预览(Word/Excel/PPT)全崩。根因:LO 内 `soffice` 跑在 hardened runtime(`--options runtime`)下却**缺 `com.apple.security.cs.allow-jit`** → UNO 桥建 vtable 时 JIT 被内核拒 → SIGABRT。

### 根因

Commit 1 的"签名策略"假设(`prepare 脚本清除签名 → Tauri 统一重签整个 .app`)不成立 —— Tauri 只签 `Contents/MacOS/`,不覆盖 `Resources/` 子树。后续在 `build-deskfox.sh` §2.5 补了 post-build LO 签名段,但 **steps 1-3 的 LO 内层签名(`--deep`)漏传 `--entitlements`**;step 4 外层 re-seal 虽带 entitlements 却不带 `--deep`,碰不到 LO 内层 executable。结果 soffice 永远拿不到 allow-jit。

### 修复

`build-deskfox.sh` steps 1-3 的 LO `codesign` 加 `--entitlements "$ENTITLEMENTS"`,让 `--deep` 把 allow-jit 刷进 LO 所有嵌套可执行文件。复用既有 `entitlements.plist`(已含 allow-jit)。

| 文件 | 类型 | 改动 |
|---|---|---|
| `packages/branding/scripts/build-deskfox.sh` | fork-only | steps 1-3 LO 签名加 `--entitlements`(+1 flag + FORK marker 注释) |

### 验证(复现测试)

实测断言(不重 build,直接对现有 `target/release/.../DeskFox.app` 的 LO 跑修复后命令):

- 修复前:`codesign -d --entitlements - soffice` → **空**;`flags=0x10000(runtime)` → 崩溃条件成立
- 修复后:soffice entitlements 含 `com.apple.security.cs.allow-jit`;CodeDirectory size 322→450、hashes 3+3→3+7(entitlements 已写入);runtime flag 保留
- 外层 re-seal 后 `codesign --verify --deep --strict DeskFox.app` ✅ 签名链完整;soffice allow-jit 保留(外层不带 --deep 不覆盖内层,正确)
- 待补:用户真桌面 QA — 双击 .app 开 Office 预览不崩(Mac 运行时无 CDP,靠手测)

## Follow-up(bug-repro):剥皮删 presets 致新用户首启 "User installation could not be completed"

**分支**: `research/lo-user-installation-macos`
**commit**: (待填)
**规模**: Tiny — 2 脚本各去 1 行删除项 + 1 新增测试文件
**起源**: Windows 2026.7.0 发版后用户截图报 `LibreOffice 25.8 - Fatal Error: The application cannot be started. User installation could not be completed.`。顺线排查 macOS 是否同病。

### 根因

`prepare-lo-bundle.{sh,ps1}` 把 `presets/` 列进剥皮删除清单**整删**。但 `presets/`(autotext/basic/config/database/gallery,~200KB)是 LibreOffice **首次为新用户创建 user profile(UserInstallation)的初始模板源**,整删 → bootstrap 阶段初始化失败 → 该 fatal error(`--headless` 下仍弹窗,因失败早于 headless 生效)。

与 2026-06-03 已修的 `extensions` 同类(profile bootstrap 硬依赖)。**extensions 修复只解决一半**:`presets` 是残留真因,这解释了为何 Win 2026.7.0 在 extensions 修复后仍复现。**两端同病同因**(两脚本删除清单都含 presets)。

### 复现 + 锁定(macOS 实测,三组对照)

直接调打包 bundle 的 `soffice`,完全照搬产品命令行参数(`libreoffice.ts`)+ 全新隔离 `-env:UserInstallation` profile:

| 实验 | 配置 | 结果 |
|---|---|---|
| B 复现 | 剥皮 bundle + 全新 profile | ❌ `User installation could not be completed`,exit 77 |
| A 对照 | 原始完整 LO(挂缓存 DMG)+ 同参数 + 全新 profile | ✅ exit 0,产出 PDF |
| C 锁定 | 剥皮 bundle **+ 加回 presets** + 全新 profile | ✅ exit 0,产出 PDF |

A 排除参数/环境因素,C 单一变量锁定 `presets`。修复后重跑 `prepare-lo-bundle.sh`(presets 保留)+ ad-hoc 签名(模拟 build-deskfox 签名;arm64 未签名二进制内核 SIGKILL,与 profile 错误无关)+ 全新 profile → exit 0,产出 PDF。

### 改动文件

| 文件 | 类型 | 改动 |
|---|---|---|
| `packages/branding/scripts/prepare-lo-bundle.sh` | fork-only | STRIP_DIRS 去掉 `presets` + 说明注释 |
| `packages/branding/scripts/prepare-lo-bundle.ps1` | fork-only | `$stripFolders` 去掉 `presets` + 说明注释(BOM 保留) |
| `packages/branding/__tests__/lo-bundle-strip.test.ts` | fork-only 新增 | 静态防回归:断言两脚本删除清单不含 presets/extensions、extensions 走留骨架(8 测,无需 soffice) |

### 回归测试

`bun test --cwd packages/branding` → 21 pass(含新增 8 测)+ typecheck 干净。

### 落地链路(待办)

- **Mac 端**:改完脚本须重跑 `prepare-lo-bundle.sh` 重做 bundle(已做,presets 保留 ✅)→ 下次 build / 发版即带修复。
- **Win 端**:同事须同样重跑 `prepare-lo-bundle.ps1` 重做 bundle(本机无法验证,fix-by-symmetry,同根因同 presets 内容)→ 重新打包发版。
- **回退**:把 `presets` 加回各自删除清单即恢复(纯增删行,可单独 revert)。

### Follow-up(code-review):防回归测试接入 CI

code-review(high)指出:新增的 `lo-bundle-strip.test.ts` 当时**未接入任何自动闸** —— CI(`test.yml` 跑 `bun turbo test:ci`)只含 `opencode` + `app`,pre-push 只跑 media-gen/adapter-feishu-lark/app,branding 包无 `test:ci` 脚本 → 守护形同虚设(注释却自称"CI 可跑"),正是本 bug「extensions 修一半又复发」的同款陷阱(防护没真生效)。修:

| 文件 | 改动 |
|---|---|
| `packages/branding/package.json` | 加 `"test:ci": "bun test"` 脚本 |
| `turbo.json` | 注册 `@opencode-ai/branding#test:ci`(无 `^build` 依赖,纯静态读文件) |
| `lo-bundle-strip.test.ts` | 注释订正:说明已接入 turbo test:ci |

验证:`bun turbo test:ci --filter=@opencode-ai/branding` 真跑到本测试(21 pass)。

### Follow-up(机制化:冷启动 smoke gate)— feat-id `lo-bundle-coldstart-smoke-gate`(2026-06-08)

**复盘结论**:presets/extensions 这类 profile bootstrap 硬依赖被剥皮删掉,**根本机制问题**是「剥皮后没人验证冷启动还能不能起」——打包机有热 profile(`~/Library/Application Support/LibreOffice` / `%APPDATA%\LibreOffice\4` 已存在)测不出,干净用户机才暴露。原防回归测试是**黑名单**(只认 presets/extensions 两个名字),换个目录名同样的坑会再踩。本次从机制上根治,设三道闸:

| 闸 | 文件 | 机制 |
|---|---|---|
| **打包闸(核心)** | `prepare-lo-bundle.sh` / `.ps1` | 剥皮后**强制冷启动 smoke test**:用全新空 `-env:UserInstallation` 真跑一次 `--convert-to pdf`,产不出 PDF 即 `exit 1` / `throw`,残缺 bundle 根本产不出。**不认目录名、只认行为** → presets/extensions/未来任意必需目录,任何破坏冷启动的过度剥皮当场暴露。 |
| **打包闸(build 侧)** | `build-deskfox.sh` / `.ps1` | LO 注入前校验 bundle 含 `presets/` + `extensions/`,缺任一即中止 → 挡"fix 前的过期/过度剥皮 bundle"流入打包。 |
| **测试闸(CI)** | `lo-bundle-strip.test.ts` | 扩展:除原黑名单断言外,再断言两 prepare 脚本含 smoke gate(`-env:UserInstallation`+`--convert-to`+失败中止)、两 build 脚本含完整性校验 → 防有人删闸。 |

**macOS 实测**(2026-06-08):
- 正向:`prepare-lo-bundle.sh` 重跑 → `smoke OK`,exit 0,bundle 规范态(presets 保留 + 签名移除)。
- 负向:故意删 presets → 冷启动无 PDF → 确认 gate 会 `exit 1` 拦截(双向验证)。
- `bun test --cwd packages/branding` 25 pass(+4 新)+ bash -n 语法 OK + build 完整性校验正向通过 + typecheck 干净。

**macOS smoke 实现要点**:arm64 未签名/改签二进制被内核 SIGKILL → smoke 前 `codesign --force --deep --sign -` ad-hoc 签名让其可启动,随后既有"签名移除"步骤清掉(恢复 Tauri 重签的规范态);profile 用全新空目录 + `file://` 绝对路径。

**Win 端待同事验证**(本机无 pwsh,ps1 未跑过):`.ps1` smoke 用 `soffice.com`(控制台变体阻塞)+ `Start-Process` `WaitForExit(120s)` 超时 kill 防失败时模态 fatal-error 框挂死;`build-deskfox.ps1` 完整性校验对称。需在 Windows 上跑 `prepare-lo-bundle.ps1` 确认正/负路径。

**回退**:三道闸都是独立追加块,可单独 revert,不影响 presets 主修复。

### Follow-up(code-review 加固 + 全链路出货稳健性)— 2026-06-08

第二轮 code-review(high)+ user 强调"打包和发布稳健性、绝不静默掩盖"后的加固:

**A. smoke 闸自身加固(prepare-lo-bundle)**:
- **`.sh` 加 `SAL_USE_VCLPLUGIN=svp`**:冷启动失败时 soffice 错误走 stderr 而非弹模态 Cocoa fatal-error 框(否则模态框阻塞脚本 + 在开发者屏幕弹窗)。**不是掩盖** —— smoke 照样判失败(无 PDF → exit 1)、照样回显 soffice 真实报错到日志,只是不弹阻塞框。
- **`.sh` 超时改主进程轮询**(`kill -0` + `sleep 1`,120s 兜底强杀):macOS 无 GNU timeout;原 `( sleep 120; kill ) &` 看门狗子 shell 继承脚本 stdout、孤儿 sleep 占管道 fd 致下游等满 120s + 残留进程 → 改主进程轮询根治。
- **`.sh`/`.ps1` soffice 输出存盘 + 失败回显**:定位真实错因,不再只给通用消息。
- **`.ps1` 修 Start-Process 数组参数空格拆裂**:PS5.1 `-ArgumentList @(...)` 不给含空格元素加引号,`$env:TEMP` 含空格(`C:\Users\My Name\...`)会拆裂路径参数 → 改手动给含空白参数包引号拼单条命令行。

**B. 全链路出货稳健性(对应 3-tier:Tier1 prod / Tier2 dev preview = 发布物;Tier3 `--no-bundle` raw exe = 本机自测)**:
- **闸 1 出货硬失败**(`build-deskfox.{sh,ps1}`):原 LO bundle 缺失走 else **只 warning 后继续出"不含 LO"的包** = 静默降级(用户 office 退回首次下载、常失败)。改为:**出真包(非 `--no-bundle`)缺 LO → 硬失败 `exit 1`/`throw`**;仅 `--no-bundle`(Tier3 raw exe 自测)允许跳过。
- **闸 2 打包后验证**(`build-deskfox.sh`,mac):build 成功后验证最终 `DeskFox.app/Contents/Resources/libreoffice/Contents/MacOS/soffice` 存在且可执行,挡"输入 bundle 健康但 Tauri 没把 LO 注入最终包"。缺则 exit 1。

**验证**(mac 实测):smoke 正向 OK 秒退(svp 无弹框)+ 负向(删 presets)失败回显 soffice 日志 + exit 1 不挂;gate1 挪走 bundle 跑 `-Env prod` → 1.9 段 exit 1 不进 tauri build;branding 28 测全过(+3 闸守护)+ bash -n OK。

**Win 端待同事验证**:`.ps1` 的 svp 不适用(Windows 非 svp 后端,靠 WaitForExit 超时兜底);**闸 2 Windows 打包后验证留同事 follow-up**(本机无 pwsh + 拿不准 Tauri 在 Windows 的 resource 输出路径,不本机猜路径硬塞以免给同事 build 引入误失败)。

### Follow-up(发布闸:pack-installer 权威把关)— 2026-06-08

**起因**:核对调用链发现 build-deskfox 的 `--no-bundle` 判据**在 Windows 不可靠** —— Windows 发布流程本身就用 `-NoBundle`(Tauri 不自己打包,交 pack-installer 做 NSIS;见 `release-deskfox.yml`),所以 build-deskfox 自己分不清"发布的 -NoBundle"和"Tier3 本地测试的 -NoBundle",那条路 LO 缺失会漏过 build-deskfox 的闸。

**真判据**:走没走 **`pack-installer`** —— 它是 Tier1/2 发布唯一入口(脚本头明确"Tier3 不走本脚本"),与 `-NoBundle` 无关。故把权威发布闸放这里:

| 闸 | 文件 | 机制 |
|---|---|---|
| **发布闸(权威)** | `pack-installer.{sh,ps1}` | 脚本最前(bump 版本号前)校验 LO bundle 源存在 + 含 presets/extensions,缺则 `exit 1`/`throw` → 绝不出不含 LO 的发布包,也不浪费版本号。两平台一致、不受 `-NoBundle` 影响。 |

build-deskfox 的闸(按 --no-bundle)保留做**纵深防御**(Mac 发布走 pack-installer→build-deskfox 无 --no-bundle,闸正确触发;Win 即使 build-deskfox -NoBundle 漏过,pack-installer 兜底)。

**3-tier 对照(最终)**:Tier1 prod / Tier2 dev preview = 走 pack-installer = **LO 必须**(发布闸硬把关);Tier3 `--no-bundle` raw exe = 不走 pack-installer = **LO 可选**(本机自测)。**完全符合 user 要求:稳定版+预览版同样检测必须含 LO,本地测试版不需要。**

**验证**(mac 实测):挪走 bundle 跑 `pack-installer.sh --no-bump` → bump 前 `exit 1`;bundle 在位 → 放行。branding 31 测全过(+3 发布闸守护)。Win 端 `pack-installer.ps1` 待同事验证。
