import { Share } from "../core/share"
import { localShares, shareService } from "./runtime"
import { shareIDSchema } from "./schema"

export const publicShare = {
  async get(id: string) {
    if (!localShares) return Share.get(id)
    if (!shareIDSchema.safeParse(id).success) return
    return (await shareService()).repository.get(id)
  },
  async data(id: string) {
    if (!localShares) return Share.data(id)
    return (await shareService()).repository.data(id)
  },
}
