feat-id: project-avatar-save
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# project-avatar-save — plan

## 实施方案

1. **fork-only 新文件** `packages/app/src/context/project-icon-override.ts`:
   纯函数 `resolveLocalIconOverride(childIcon, projectMeta)` —— override 解析按优先级读
   `childStore.icon`(update 路径 / per-workspace 覆盖)→ `projectMeta.icon.override`(meta 路径),
   两者皆空返回 undefined(enrich 回退到 DB metadata.icon)。
2. **layout.tsx `enrich()` FORK 接线**:`childStore.icon` 单源 → `resolveLocalIconOverride(childStore.icon, childStore.projectMeta)`。
   让 meta 路径写进 projectMeta 的 override 也能渲染(向后兼容已存量数据)。
3. **dialog-edit-project.tsx FORK 改动**:把 `globalSync.project.icon(worktree, override)` 从
   update 分支内移出,对**两条路径都调用** —— override 始终写进 canonical 的 childStore.icon,
   新保存走干净路径,不再依赖 projectMeta 兜底。
4. **单测** `project-icon-override.test.ts`:R8 清单 4 用例,含 bug-repro。

## 决策轨迹

- **为什么不只改 dialog**:dialog 改动让新保存正确,但用户已存量项目的 override 可能已落在 projectMeta;
  enrich 读 projectMeta 兜底让旧数据也能立即显示,无需用户重存。两处一起 = 新旧都覆盖。
- **为什么 childStore.icon 优先**:update 路径(有 id 项目)的 per-workspace 覆盖语义更强(commit `aa07f38b07`
  本意:同 git repo 不同子目录各自独立 override);projectMeta 是 meta 路径的来源,作次优先级。
- **为什么抽纯函数**:enrich 在 LayoutProvider 闭包内,依赖大量 context,不易直接单测;
  override 解析逻辑抽出成纯函数,既单测又复用,符合 helper-extract 模式(Logic 清单)。
- **诊断路径**:逐层验证后端(DB migration + Project.update + fromRow + project.list,32/32 测试绿)、
  SDK v2(buildClientParams 正确发 icon body)、渲染(getProjectAvatarSource override 优先 + Avatar 渲染 img)
  全部正确 → 锁定唯一缺口:enrich 不读 projectMeta + 两路径写入位置不一致。

## 测试甄别记录(R9)

- 新测试 4/4 pass(含 bug-repro)。
- app 包全量回归:839 pass / 0 fail(原 835 + 新 4)。
- monorepo typecheck:16/16 pass。
- 真机验收待 user(native UI 改动,CDP 自测 ≠ 真桌面 QA)。

## 上游 PR 计划

enrich 不读 projectMeta 是上游(anomalyco/opencode)同样存在的缺陷,本补丁可平移。待真机确认后评估提上游 PR。
