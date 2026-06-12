feat-id: project-avatar-save
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# project-avatar-save — changelog

## 改动清单

| 文件 | 性质 | 行数 |
|---|---|---|
| `packages/app/src/context/project-icon-override.ts` | fork-only 新增(纯函数 + 根因注释) | +~45 |
| `packages/app/src/context/project-icon-override.test.ts` | fork-only 新增(4 用例,含 bug-repro) | +~35 |
| `packages/app/src/context/layout.tsx` | 上游文件,FORK ×2(import + enrich override 解析) | +9 -4 |
| `packages/app/src/components/dialog-edit-project.tsx` | 上游文件,FORK ×1(两路径统一写 childStore.icon) | +7 -5 |
| `docs/features/project-avatar-save/*` | 三文档 | — |

新增:上游 ≈ 80:13,高于 3:1 健康基线。

## commit

- (本笔 commit,grep `[feat: project-avatar-save]` 反查)fix(app): 编辑项目头像保存不生效 — enrich 读 projectMeta override + 两路径统一写 childStore.icon [bug-repro]

## 影响范围

- 「编辑项目」上传头像 → 侧边栏图标即时更新 + 重开对话框 + 重启持久化。
- meta 路径(无 id / global 项目)的 override 现可渲染(原死写);update 路径(有 id 项目)行为不变。
- 既有颜色 / DB 图标 / favicon 自动发现项目零行为变化(override 为空时回退原逻辑)。

## 回归测试

- 新测试 4/4 pass(`bun test src/context/project-icon-override.test.ts`)。
- 后端 override 往返 `test/project/project.test.ts` 32/32(预存,证后端无责)。
- app 包全量 839 pass / 0 fail;monorepo typecheck 16/16。
- 真机视觉 QA 待 user。

## 回退方法

`git revert <hash>` 单笔可逆(P4):新文件删除 + 上游 2 文件 FORK 块还原,无数据迁移。

## 起源

2026-06-12 user 报「编辑项目上传头像保存后侧边栏不显示,所有项目所有端都这样」。诊断逐层排除后端(DB/Service/SDK/migration 全绿)锁定前端 enrich 不读 projectMeta override(commit `aa07f38b07` 引入 childStore.icon 单源解析时遗漏 meta 路径来源)。
