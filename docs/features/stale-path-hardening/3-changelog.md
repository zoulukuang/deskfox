feat-id: stale-path-hardening
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

分支 `feat/stale-path-hardening`(从 `main/bbc990861`)。commit hash 待提交后回填。

## 改动文件

### 新 fork-only 文件(核心逻辑 + 单测)

| 文件 | 作用 |
|---|---|
| `packages/opencode/src/server/routes/instance/httpapi/handlers/ignore-path.ts` | REQ-067:`ignoreRelativePath` 大小写归一 + `safeIgnores` 防 `..` 抛错 |
| `packages/opencode/test/server/ignore-path.test.ts` | REQ-067 单测(8 测) |
| `packages/opencode/src/project/project-rebind.ts` | REQ-061:`isWorktreeConfirmedMissing` 三态判定 |
| `packages/opencode/test/project/project-rebind.test.ts` | REQ-061 三态单测(4 测) |
| `packages/desktop/src/main/fs-probe.ts` | REQ-068:`probePath` 路径存在性/可达性 + errno 分类 |
| `packages/desktop/src/main/fs-probe.test.ts` | REQ-068 probePath 单测(3 测) |
| `packages/app/src/pages/layout/startup-precheck.ts` | REQ-068:`decideStartupProject` 纯决策 |
| `packages/app/src/pages/layout/startup-precheck.test.ts` | REQ-068 决策单测(5 测) |

### 改上游(均带 FORK marker)

| 文件 | REQ | 改动 |
|---|---|---|
| `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts` | 067 | list handler `ignored` 改 `safeIgnores(ignoreRelativePath(...))` + import |
| `packages/opencode/src/project/project.ts` | 061 | `existingWorktreeMissing` 改用 `isWorktreeConfirmedMissing`(三态)+ import |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/project.ts` | 064 | update handler NotFound 时 `fromDirectory` 重解析现行 id 重试(自愈) |
| `packages/opencode/test/project/project.test.ts` | 064 | 加身份迁移 stale id 自愈集成测试 |
| `packages/app/src/pages/layout.tsx` | 068 | autoselecting 两条 openProject 前插 `ensureProjectAvailable` pre-check + import |
| `packages/app/src/context/platform.tsx` | 068 | `Platform.pathExists?` + `PathProbeResult` 类型 |
| `packages/app/src/context/server.tsx` | 068 | projects 加 `forget(directory)` |
| `packages/app/src/i18n/{en,zh,zht}.ts` | 068 | `project.path.{missing,unreachable}.{title,description}` |
| `packages/desktop/src/main/index.ts` | 068 | deps `pathExists` + import probePath |
| `packages/desktop/src/main/ipc.ts` | 068 | Deps 类型 + `ipcMain.handle("path-exists")` + 类型 import |
| `packages/desktop/src/preload/{index,types}.ts` | 068 | `pathExists` api 实现 + ElectronAPI 类型 + 类型 re-export |
| `packages/desktop/src/renderer/index.tsx` | 068 | platform `pathExists` 接线到 `window.api.pathExists` |

### 搭车修复(构建脚本,fork-only)

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/build-media-gen-plugin.ps1` | 补时间戳跳过(原与 feishu 不对称、每次重建)+ `bun run --silent` 避免 PS5.1 把 bun banner stderr 误判 NativeCommandError 中断打包。惠及所有 Windows 构建。 |

## 回归测试

- opencode:`ignore-path`(8)/`project-rebind`(4)/`project.test`(37,含 064 自愈)/`project-worktree-rebind`(2)全绿;typecheck 0 错。
- app:`startup-precheck`(5)/`i18n parity`/`rebrand` 全绿;typecheck 0 错。
- desktop:`fs-probe`(3)+ 全量 91 pass(1 既有失败 = Windows 跑 Linux electron-builder 配置断言,与本版无关);typecheck 0 错。
- 既有 `httpapi-file` 的 "serves search endpoints" 503 失败 = 本机 workspace-routing 既有环境性失败(stash 改动后仍失败),非本版引入。

## 集成验证(2026-06-25,local 版 win-unpacked + CDP 9223)

- **集成构建绿**:`OPENCODE_CHANNEL=local bun run build`(electron-vite,`out/main`+`out/preload`+`out/renderer` 含 IPC/layout 改动)+ `electron-builder --dir` 出 `DeskFox 本地版.exe`(231MB)全 exit 0。
- **冷启动健康检查绿**(CDP 探):readyState complete / 主 UI 渲染(9 body children,4 chrome 标记)/ **0 error toast** / **0 JS 异常** → main/preload IPC + layout pre-check 改动不破坏启动。
- **REQ-068 `pathExists` IPC 全链路真机验证绿**:`window.api.pathExists` 函数贯通(preload→ipc→main→fs-probe);存在目录→`{ok:true}`;不存在→`{ok:false,reason:"missing",code:"ENOENT"}`;**未映射盘符 `Z:\`→ENOENT/missing**(实证坐实版本计划迁移发现 §④「盘符未映射」模态 = ENOENT → 归 missing 分类)。
- 验证用 local 第 4 档(`ai.deskfox.app.local` + `opencode-local.db` 数据隔离),全程不碰 user 运行中的正式版。

### 真机 QA 通过(2026-06-25,local 版,CDP + sidecar HTTP)

- **REQ-068 目录删/改名模态 端到端 ✅**:注入失效 lastProject(`D:/__req068_missing_default_project__`)入 electron store → 冷重载 → 弹 error toast **「项目目录不存在 "…" 已被删除、改名或移动,请重新选择项目目录。」**(i18n + 路径插值正确)、失效项目**未被打开**(URL 停根路径,无静默空白/无 500)、lastProject **被 forget 清空**(`{}`)→ 下次启动不再自动加载死路径。
- **REQ-061 改名重绑 端到端 ✅**(对运行中打包 sidecar HTTP):打开 git 项目 A(worktree=`req061_A`)→ 磁盘改名 A→B → 用 B 路径打开 → **同一 project id `6149b5c3`,worktree 重绑 `req061_A`→`req061_B`**(M5 三态:旧 worktree ENOENT 判 missing → 重绑),`/session` + `/file/list` 均 **200(非 500)**,git id 保留记录跟随。
- **REQ-061 UI 侧栏显示新名 端到端 ✅**(CDP 读真实渲染层 DOM):项目 A 在侧栏时显示名 `req061_A`(基线)→ 杀 app 释放 A → 磁盘改名 A→B → 改 electron store 指向 B → 重启 → 侧栏 `data-project` 解码=`D:/tmp/req061_B`、aria-label/文本节点=**`req061_B`(新名)**、**无残留 `req061_A` 旧名** —— 直接证「侧栏显示旧名」症状根治。

## 待办(仍需 user / 桌面 / mac 的真机 QA)

- REQ-068 **网络盘掉线 / U盘拔出**模态(unreachable 分支,需物理硬件;missing 分支已端到端验、unmapped 盘符=ENOENT 已实证)。
- REQ-061 网络盘/U盘 offline 不误重绑(物理硬件)。〔UI 侧栏显示新名已端到端验通,见上〕
- REQ-067 **mac 端到端 500→200**(无 mac 验收机,挂 mac 借机/CI)。

## R4 黑名单 override(本季第 2 笔,user 2026-06-25 审批)

`packages/opencode/` 是上游核心包,整目录黑名单。本版 8 个文件命中(3 改上游 + 1 改既有测试 + 4 fork-only 新文件被路径误伤)。`[override-blacklist: REQ-067/061/064 修的是 opencode 核心内部逻辑(file.ts list handler 内联 ignored 计算 / project.ts 重绑守卫 / update handler 自愈),崩点均在上游内部无 wrapper 注入点;核心逻辑已最大化抽到 fork-only 新文件,新文件因放 packages/opencode/ 目录被路径黑名单误伤]`

逐文件 wrapper 不可行性:

| 文件 | wrapper 为何不可行 |
|---|---|
| `handlers/file.ts` | 崩点是 list handler 内联表达式 `ignored: ignored.ignores(path.relative(...))`,无中间件/注入点;最小改 = 1 import + 换表达式为 `safeIgnores(ignoreRelativePath(...))`,核心逻辑全在 fork-only `ignore-path.ts` |
| `project/project.ts` | 改的是**已有 `// FORK: REQ-061/064` 块**内重绑守卫一行(`orElseSucceed(()=>false)`→`isWorktreeConfirmedMissing`),修该 fork 自身 M5 三态隐患;判定逻辑抽到 fork-only `project-rebind.ts` |
| `handlers/project.ts` | update handler 是 effect 链,`catchTag` 自愈无 wrapper 注入点 |
| `test/project/project.test.ts` | 既有迁移测试旁加 064 自愈集成用例 |
| `ignore-path.ts` / `project-rebind.ts` + 2 `.test.ts` | fork-only 新文件、0 上游逻辑,路径黑名单误伤(同 v2026.8.3 precedent);移出会造 opencode core → fork 包反向依赖,更糟 |

风险低:每处 ≤ 数行、纯增量、均带 FORK marker、可单独 `git revert`;20 单测 + 集成 + 回归 + 冷启动健康 + IPC 真机验证全绿。配额:本季第 2 笔(v2026.8.3 首笔),在 ≤2/季 上限内。

## 回退方法

`git revert` 各 commit;或删 4 个新文件 + 还原 12 个上游文件的 FORK 注入段。各 REQ 改动相互独立、可单独 revert。
