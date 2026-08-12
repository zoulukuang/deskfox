// [fork-only] 按渠道解析 opencode config 目录 —— local 档配置隔离
// [feat: local-config-isolation] 2026-08-12
//
// ## 背景:两个纠缠在一起的问题
//
// **问题 A —— 潜伏 bug:plugin-install 写的文件 sidecar 根本不读。**
//   `plugin-install.ts` 的 userConfigPath() 硬编码 `~/.config/opencode/opencode.{jsonc,json}`,
//   而 sidecar 读的是 `Global.Path.config`(= `$XDG_CONFIG_HOME/opencode`),
//   且 data-namespace 已把 XDG_CONFIG_HOME 指向 `~/.config/deskfox`。
//   两者不是同一个文件。2026-08-12 实测:
//     ~/.config/deskfox/opencode/opencode.jsonc  → plugin 指向 ai.deskfox.app(sidecar 真正读这份)
//     ~/.config/opencode/opencode.jsonc          → plugin-install 一直在写这份(没人读)
//   现在没爆发,只因为 deskfox 那份是 data-namespace 首启迁移时 copy 过去的快照、恰好是对的。
//   但这意味着 plugin-install 的「独占接管 + 自愈」机制**长期失效** ——
//   将来任何需要靠它更新路径的场景(换渠道、修路径、plugin 目录变更)都不会生效。
//
// **问题 B —— local 档没有配置隔离。**
//   local 与发布渠道共享同一份 config。CLAUDE.md 承诺 local「与正式版共存、互不打扰」,
//   数据(opencode-local.db)与身份(appId .local)都隔离了,唯独配置没有。
//
// 两个问题必须**一起修**:单修 A(让 plugin-install 写对文件)会让 local 的独占接管
// 真的改到发布渠道的配置 —— 反而把「写废文件」的无害现状变成真污染。
//
// ## 方案
//
// 统一由本模块决定 config 目录,`plugin-install` 与 sidecar env 共用同一个答案:
//   - 发布渠道(prod/dev/beta):`$XDG_CONFIG_HOME/opencode` —— 即 sidecar 的默认位置,不变
//   - local:                   `$XDG_CONFIG_HOME/opencode-local` —— 独立目录
//     并通过上游既有的 `OPENCODE_CONFIG_DIR` env 告诉 sidecar 去读它(见 Global.Path.config:
//     `config: Flag.OPENCODE_CONFIG_DIR ?? Path.config`),零改上游。
//
// 命名对齐 DB 的 `opencode-local.db`,一眼能看出归属。

/** 目录名:发布渠道 `opencode`,local 档 `opencode-local` */
export function configDirName(channel: string, packaged: boolean): string {
  return !packaged || channel === "local" ? "opencode-local" : "opencode"
}

/** 是否需要给 sidecar 注入 OPENCODE_CONFIG_DIR(只有偏离默认位置时才需要) */
export function needsConfigDirEnv(channel: string, packaged: boolean): boolean {
  return configDirName(channel, packaged) !== "opencode"
}

/**
 * 发布渠道的 config 目录名 —— local 首启 seed 时从这里拷贝一份作为起点,
 * 让 local 开箱可用(有 provider / agent 配置),之后两边各走各的、互不影响。
 */
export const RELEASE_CONFIG_DIR_NAME = "opencode"
