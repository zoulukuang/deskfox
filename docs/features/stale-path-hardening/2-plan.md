feat-id: stale-path-hardening
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

分支:`feat/stale-path-hardening`(从 `main/bbc990861` 起,2026-06-25)。

## 实施顺序与落点

1. **REQ-067(防御兜底 + 单测)** — backend,自包含先做
   - 新 `packages/opencode/src/server/routes/instance/httpapi/handlers/ignore-path.ts`:
     - `ignoreRelativePath(base, target)`:`path.relative` 产 `..` 时,按段大小写不敏感剥 base 前缀、保留 tail 原始大小写;真逃逸原样返回。
     - `safeIgnores(ig, p)`:`..` 开头或 `ignores()` 抛错时降级为 `false`(不忽略),杜绝 500。
   - `file.ts:93-95` 改用 `safeIgnores(ignored, ignoreRelativePath(...))`。
   - 单测 `test/server/ignore-path.test.ts`:复现 posix `../x/.git` 崩点 + 断言改法后 `.git`/`node_modules` 仍命中、不抛。

2. **REQ-064(自愈落地)** — backend handler
   - `handlers/project.ts` update:`apply(URL旧id)` 失败(`Project.NotFoundError`)→ `InstanceState.context.directory` → `svc.fromDirectory(dir)` 拿现行 id → `apply(现行id)` 重试;仍失败才映射 HTTP NotFound。
   - 确认 `UpdatePayload` 不含 directory(SDK directory 仅路由 query),directory 经 `InstanceState.context` 取,无需改 schema。
   - 集成测试:project.test.ts 加身份迁移后 stale id 自愈用例。

3. **REQ-061(M5 三态)** — backend service
   - 新 `packages/opencode/src/project/project-rebind.ts`:`isWorktreeConfirmedMissing(exists)` —— exists 成功 false→missing(true);成功 true→false;**失败→保守 false(不重绑)**。
   - `project.ts:278-288` 重绑守卫改用该 helper(替换原 `orElseSucceed(()=>false)` 双重否定 + 吞错误的隐患)。
   - 单测 `test/project/project-rebind.test.ts`:三态全覆盖(含 EBUSY/ENXIO/ETIMEDOUT/EPERM 失败一律不重绑)。

4. **REQ-068(启动 pre-check)** — frontend + desktop IPC(最大块)
   - desktop IPC `pathExists`(走既有 `checkAppExists` 同构链路):
     - 新 `packages/desktop/src/main/fs-probe.ts`:`probePath(target)` → `{ok}` / `{ok:false,reason:"missing"|"unreachable",code}`(ENOENT/ENOTDIR=missing,其它=unreachable)。
     - `main/index.ts` deps + `main/ipc.ts` Deps 类型 & `ipcMain.handle("path-exists")` + `preload/types.ts` 类型 + `preload/index.ts` 实现 + `renderer/index.tsx` platform 接线。
   - `app/context/platform.tsx`:`Platform.pathExists?` + `PathProbeResult` 类型。
   - `app/context/server.tsx`:projects 加 `forget(directory)`(仅当 lastProject===该目录时清)。
   - 新 `app/pages/layout/startup-precheck.ts`:`decideStartupProject(probe)` 纯决策(open/skip+forget/skip)。
   - `app/pages/layout.tsx`:autoselecting 在两条 openProject 前插 `ensureProjectAvailable`(missing→forget+error toast / unreachable→error toast / ok→放行 / 无探测→fail-open)。
   - i18n:en/zh/zht 加 `project.path.missing.*` / `project.path.unreachable.*`(其余 locale fallback en)。
   - 单测:`startup-precheck.test.ts`(决策四态)+ desktop `fs-probe.test.ts`(真实 fs errno 分类)。

## 测试矩阵(R8,逐条可勾)

| 用例 | 层级 | 文件 | 验什么 | 状态 |
|---|---|---|---|---|
| 067 posix `../x/.git` 崩点前提 | unit | ignore-path.test.ts | 原始 ignore 确会抛 RangeError | ✅ |
| 067 归一返回干净 tail | unit | ignore-path.test.ts | `.git`/`node_modules` 不带 `..` 仍命中 | ✅ |
| 067 真逃逸不崩 | unit | ignore-path.test.ts | safeIgnores 降级 false 不抛 | ✅ |
| 061 三态 | unit | project-rebind.test.ts | ENOENT→重绑 / present→不 / 出错→不 | ✅ |
| 064 自愈 | integration | project.test.ts | 迁移后旧 id 404 → fromDirectory 重解析 update 成功 | ✅ |
| 068 决策四态 | unit | startup-precheck.test.ts | ok/missing/unreachable/undefined | ✅ |
| 068 probePath errno | unit | fs-probe.test.ts | 存在→ok / 不存在→missing(ENOENT) | ✅ |
| 068 四模态冷启动引导 | e2e/真机 | — | 目录删/改名/盘符未映射/U盘拔出 → 引导无裸 500 | ⏳ 真机 QA |
| 061 改名重加 + offline 不误重绑 | e2e/真机 | — | NTFS 真机 | ⏳ 真机 QA |
| 067 mac 端到端 500→200 | e2e | — | mac 大小写不敏感卷 | ⏳ mac 借机/CI |

## 决策轨迹 / 踩坑

- **Effect 平台 `fs.exists` 语义实证**(决定 061 三态可行性):读 `effect@4 src/FileSystem.ts:732` 确认
  `exists = access |> as(true) |> catchTag(PlatformError, NotFound→false : else fail)` —— ENOENT 返 false、其它 errno fail。
  故三态成立:成功 false=确切不存在,失败=检查出错保守不重绑。
- **REQ-064 directory 来源**:`UpdatePayload` 不含 directory(SDK 的 directory 是 `WorkspaceRoutingQuery` 路由参数),
  但 handler 可经 `InstanceState.context.directory` 拿当前 instance 目录 → 无需改 schema 即可自愈,比版本计划预估的「先接线 directory 进 schema」更轻。
- **`Effect.either` 在 effect@4 非 pipeable**(踩坑):集成测试断言失败用 `.pipe(Effect.either)` 报 `args[0] is not a function`,
  改 `.pipe(Effect.exit)` 断言 `_tag==="Failure"`。
- **i18n 只需补 en**(类型/parity 约束实证):`t` 的 key 类型源自 `en`,非 en locale `{...base, ...locale}` 缺 key 自动回落 en,
  parity 测试只校验特定 key → 只须加 en(必需)+ zh/zht(中文用户体验),不必改 18 个 locale。
- **PS5.1 NativeCommandError 构建踩坑**:`build-deskfox-electron.ps1` 的 media-gen 子构建 `bun run build.ts` stderr 被 PS5.1
  包成异常中断 → 先用 Bash 在 `packages/media-gen` 跑 `bun run build` 让 wrapper 跳过子构建(同 CLAUDE.md 验证约定)。

## 单文件 / 改上游清单(R2 FORK marker)

- 改上游(均带 FORK marker):`file.ts`、`project.ts`(handler + service)、`layout.tsx`、`platform.tsx`、`server.tsx`、
  `desktop main/index.ts`、`main/ipc.ts`、`preload/index.ts`、`preload/types.ts`、`renderer/index.tsx`、i18n `en/zh/zht.ts`。
- 新 fork-only 文件:`ignore-path.ts`(+test)、`project-rebind.ts`(+test)、`startup-precheck.ts`(+test)、`fs-probe.ts`(+test)。
- 新增行数 : 改上游行数 ≫ 3:1(核心逻辑全在新文件,上游全是 1-数行注入)。
