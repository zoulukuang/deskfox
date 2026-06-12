// FORK-only 新文件 [feat: project-avatar-save] 2026-06-12
//
// 起源:用户报「编辑项目里上传头像,保存后侧边栏不显示,所有项目所有端都这样」。
// 根因:编辑对话框(dialog-edit-project.tsx)保存有两条路径——
//   ① 有后端 id 的项目走 project.update 写 DB + childStore.icon;
//   ② 无 id / global 的项目走 globalSync.project.meta 只写 childStore.projectMeta.icon.override。
// 而侧边栏渲染头像的 layout.tsx `enrich()` 解析 override 时,**只读 childStore.icon**,
// 从不读 childStore.projectMeta.icon —— 于是路径 ② 写进去的 override 成了"只写不读"的死数据,
// 上传的头像永远进不到被渲染的 project.icon.override。
//
// 修复:override 解析按优先级读所有持久化来源,让 projectMeta 里的 override 也能渲染。
// 抽成纯函数便于单测(enrich 本体在 LayoutProvider 闭包内,不易直接测)。
//
// 优先级:childStore.icon(update 路径 / per-workspace 覆盖)> projectMeta.icon.override(meta 路径)。
// 注:DB metadata 里的 override 由 enrich 的 base = {...metadata, ...project} 自带,
// 本函数只负责 childStore 两个本地来源的解析;两者都空时返回 undefined,enrich 回退到 base.icon。

export type ProjectMetaLike = {
  icon?: {
    override?: string
  }
}

export function resolveLocalIconOverride(
  childIcon: string | undefined,
  projectMeta: ProjectMetaLike | undefined,
): string | undefined {
  if (childIcon) return childIcon
  const metaOverride = projectMeta?.icon?.override
  if (metaOverride) return metaOverride
  return undefined
}
