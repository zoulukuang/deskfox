import { expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"

test("published OpenAPI advertises both explicit public share targets", () => {
  const document = OpenApi.fromApi(PublicApi)
  expect(document.paths["/session/{sessionID}/share"]?.post?.parameters).toContainEqual({
    name: "shareTarget",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["cn", "global"] },
  })
})
