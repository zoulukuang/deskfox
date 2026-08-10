import * as InstanceState from "@/effect/instance-state"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Option } from "effect"
import ignore from "ignore"
import path from "path"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
// FORK: REQ-067 — 大小写路径防御兜底 helper(护 macOS 发布版,防 ignore@7 RangeError 500)[feat: stale-path-hardening]
import { ignoreRelativePath, safeIgnores } from "./ignore-path"
// FORK-BEGIN: office routes + 分类(上游 #30447 删 src/file/,迁来 @/office)[feat: electron-replatform]
import * as LibreOffice from "@/office/libreoffice"
import * as OfficeInstaller from "@/office/office-installer"
import { isOfficeDirect, isOfficeConvert, getOfficeMimeType } from "@/office/classify"
import { OFFICE_PDF_REF_MIME } from "@opencode-ai/core/office-pdf-protocol"
// FORK-END

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const locations = yield* LocationServiceMap.Service

    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .grep({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).map((match) => ({
        path: { text: match.entry.path },
        lines: { text: match.text },
        line_number: match.line,
        absolute_offset: match.offset,
        submatches: match.submatches.map((submatch) => ({
          match: { text: submatch.text },
          start: submatch.start,
          end: submatch.end,
        })),
      }))
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      const directory = (yield* InstanceState.context).directory
      const limit = ctx.query.limit ?? 10
      const type = ctx.query.type ?? (ctx.query.dirs === "false" ? "file" : undefined)
      const started = performance.now()
      const found = yield* filesystem(FileSystem.Service.use((fs) => fs.find({ query: ctx.query.query, limit, type })))
      yield* Effect.logInfo("find file", {
        query: ctx.query.query,
        type,
        directory,
        limit,
        results: found.length,
        duration: Math.round(performance.now() - started),
      })
      return found.map((item) => item.path)
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      return yield* filesystem(
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const raw = yield* FSUtil.Service
          const location = yield* Location.Service
          const ignored = ignore()
          const gitignore = yield* raw
            .readFileString(path.join(location.project.directory, ".gitignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignore) ignored.add(gitignore)
          const ignorefile = yield* raw
            .readFileString(path.join(location.project.directory, ".ignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (ignorefile) ignored.add(ignorefile)
          return (yield* fs.list({ path: RelativePath.make(ctx.query.path) })).map((item) => {
            // FORK: REQ-067 — 每项 path.resolve 提一次复用(原 absolute + ignoreRelativePath 各算一遍)。
            // 2026-06-26 [feat: stale-path-hardening]
            const absolute = path.resolve(location.directory, item.path)
            return {
              name: path.basename(item.path),
              path: item.path,
              absolute,
              type: item.type,
              // FORK: REQ-067 — 经 ignoreRelativePath 归一大小写/分隔符 + safeIgnores 兜 ".." 逃逸,
              // 避免大小写不敏感卷(macOS)上 path.relative 产 "../x/.git" → ignore@7 RangeError → 500 [feat: stale-path-hardening]
              ignored: safeIgnores(
                ignored,
                ignoreRelativePath(location.project.directory, absolute) +
                  (item.type === "directory" ? "/" : ""),
              ),
            }
          })
        }),
      )
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.query.path)
      if (!FSUtil.contains(directory, file)) return yield* Effect.die(new Error("Path escapes the location"))
      if (!(yield* FSUtil.Service.use((fs) => fs.existsSafe(file)))) return { type: "text" as const, content: "" }
      // FORK-BEGIN: office 分类(上游 #30447 删 src/file/ 后迁来 server content handler)[feat: electron-replatform]
      if (isOfficeConvert(ctx.query.path)) {
        // pre-warm 转换;前端经 office-pdf-ref MIME 探测后从 /file/office-pdf 取真 PDF 字节
        const pdfBytes = yield* Effect.promise(() => LibreOffice.convertToPdf(file).catch(() => undefined))
        if (!pdfBytes) return { type: "binary" as const, content: "" }
        return { type: "text" as const, content: "", mimeType: OFFICE_PDF_REF_MIME }
      }
      if (isOfficeDirect(ctx.query.path)) {
        return yield* filesystem(
          FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(ctx.query.path) })),
        ).pipe(
          Effect.map((item) => ({
            type: "text" as const,
            content: Buffer.from(item.content).toString("base64"),
            encoding: "base64" as const,
            mimeType: getOfficeMimeType(ctx.query.path),
          })),
        )
      }
      // FORK-END
      return yield* filesystem(
        FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(ctx.query.path) })),
      ).pipe(
        Effect.flatMap((item) =>
          Effect.gen(function* () {
            const text = item.content.includes(0)
              ? Option.none<string>()
              : yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(item.content)).pipe(
                  Effect.option,
                )
            return { item, text }
          }),
        ),
        Effect.map(({ item, text }) =>
          Option.isSome(text)
            ? { type: "text" as const, content: text.value.trim() }
            : {
                type: "binary" as const,
                content: Buffer.from(item.content).toString("base64"),
                encoding: "base64" as const,
                mimeType: item.mime,
              },
        ),
      )
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return []
    })

    // FORK-BEGIN: office routes handlers(office-routes-effect-httpapi 2026-05-03)[feat: electron-replatform]
    const officePdf = Effect.fn("FileHttpApi.officePdf")(function* (ctx: { query: { path: string } }) {
      const filePath = ctx.query.path
      const directory = (yield* InstanceState.context).directory
      const full = path.isAbsolute(filePath) ? filePath : path.join(directory, filePath)
      const bytes = yield* Effect.promise(() => LibreOffice.convertToPdf(full).catch(() => undefined))
      if (!bytes || bytes.length === 0) return new Uint8Array()
      return bytes
    })

    const officeToolingStatus = Effect.fn("FileHttpApi.officeToolingStatus")(function* () {
      return yield* Effect.promise(() => OfficeInstaller.status())
    })

    const officeToolingInstall = Effect.fn("FileHttpApi.officeToolingInstall")(function* () {
      // 启动后台 install 但立即返回当前 status(避免 client 等待数分钟下载)
      yield* Effect.promise(() => OfficeInstaller.startInstall())
      return yield* Effect.promise(() => OfficeInstaller.status())
    })

    const officeToolingProgress = Effect.fn("FileHttpApi.officeToolingProgress")(function* () {
      return OfficeInstaller.getProgress()
    })
    // FORK-END

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
      // FORK-BEGIN: office routes 注册 [feat: electron-replatform]
      .handle("officePdf", officePdf)
      .handle("officeToolingStatus", officeToolingStatus)
      .handle("officeToolingInstall", officeToolingInstall)
      .handle("officeToolingProgress", officeToolingProgress)
      // FORK-END
  }),
).pipe(Layer.provide(locationServiceMapLayer))
