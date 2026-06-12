// FORK-ONLY: DeskFox 原生桥 preload — 暴露 window.deskfox [feat: electron-replatform] 2026-06-12
//
// 对应 renderer 侧 app/src/utils/native.ts 的 DeskfoxBridge 契约({ invoke, listen })。
// invoke → ipcRenderer.invoke("deskfox:<cmd>")(main/deskfox/ipc.ts 处理)。
// listen → ipcRenderer.on("deskfox:<event>"),返回 unlisten。

import { contextBridge, ipcRenderer } from "electron"

const deskfox = {
  invoke: (cmd: string, args?: Record<string, unknown>) => ipcRenderer.invoke(`deskfox:${cmd}`, args),
  listen: async (event: string, handler: (payload: unknown) => void) => {
    const h = (_e: unknown, payload: unknown) => handler(payload)
    ipcRenderer.on(`deskfox:${event}`, h)
    return () => {
      ipcRenderer.removeListener(`deskfox:${event}`, h)
    }
  },
}

contextBridge.exposeInMainWorld("deskfox", deskfox)
