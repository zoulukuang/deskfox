// FORK-ONLY: office 文件分类 [feat: electron-replatform] 2026-06-12
//
// 上游 #30447 删了 `packages/opencode/src/file/index.ts`(整个 File.Service 迁入 core/filesystem),
// 原寄生其中的 office 分类逻辑(officeDirect / officeConvert / officeMime + helper)随之失去宿主。
// 抽成 fork-only 纯模块,由 server content handler(handlers/file.ts FORK 分支)调用,
// 配合 office-pdf-ref side-band 协议。分类语义照搬原 file/index.ts。

import path from "path"

const ext = (file: string) => path.extname(file).toLowerCase().slice(1)

const officeDirect = new Set(["pdf"])
const officeConvert = new Set(["docx", "doc", "xlsx", "xls", "pptx", "ppt", "rtf", "odt", "ods", "odp"])

const officeMime: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export const isOfficeDirect = (file: string) => officeDirect.has(ext(file))
export const isOfficeConvert = (file: string) => officeConvert.has(ext(file))
export const getOfficeMimeType = (file: string) => officeMime[ext(file)] || "application/octet-stream"
