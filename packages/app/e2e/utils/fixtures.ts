// FORK: e2e 共享 fixtures 库 —— 把常见 mock 场景(项目/会话/provider/消息 part/文件列表)抽成
//   可拼装的 builder,新 spec 直接组合,不再从零造数据。配合 mock-server.ts 使用。
//   原则:断言优先 data-*/aria;文案在 playwright.config.ts 已钉 en-US。2026-06-18
//   背景与方法论见 OPENCODE-PLAN 协作方案/前端自动化测试-工具与方法论.md §三。

const T0 = 1_700_000_000_000

export function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export const defaultModel = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

export function makeProvider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

// global 项目 worktree="/"、id="global",走 project.meta 不走 update;非-global 才走 update(REQ-064 onError 路径)。
export function makeProject(opts: { id?: string; directory: string; name?: string; global?: boolean } = { directory: "C:/OpenCode/Fixture" }) {
  return {
    id: opts.global ? "global" : (opts.id ?? "proj_fixture"),
    worktree: opts.global ? "/" : opts.directory,
    vcs: "git",
    name: opts.name ?? "fixture-project",
    time: { created: T0, updated: T0 },
    sandboxes: [],
  }
}

export function makeSession(opts: { id: string; projectID: string; directory: string; title?: string; slug?: string }) {
  return {
    id: opts.id,
    slug: opts.slug ?? "fixture",
    projectID: opts.projectID,
    directory: opts.directory,
    title: opts.title ?? "Fixture session",
    version: "dev",
    time: { created: T0, updated: T0 },
  }
}

export function textPart(id: string, text: string) {
  return { id, type: "text", text }
}

export function reasoningPart(id: string, text: string) {
  return { id, type: "reasoning", text, time: { start: T0, end: T0 + 500 } }
}

export function userMessage(opts: { id: string; sessionID: string; text?: string }) {
  return {
    info: {
      id: opts.id,
      sessionID: opts.sessionID,
      role: "user",
      time: { created: T0 },
      summary: { diffs: [] },
      agent: "build",
      model: defaultModel,
    },
    parts: [{ id: `${opts.id}_text`, sessionID: opts.sessionID, messageID: opts.id, type: "text", text: opts.text ?? "Hello." }],
  }
}

// parts 按传入顺序渲染(stream 天然顺序):要验「reasoning 在正文上方」就把 reasoning 排在 text 前。
export function assistantMessage(opts: { id: string; sessionID: string; parentID: string; parts: Record<string, unknown>[] }) {
  return {
    info: {
      id: opts.id,
      sessionID: opts.sessionID,
      role: "assistant",
      time: { created: T0 + 1_000, completed: T0 + 2_000 },
      parentID: opts.parentID,
      modelID: defaultModel.modelID,
      providerID: defaultModel.providerID,
      mode: "build",
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 50, cache: { read: 0, write: 0 } },
      variant: "max",
    },
    parts: opts.parts.map((p) => ({ ...p, sessionID: opts.sessionID, messageID: opts.id })),
  }
}

// /file?path= 列目录条目。type: "directory" | "file"。给文件树类 spec(如 REQ-062 文件夹选中态)用。
export function fileEntry(opts: { name: string; parent?: string; type?: "directory" | "file"; ignored?: boolean }) {
  const parent = opts.parent ?? ""
  const rel = parent ? `${parent}/${opts.name}` : opts.name
  return {
    name: opts.name,
    path: rel,
    absolute: `/${rel}`,
    type: opts.type ?? "directory",
    ignored: opts.ignored ?? false,
  }
}
