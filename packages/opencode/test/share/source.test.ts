import { expect, test } from "bun:test"
import { ShareSource } from "../../src/share/source"

test("public targets have fixed origins and no organization identity", () => {
  expect(ShareSource.publicSource("cn")).toEqual({
    base_url: "https://deskfox.cn",
    api_resource: "share",
    account_id: null,
    org_id: null,
  })
  expect(ShareSource.publicSource("global").base_url).toBe("https://deskfox.ai")
})

test("recorded origin and account survive current service changes", () => {
  expect(
    ShareSource.recordedSource({
      base_url: "https://enterprise.example/base/",
      api_resource: "shares",
      account_id: "old",
      org_id: "old-org",
      url: "https://enterprise.example/share/id",
      id: "id",
    }),
  ).toEqual({
    base_url: "https://enterprise.example/base",
    api_resource: "shares",
    account_id: "old",
    org_id: "old-org",
  })
})

test("unknown or deceptive legacy links never become mutation destinations", () => {
  const row = { base_url: null, api_resource: null, account_id: null, org_id: null, id: "id" }
  for (const url of [
    "https://unknown.example/share/id",
    "https://deskfox.cn.evil.example/share/id",
    "https://user@deskfox.cn/share/id",
    "http://deskfox.cn/share/id",
    "https://deskfox.cn/share/other",
    "https://deskfox.cn/share/id?redirect=evil",
    "https://deskfox.cn/s/id",
  ])
    expect(() => ShareSource.recordedSource({ ...row, url })).toThrow()
  expect(ShareSource.recordedSource({ ...row, url: "https://deskfox.cn/share/id" }).base_url).toBe("https://deskfox.cn")
})

test("organization shares cannot fall back to a different account", () => {
  expect(() =>
    ShareSource.recordedSource({
      base_url: "https://enterprise.example",
      api_resource: "shares",
      account_id: null,
      org_id: "org",
      url: "https://enterprise.example/share/id",
      id: "id",
    }),
  ).toThrow()
})

test("remote create responses cannot redirect secrets to a different origin", () => {
  const source = ShareSource.publicSource("cn")
  const share = { id: "a".repeat(48), secret: "b".repeat(64), url: `https://deskfox.cn/share/${"a".repeat(48)}` }
  expect(ShareSource.checkedShare(share, source)).toBe(share)
  for (const url of [
    share.url.replace("deskfox.cn", "deskfox.ai"),
    `${share.url}?secret=value`,
    "https://deskfox.cn/share/wrong",
  ])
    expect(() => ShareSource.checkedShare({ ...share, url }, source)).toThrow()
  for (const base of ["file:///tmp", "https://token@example.com", "https://example.com?token=value"])
    expect(() => ShareSource.checkedBase(base)).toThrow()
})
