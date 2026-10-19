import { backupShares, pruneBackups, removeShare, restoreShares } from "./maintenance"

const [command, ...args] = process.argv.slice(2)
const directory = process.env.DESKFOX_SHARE_DIRECTORY
const origin = process.env.DESKFOX_SHARE_PUBLIC_ORIGIN
if (!directory || !origin) throw new Error("Share directory and origin are required")
if (process.env.DESKFOX_SHARE_MAINTENANCE_LOCK !== "held") throw new Error("Use the exclusive-lock maintenance wrapper")

async function main() {
  if (command === "backup" && args.length === 1) return backupShares(directory!, args[0], origin!)
  if (command === "prune-backups" && args.length === 1) return pruneBackups(args[0], origin!)
  if (command === "restore" && args.length === 2)
    return restoreShares({ backup: args[0], latest: directory!, destination: args[1], origin: origin! })
  if (command === "remove" && args.length === 1) {
    await removeShare(directory!, args[0])
    return { unavailable: true }
  }
  throw new Error(
    "Usage: backup ABSOLUTE_DEST | prune-backups ABSOLUTE_BACKUPS | restore ABSOLUTE_BACKUP NEW_ABSOLUTE_DEST | remove SHARE_ID",
  )
}

console.log(await main())
