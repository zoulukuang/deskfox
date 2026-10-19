import { expect, test } from "bun:test"
import { solidStart } from "@solidjs/start/config"
import { resolveConfig, type PluginOption } from "vite"
import path from "node:path"

test("SolidStart app entry define round-trips the native filesystem path", async () => {
  const config = await resolveConfig({ configFile: false, plugins: solidStart() as PluginOption[] }, "serve")
  expect(JSON.parse(config.define!["import.meta.env.START_APP_ENTRY"])).toBe(path.join(process.cwd(), "src", "app.tsx"))
  expect(JSON.parse(config.define!["import.meta.env.START_CLIENT_ENTRY"])).toBe("./src/entry-client.tsx")
})

test("SolidStart discovers API and public page routes with URL separators", async () => {
  const { SolidStartServerFileRouter } = await import(new URL("./fs-router.js", import.meta.resolve("@solidjs/start/config")).href)
  const router = new SolidStartServerFileRouter({ dir: path.resolve("src/routes"), extensions: ["ts", "tsx"] })
  const routes = await router.buildRoutes()
  expect(routes.find((route: { path: string }) => route.path === "/api/*path")).toHaveProperty("$POST")
  expect(routes.find((route: { path: string }) => route.path === "/share/:shareID")).toHaveProperty("$component")
})
