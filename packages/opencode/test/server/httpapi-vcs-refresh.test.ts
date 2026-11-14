import { expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { VcsRefreshPaths } from "../../src/server/routes/instance/httpapi/groups/vcs-refresh"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

test("VCS refresh route enforces auth, directory routing and bounded input", async () => {
  await using first = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  await using second = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  for (const directory of [first.path, second.path]) {
    await Bun.write(path.join(directory, "no-global-ignore"), "")
    const child = Bun.spawn(["git", "config", "core.excludesfile", path.join(directory, "no-global-ignore")], {
      cwd: directory,
    })
    expect(await child.exited).toBe(0)
  }
  await Bun.write(path.join(first.path, ".gitignore"), "*.log\n")
  const app = HttpRouter.toWebHandler(
    HttpApiApp.createRoutes().pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: "fixture-secret" }))),
    ),
    { disableLogger: true },
  )
  const request = (paths: unknown, auth = true, directory = first.path) => {
    const url = new URL(`http://localhost${VcsRefreshPaths.required}`)
    url.searchParams.set("directory", directory)
    return app.handler(
      new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencode-directory": first.path,
          ...(auth ? { authorization: "Basic " + btoa("opencode:fixture-secret") } : {}),
        },
        body: JSON.stringify({ paths }),
      }),
      HttpApiApp.context,
    )
  }
  try {
    expect((await request(["a.log"], false)).status).toBe(401)
    const ignored = await request(["a.log"])
    expect(ignored.status).toBe(200)
    expect(await ignored.json()).toEqual({ shouldRefresh: false })
    expect(await (await request(["a.log"], true, second.path)).json()).toEqual({ shouldRefresh: true })
    expect(await (await request(["../outside.log"])).json()).toEqual({ shouldRefresh: true })
    for (const paths of [
      [],
      [""],
      ["x\0y"],
      Array(129).fill("a.log"),
      ["x".repeat(4097)],
      Array(128).fill("x".repeat(600)),
      "wrong",
    ]) {
      expect((await request(paths)).status).toBe(400)
    }
  } finally {
    await app.dispose()
    await disposeAllInstances()
    await resetDatabase()
  }
}, 30000)
