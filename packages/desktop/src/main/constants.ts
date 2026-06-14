import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// FORK: DeskFox 三档产品名(窗口标题 / app 名单一事实源,与 electron-builder.deskfox.config.ts
// 的 PRODUCT_NAMES 对齐)[feat: electron-brand-cleanup]
export const PRODUCT_NAMES: Record<Channel, string> = {
  dev: "DeskFox Dev",
  beta: "DeskFox Beta",
  prod: "DeskFox",
}

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
