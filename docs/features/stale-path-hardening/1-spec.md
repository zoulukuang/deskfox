feat-id: stale-path-hardening
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# stale-path-hardening — 项目入口 stale 路径全族根治(v2026.6.21)

> 本 spec 是 `D:\project\OPENCODE-PLAN\版本计划\v2026.6.21.md` 在主仓 `docs/features/` 的落点摘要,
> **完整需求 / 验收基线 / Windows 迁移实证 / 身份模型契约以版本计划为唯一权威**,此处只记本版交付的工程范围。

## 一句话

系统性根治「项目文件夹改名 / 移动 / 默认路径不存在 / 路径大小写不一致」导致的文件树/文件请求
**500**、编辑保存静默失败、侧栏显示旧名、启动静默空白 —— 在项目入口处补**启动存在性校验 + 大小写防御
兜底 + 改名重绑三态修复 + 编辑保存自愈**,从源头杜绝 stale 路径。

## 共享根因

上游打开项目时各路径(请求 `location.directory` 原样、存档 `worktree`)**既不规范化大小写、也不校验
存在性**。只要「使用中的路径 ≠ 磁盘当前真实规范路径」,必出问题。四条是同一上游裂缝的四种外显。

## 本版四条 REQ

| REQ | 标题 | 档位 | 落点 | 本版动作 |
|---|---|---|---|---|
| REQ-067 | 路径大小写不一致(/file 500,**Windows 不复现**)| 🟢 单元级 | `server/.../handlers/file.ts` + 新 `ignore-path.ts` | 防御兜底 + 平台无关单测(护 mac 发布版) |
| REQ-068 | 启动默认项目路径不存在(首请求静默 200 → 触达文件 500)| 🟡 | `app/pages/layout.tsx` + desktop IPC + 新 `startup-precheck.ts`/`fs-probe.ts` | **新做**:启动 pre-check + 分模态引导 |
| REQ-061 | 改名后拉不到数据 + 侧栏显示旧名 | 🟡 | `project/project.ts:278-288` + 新 `project-rebind.ts` | 已落代码上线回归 + **修 M5 三态** |
| REQ-064 | 编辑保存按钮静默失效(update stale id 404)| 🟡 | `server/.../handlers/project.ts` update | toast 已落 + **自愈本版落地** |

## 验收标准(Windows 基线;真机 QA 项见 2-plan/版本计划)

- [x] REQ-067:平台无关单测 —— `ignore.ignores('../x/.git')` 改法后不抛 `RangeError` 且 `.git` 仍判 ignored
- [x] REQ-068:pre-check 决策单测(missing→skip+forget / unreachable→skip / ok→open / undefined→fail-open)+ `probePath` errno 分类单测
- [x] REQ-061:三态判定单测(ENOENT→missing / present→不重绑 / 检查出错→保守不重绑)+ 既有重绑回归绿
- [x] REQ-064:身份迁移后 stale id update 自愈集成测试(旧 id 404 → fromDirectory 重解析现行 id → update 成功)
- [x] 真机 QA(需 user / 桌面)—— **mac 侧全部验通**:REQ-067 端到端 500→200(2026-07-02,见 `mac-qa-handoff.md` 待办 1);REQ-068 unreachable + REQ-061 offline 不误重绑(2026-07-06 真 U 盘 `diskutil unmount`,errno 实测 `ENOENT`,见 `mac-qa-handoff.md` 待办 2a/2b)。**Windows 四模态已补验**(2026-08-18,Win 端):目录删 / 改名 / 盘符未映射 / 可移动盘拔出,由 `packages/branding/smoke/req068_path_probe_modes.ts` 真机实测 **6/6 通过**。关键实测结论:**四种模态的真实 errno 全是 `ENOENT`** —— 只看 errno 根本区分不了「目录被删」与「整盘离线」,能分开全靠 v2 加固加的**盘符根可达性**二次探测(若无它,拔盘/未映射会被判 missing → forget 掉合法项目)。这与 mac 侧 REQ-070 实测 `ENOENT`(而非预期的 ENXIO/ETIMEDOUT)同向印证

## R8 测试用例清单(动工前定,逐条对应上方)

见 2-plan.md「测试矩阵」。Logic 清单(纯函数 helper:ignore-path / project-rebind / startup-precheck / fs-probe)均 ≥ 80% 行覆盖
(全部分支单测);View 清单(layout.tsx 启动 pre-check)e2e 留真机 QA(native 冷启动 + 原生盘符模态)。

## 架构选型

- **P1 隔离优先**:四条修复的核心逻辑全部抽到 **fork-only 新文件**(`ignore-path.ts` / `project-rebind.ts` /
  `startup-precheck.ts` / `fs-probe.ts`),上游文件只做 ≤ 数行注入(均带 FORK marker)。新增行数 : 改上游行数 ≫ 3:1。
- **REQ-068 IPC 走既有 `checkAppExists` 同构链路**:apps→index→ipc→preload→renderer→platform 八层各加 1-2 行,
  不新建机制。`pathExists` 在 `Platform` 接口为 optional → 非桌面端自动 fail-open。
- **不改 fromDirectory realpath 治大小写**(审查校正 B1):067 脱节点在 `location.ts`/`file.ts` 非 fromDirectory;
  Windows `realpathSync.native` 虽能纠大小写但本版不依赖(Windows 本无此 500)。
