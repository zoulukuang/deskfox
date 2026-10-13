export const SHARE_ROUTING_ENGLISH = {
  "share.public.unsupported": "This server does not support regional sharing. Update the server before sharing.",
  "share.public.unavailable": "Unable to check sharing support. Check the server connection and try again.",
}

export const SHARE_ROUTING_CHINESE = {
  "share.public.unsupported": "此服务器不支持区域分享。请更新服务器后再分享。",
  "share.public.unavailable": "无法检查服务器是否支持分享。请检查服务器连接后重试。",
} satisfies Record<keyof typeof SHARE_ROUTING_ENGLISH, string>

// Reviewed zh/en feature bundle; other locales explicitly fall back to English.
export function shareRoutingDict(locale: string) {
  return locale === "zh" ? SHARE_ROUTING_CHINESE : SHARE_ROUTING_ENGLISH
}
