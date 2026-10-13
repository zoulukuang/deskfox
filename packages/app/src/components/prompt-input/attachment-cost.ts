import type { ImageAttachmentPart } from "@/context/prompt"

export const ATTACHMENT_CONFIRM_BYTES = 200 * 1024

export async function inlineAttachmentBytes(attachments: ImageAttachmentPart[]) {
  const sizes = await Promise.all(
    attachments.map(async (item) => {
      const response = await fetch(item.blob.url)
      if (!response.ok) throw new Error("Attachment unavailable")
      return (await response.blob()).size
    }),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

// The same lock covers inspection, confirmation and creation; rapid Enter/click cannot submit twice.
export function singleSubmission(run: (event: Event) => Promise<void>) {
  const state = { active: false }
  return async (event: Event) => {
    event.preventDefault()
    if (state.active) return
    state.active = true
    try {
      await run(event)
    } finally {
      state.active = false
    }
  }
}
