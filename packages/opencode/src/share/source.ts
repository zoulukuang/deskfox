export type ShareTarget = "cn" | "global"
export type ShareSource = {
  base_url: string
  api_resource: "share" | "shares"
  account_id: string | null
  org_id: string | null
}

export function publicSource(target: ShareTarget): ShareSource {
  if (target !== "cn" && target !== "global") throw new Error("Invalid public share target")
  return {
    base_url: target === "cn" ? "https://deskfox.cn" : "https://deskfox.ai",
    api_resource: "share",
    account_id: null,
    org_id: null,
  }
}

export function recordedSource(row: {
  base_url: string | null
  api_resource: "share" | "shares" | null
  account_id: string | null
  org_id: string | null
  url: string
  id: string
}): ShareSource {
  if (row.base_url && row.api_resource) {
    const base = checkedBase(row.base_url)
    if (row.api_resource === "shares" && (!row.account_id || !row.org_id))
      throw new Error("Original share account is unavailable")
    if (row.api_resource === "share" && (row.account_id || row.org_id)) throw new Error("Invalid public share identity")
    return { base_url: base, api_resource: row.api_resource, account_id: row.account_id, org_id: row.org_id }
  }
  // Only origins with a verified /api/share contract can be inferred from old links.
  // Unknown custom and historical services keep their local link; never probe with secrets.
  const url = new URL(row.url)
  if (
    !["https://deskfox.cn", "https://deskfox.ai", "https://opncd.ai"].includes(url.origin) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/share/${row.id}`
  )
    throw new Error("Legacy share origin cannot be safely resolved")
  return { base_url: url.origin, api_resource: "share", account_id: null, org_id: null }
}

export function checkedBase(value: string) {
  const url = new URL(value)
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid share service URL")
  return url.href.replace(/\/$/, "")
}

export function checkedShare(input: { id: string; secret: string; url: string }, source: ShareSource) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.id) || !input.secret) throw new Error("Invalid share response")
  const base = new URL(source.base_url)
  const url = new URL(input.url)
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash)
    throw new Error("Share response changed service origin")
  if (
    (base.origin === "https://deskfox.cn" || base.origin === "https://deskfox.ai") &&
    (url.pathname !== `/share/${input.id}` || !/^[a-f0-9]{64}$/.test(input.secret))
  )
    throw new Error("Invalid public share response")
  return input
}

export * as ShareSource from "./source"
