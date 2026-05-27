// [fork-only] 飞书桥接 workspace 迁移 / stale session 清理 helper
// [feat: imbot-workspace-rename] 2026-05-25 helper extract,DI 友好测
//
// ⚠️ 这两个 helper **必须放在 plugin.ts(插件入口)之外**:opencode 的 plugin loader
// (`packages/opencode/src/plugin/index.ts` 的 getLegacyPlugins)会遍历插件模块的**所有
// export**,把每个 export 当 plugin server 函数调 `fn(input, options)`。若它们 export 自
// plugin.ts,会被以错误参数(input, options)调用 → 第 3 参 fs=undefined → `fs.existsSync`
// 抛 "failed to load plugin"。放独立模块后 plugin.ts 内部 import 使用、不 re-export,
// opencode 就只把真正的 `server`/`default` 当插件。[fix: feishu-plugin-bundle-fs2] 2026-05-27

export type MigrateResult =
  | "migrated"
  | "noop-already-new"
  | "noop-no-legacy"
  | "skipped-both-exist"
  | "failed"

export function migrateLegacyWorkspace(
  legacyPath: string,
  newPath: string,
  fs: {
    existsSync: (p: string) => boolean
    renameSync: (o: string, n: string) => void
  },
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): MigrateResult {
  const legacyExists = fs.existsSync(legacyPath)
  const newExists = fs.existsSync(newPath)
  if (!legacyExists && newExists) return "noop-already-new"
  if (!legacyExists && !newExists) return "noop-no-legacy"
  if (legacyExists && newExists) {
    logger.warn(
      `[feishu-plugin] both legacy ${legacyPath} and new ${newPath} exist — keeping new, please check legacy manually`,
    )
    return "skipped-both-exist"
  }
  // legacyExists && !newExists
  try {
    fs.renameSync(legacyPath, newPath)
    logger.info(
      `[feishu-plugin] migrated legacy workspace path ${legacyPath} → ${newPath}`,
    )
    return "migrated"
  } catch (e) {
    logger.warn(
      `[feishu-plugin] failed to migrate legacy workspace ${legacyPath} → ${newPath}: ${(e as Error).message}. Please mv manually.`,
    )
    return "failed"
  }
}

/**
 * [feat: imbot-workspace-rename-followup] 2026-05-25
 *
 * `imbot-workspace-rename`(2026-05-25 落地)只改了 home base 路径,但
 * `~/.opencode/feishu-chat-sessions.json` 里保留了重命名前创建的 opencode session
 * ID。这些 session 在 opencode 内部绑死老 directory(feishu-workspace)+ 含老
 * system prompt(ATTACH_MARKER_PROMPT 里那时候写的还是老路径)。
 *
 * 复用老 session 时,LLM 通过老 system prompt + 老 cwd 推断 → emit ATTACH marker
 * 用老路径 → 实际文件在新路径 → ENOENT 报错。
 *
 * 修法:user 升级到本 feat 版本首次启动,清掉整个 chatSessionStore 让 plugin 重建
 * session 用新 directory(IMBOT_WORKSPACE)+ 新 system prompt。marker 文件
 * (~/.opencode/.imbot-workspace-rename-cleanup-applied)保证只清一次,后续启动
 * no-op。
 *
 * Trade:user 失去所有 chat 的 multi-turn memory(one-time cost),换 stale path
 * 长期错乱修复。
 *
 * 行为表(详 docs/features/imbot-workspace-rename-followup/1-spec.md §测试用例):
 *   - marker 已存在 → "noop-already-applied"
 *   - marker 不存在 + chatStore 不存在 → 写 marker,返 "noop-no-sessions"
 *   - marker 不存在 + chatStore 存在 → 清 chatStore + 写 marker,返 "applied"
 *   - 异常 → warn,返 "failed",不崩 plugin
 */
export type CleanupResult =
  | "applied"
  | "noop-already-applied"
  | "noop-no-sessions"
  | "failed"

export function applyStaleSessionsCleanup(
  markerPath: string,
  chatSessionStorePath: string,
  fs: {
    existsSync: (p: string) => boolean
    unlinkSync: (p: string) => void
    writeFileSync: (p: string, data: string) => void
  },
  logger: { info: (m: string) => void; warn: (m: string) => void },
): CleanupResult {
  if (fs.existsSync(markerPath)) {
    return "noop-already-applied"
  }
  const markerContent = JSON.stringify(
    { appliedAt: new Date().toISOString(), feat: "imbot-workspace-rename" },
    null,
    2,
  )
  if (!fs.existsSync(chatSessionStorePath)) {
    try {
      fs.writeFileSync(markerPath, markerContent)
      return "noop-no-sessions"
    } catch (e) {
      logger.warn(
        `[feishu-plugin] failed to write cleanup marker ${markerPath}: ${(e as Error).message}`,
      )
      return "failed"
    }
  }
  // marker 不存在 + chatStore 存在 → 清 + 写 marker
  try {
    fs.unlinkSync(chatSessionStorePath)
  } catch (e) {
    logger.warn(
      `[feishu-plugin] failed to clear stale chat sessions ${chatSessionStorePath}: ${(e as Error).message}. Please rm manually + restart.`,
    )
    return "failed"
  }
  try {
    fs.writeFileSync(markerPath, markerContent)
  } catch (e) {
    logger.warn(
      `[feishu-plugin] cleared chat sessions but failed to write cleanup marker ${markerPath}: ${(e as Error).message}. Next start will clean again.`,
    )
    return "failed"
  }
  logger.info(
    `[feishu-plugin] cleared stale chat sessions after workspace rename (${chatSessionStorePath} removed, marker written)`,
  )
  return "applied"
}
