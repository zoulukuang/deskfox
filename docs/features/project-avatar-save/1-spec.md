feat-id: project-avatar-save
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# project-avatar-save — spec

## 需求

用户在「编辑项目」对话框上传自定义头像、点保存,**侧边栏图标不更新,始终显示字母 fallback(带底色的 "F" 等)**。用户反馈:所有项目、所有端(Mac/Win)都这样,选定的头像从未在侧边栏展示成功过;重开对话框图标预览也回到字母。

## 根因

保存逻辑 `dialog-edit-project.tsx` 有两条路径:
- **有后端 id 且非 global**:`project.update(...)` 写 DB + `globalSync.project.icon(...)` 写 `childStore.icon`。
- **无 id / global**:`globalSync.project.meta(...)` 只写 `childStore.projectMeta.icon.override`。

侧边栏渲染数据来自 `layout.tsx` 的 `enrich()`,它解析 override 时**只读 `childStore.icon`**(commit `aa07f38b07` 加),**从不读 `childStore.projectMeta.icon`**。meta 路径写进 projectMeta 的 override 成了"只写不读"死数据,上传头像永远进不到被渲染的 `project.icon.override`。

后端往返已验证正确(`test/project/project.test.ts` 32/32 含 override 往返断言全绿),migration `20260423070820_add_icon_url_override` 存在,SDK v2 `project.update` 正确发送 `icon.override`。问题纯在前端。

## 验收标准

1. 上传头像保存后,侧边栏图标立即更新为该头像。
2. 重开对话框,图标预览显示已保存头像。
3. 重启应用后头像持久化。
4. 清除头像后回到字母/颜色 fallback。
5. 既有正常项目零行为变化。

## 测试用例清单(R8)

- [x] `resolveLocalIconOverride`:override 只在 projectMeta 时必须解析出来(bug-repro,unit)
- [x] childStore.icon 优先于 projectMeta(unit)
- [x] 两源皆空 → undefined(unit)
- [x] projectMeta undefined / 无 icon 不抛错(unit)
- [ ] 真机:上传→保存→侧边栏更新(native QA,待 user)
- [ ] 真机:重开 + 重启持久化(native QA,待 user)

## 架构选型(R1)

第 2 级:fork-only 纯函数新文件 + 上游 2 文件各 1 处 FORK 接线。
