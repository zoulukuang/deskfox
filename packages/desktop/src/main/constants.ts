import { app } from "electron"

// FORK: 四档渠道。前三档(dev/beta/prod)可公开发布;local = 本地测试版(永不发布,数据隔离)。
// [feat: local-channel] 2026-06-17 — 详见 docs/governance/版本号与发布渠道规范.md §一/§3.11
type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// FORK: DeskFox 产品名(窗口标题 / app 名单一事实源,与 electron-builder.deskfox.config.ts
// 的 PRODUCT_NAMES 对齐)。dev 对外名为「预览版」(对齐治理 §一 对外名,不再显示 "DeskFox Dev");
// local 为本地测试版。[feat: electron-brand-cleanup / local-channel]
export const PRODUCT_NAMES: Record<Channel, string> = {
  local: "DeskFox 本地版",
  dev: "DeskFox 预览版",
  beta: "DeskFox Beta",
  prod: "DeskFox",
}

// 自动升级:仅 beta / prod 启用;dev(预览)沿用既有"不自动升级",local 本地版永不升级。
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "local"
