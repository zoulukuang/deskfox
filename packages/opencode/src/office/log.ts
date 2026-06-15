// FORK-ONLY: office 模块本地 log shim [feat: electron-replatform] 2026-06-12
//
// 上游 #31310 删了 `@opencode-ai/core/util/log` 的 `Log.create({service}).info()` API
// (改 Effect 内建 logging)。但 office 这些是普通 async 模块(非 Effect generator),
// 用不了 `yield* Effect.logInfo`。提供等价 console 后端 shim,保持原 `Log.create` 调用面不变,
// 只需 libreoffice/office-installer 改 import 来源即可。

type Data = Record<string, unknown> | undefined

function fmt(service: string, msg: string, data: Data): string {
  const tag = `[${service}]`
  return data === undefined ? `${tag} ${msg}` : `${tag} ${msg} ${JSON.stringify(data)}`
}

export function create(opts: { service: string }) {
  const s = opts.service
  return {
    info: (msg: string, data?: Data) => console.log(fmt(s, msg, data)),
    warn: (msg: string, data?: Data) => console.warn(fmt(s, msg, data)),
    error: (msg: string, data?: Data) => console.error(fmt(s, msg, data)),
    debug: (msg: string, data?: Data) => console.debug(fmt(s, msg, data)),
  }
}
