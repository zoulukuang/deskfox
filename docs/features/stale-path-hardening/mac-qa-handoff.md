feat-id: stale-path-hardening
status: pending-mac-qa
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# mac 端 QA 交接清单(stale-path-hardening)

> **给 macOS 端同事 / agent**:本分支 `feat/stale-path-hardening` 的开发 + Windows 本机能验的真机 QA 已全部完成
> (见 `3-changelog.md`「真机 QA 通过」段)。**剩下 2 项只能在 macOS 上验**(物理硬件 / mac-only 现象),
> Windows 这台机器做不了 → 交接给你。代码已随分支上传,拉下来打 local 版即可照下面步骤验。
>
> **前置**:`git checkout feat/stale-path-hardening`(含 commit `a3a73fabe` 主修复)→ 打 mac local 版
> (规范 §5.3 裸命令:`OPENCODE_CHANNEL=local bun run build` + `electron-builder --mac --dir`,Mac wrapper 暂未集成 local)。
> 两项各自独立,做完把结果填回本文件「结果回填」段 + 勾掉 `3-changelog.md` / 版本计划对应待办。

---

## 待办 1 ·【REQ-067】mac 大小写不敏感卷 文件树 500→200(mac-only,Windows 不复现)

**背景**:macOS 默认 APFS 大小写不敏感。当「打开项目的 raw 路径」与「git toplevel 规范路径」**仅大小写不同**时,
上游 `file.ts` 的 `path.relative(项目根, 文件绝对路径)` 在 posix 下大小写敏感 → 产出 `../<dir>/.git` 这种 `..` 逃逸
路径 → 喂给 `ignore@7` 抛 `RangeError` → 整个 `/file` 列表 **500**。本版 `ignore-path.ts` 已修(归一大小写 + `safeIgnores`
兜 `..`),需在 mac 真机确认 500→200。

**复现步骤**:
1. 准备一个 git 项目,真实目录名带大写,例:`/Users/<you>/Projects/Deskfox-Plugins`(`git init` + 一次 commit)。
2. 在 DeskFox(本分支 local 版)里**用小写路径打开**它:`/Users/<you>/Projects/deskfox-plugins`
   (大小写不敏感卷上这个路径能解析到同一目录)。
   - 方法:项目选择器选到该目录后,确认 `location.directory`(raw)与 git toplevel 大小写不一致即可触发。
   - 实在不好造小写入口,可直接在 sidecar 发 `GET /file/list?path=.&directory=/Users/<you>/Projects/deskfox-plugins`
     (Basic auth 见 `window.api.awaitInitialization()` 返回的 username/password)。
3. 观察文件树加载。

**验收标准**:
- ✅ 文件树正常加载、返回 **HTTP 200**(修复前是 500 `UnknownError`)。
- ✅ `.git` / `node_modules` 仍被正确过滤(不泄漏进文件树)—— 证 `ignoreRelativePath` 归一后 tail 仍命中 ignore。
- ✅ 无 `RangeError` 红 toast / 无 sidecar `error.middleware` 500 日志。
- **对照**:切回 `main`(未含本修复)同样操作应复现 500,证明确实是本修复治好的(可选,做了更有说服力)。

**为什么 Windows 做不了**:`path.win32.relative` 大小写不敏感 + 归一分隔符,实测同场景返回干净 `.git` 不产 `..`,
Windows/NTFS 根本不触发这个 500(详见版本计划「Windows 迁移实测发现 §①」)。纯字符串逻辑已被平台无关单测
`ignore-path.test.ts` 100% 覆盖(Windows CI 已跑过),mac 这步只是补完整 HTTP 往返的最后一关。

---

## 待办 2 ·【REQ-068 + REQ-061】网络盘掉线 / U盘拔出 — unreachable 分支 + 不误重绑

> 这项**不是 mac 独有**,而是需要**物理可插拔的盘**(网络盘 / U 盘 / 外置盘)——Windows 这台开发机当下没有,
> 故一并交给有外置盘的 mac 端做。macOS 用 `/Volumes/<外置盘>` 即可。

### 2a ·【REQ-068】unreachable 模态:默认项目在掉线的盘上 → 提示重连(而非清记录 / 裸 500)

**背景**:本版 pre-check 把失败分两类——`missing`(ENOENT,确切不存在)清 lastProject 落选择器;
`unreachable`(EACCES/EBUSY/ENXIO/ETIMEDOUT 等,盘暂不可达)**保留 lastProject + 提示重连**。Windows 已验 missing
分支(目录删/改名)+ 未映射盘符=ENOENT;**unreachable 分支需真盘掉线才能造**。

**复现步骤**:
1. 把一个项目放在外置盘 `/Volumes/USB/myproj`,在 DeskFox 里打开它一次(成为 lastProject)。
2. 关闭 DeskFox。
3. **拔掉 U 盘 / 断开网络盘**(让 `/Volumes/USB/myproj` 变成「盘在但路径不可达」或「卷消失」)。
4. 冷启动 DeskFox。

**验收标准**(按掉线形态可能落 missing 或 unreachable,两者都不该裸 500 / 不该静默空白):
- ✅ 出引导 toast:unreachable → **「项目磁盘暂不可达 — 无法访问 "…",磁盘可能未连接或未映射(网络盘/U 盘),请重新连接后再试。」**;
  若卷整个消失被判 ENOENT → missing toast「项目目录不存在…请重新选择项目目录」。**关键是不静默、不裸 500**。
- ✅ **unreachable 情况下 lastProject 不被清空**(插回盘重启应还能自动加载;missing 情况才清)。
- 记一下实际 errno(`fs.statSync` 的 `code`)是什么(`ENXIO`/`ETIMEDOUT`/`EBUSY`/`ENOENT`?),回填本文件,
  作为 `fs-probe.ts` errno 分类的真机依据(目前按「ENOENT/ENOTDIR=missing,其它=unreachable」兜底)。

### 2b ·【REQ-061 M5 三态】盘 offline 时重开项目 → 不误重绑 worktree

**背景**:M5 三态修复——`fs.exists` 对 ENOENT 返 false(确切不存在→重绑),对其它 errno(盘 offline)则 fail,
本版改为「检查出错保守不重绑」。要验:盘暂时 offline 时,**有效但暂不可达的 worktree 不被误改**。

**复现步骤**:
1. git 项目放外置盘 `/Volumes/USB/proj`,DeskFox 打开它(project 行 worktree=`/Volumes/USB/proj`)。
2. 拔盘 / 断网络盘(worktree 路径暂不可达,但 errno 非 ENOENT)。
3. 在**同一个会话/不重启**下,或换个能解析到它的路径再触发一次 project 解析(模拟重开)。
4. 插回盘,检查该 project 的 worktree。

**验收标准**:
- ✅ 盘 offline 期间 project 的 worktree **仍是 `/Volumes/USB/proj`**,**没被误重绑**到别的路径或 global。
- ✅ 插回盘后项目正常加载,记录(会话等)完好。
- **对照**:`main`(原 `orElseSucceed(()=>false)`)在盘 offline 时 `fs.exists` 出错被吞成 false → 误判 missing →
  可能把有效 worktree 改掉;本修复应避免之。

**为什么 Windows 当下做不了**:本机无可插拔的网络盘 / U 盘造「盘在但 errno 非 ENOENT」的 offline 态;
未映射盘符 `Z:\` 实测是 ENOENT(=missing),验不到 unreachable 分支。三态逻辑已被平台无关单测
`project-rebind.test.ts` 覆盖(EBUSY/ENXIO/ETIMEDOUT/EPERM 失败一律不重绑),mac 这步是真盘 offline 的端到端补验。

---

## 结果回填(mac 端做完填这里)

- [x] **待办 1（REQ-067 mac 500→200）:通过 ✅**(2026-07-02,mac local 版从最新 main 现打 · CDP 取 auth · sidecar HTTP 真往返)
  - **结果**:小写 directory 参数(`/Users/openclaw/Projects/deskfox-plugins`,与 git toplevel 规范大写 `Deskfox-Plugins` 仅大小写不同)请求 `GET /file?path=.&directory=<小写>` → **HTTP 200**(修复前必 500)。
  - **`.gitignore` 归一 tail 命中验证**:测试项目含 `.gitignore`(`node_modules/` `*.log` `build/`)。小写路径下 `node_modules/` `build/` `debug.log` 均 **`ignored:true`**,与大写规范路径(对照组)**逐条一致** → 证 `ignoreRelativePath` 大小写归一后 `.gitignore` 规则仍精确命中、不泄漏。
  - **实测 RangeError**:真实 `ignore@7` 复现 —— `path.relative("…Deskfox-Plugins","…deskfox-plugins/.git")` = `"../deskfox-plugins/.git"` → `ig.ignores()` 抛 **`RangeError: path should be a path.relative()'d string`**(坐实根因);经 `ignoreRelativePath` 归一为 `".git/"`/`"node_modules/"` + `safeIgnores` 兜底后不再抛。
  - **透明说明**:`.git` 本身返回里 `ignored:false`(显示)——因它未写进 `.gitignore`,`ignore` 库不隐式忽略;小写/大写两路径行为**一致**,与本修复无关(前端文件树另有 `.git` 过滤)。不影响验收。
- [x] **待办 2a（REQ-068 unreachable）:通过 ✅**(2026-07-06,真实 U 盘 `/Volumes/WININSTALL` + `diskutil unmount`,local 版 CDP;交付批次 [REQ-070](../project-continuity-v2026-8-4/3-changelog.md))
  - **结果**:probe 判定从 `missing` 走到 `unreachable`;冷启动 **lastProject 不清、projects 列表保留**,弹 unreachable 引导 toast(非裸 500);U 盘重挂后恢复正常 —— 全 PASS。
  - **实际 errno**:`ENOENT`(macOS `diskutil unmount` 后挂载点整体消失,不是 `ENXIO`/`ETIMEDOUT`);probe 结果携带 `code:"ENOENT"` 供诊断,见 `project-continuity-v2026-8-4/3-changelog.md:121`。
  - **顺带抓出并修掉的平台盲区**:macOS 上 `path.parse().root` 恒为 `/`,导致外置盘拔出被误判成「系统盘还在 → forget 项目」;修法是新增 `mountRootOf`(`packages/desktop/src/main/fs-probe.ts`),有 bug-repro 单测 A2e/A2f 护住。
- [x] **待办 2b（REQ-061 不误重绑）:通过 ✅**(同批同场景)
  - **结果**:offline 期间 git `worktree` **不误重绑**(三态判定走「检查出错 → 保守不重绑」分支),盘插回后项目身份完好、无残留错绑。

> **待办 2 的实际完成路径**:本文件写下时判断「需物理盘、当下做不了」,遂延期记入 OPENCODE-PLAN `需求池/stale-path-mac-物理盘QA.md`(= REQ-070)。该条**已于 2026-07-06 用真 U 盘做完并归档**,2a/2b 全 PASS。
> 2026-08-18 前置清障批 S5 回填本段 —— 不是补做,是把早已做完的结果接回它的出处。
> **仍欠**:Windows 四模态(目录删 / 改名 / 盘符未映射 / U盘拔出)真机抓 errno,转 Win 端排期,与本文件的 mac 交接无关。

填完请把 `3-changelog.md`「待办」段 + 版本计划 `v2026.6.21.md` 对应 ⏳ 项勾掉,并在改动日志补一行 mac QA 通过。
