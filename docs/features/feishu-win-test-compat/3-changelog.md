feat-id: feishu-win-test-compat
status: done
related: ./3-changelog.md

# 3-changelog · 飞书单测 Windows 兼容修复(Tiny)

> Tiny(4 文件 / 净 +6 行)→ 按规范只写本 changelog。

## 问题

`feishu-image-recognition` / `feishu-merge-forward` 那批在 **Mac 验"622 全过"**,但在 **Windows 跑 607 pass / 15 fail**(merge 到 main 前的合并态体检发现)。`[bug-repro: 飞书单测在 Windows 15 fail]` —— 失败的测试自身即复现。

## 根因 + 修法(commit `b6e2f2f4a`)

| # | 类型 | 修法 | 修几个 |
|---|---|---|---|
| 1 | **真 Windows 代码 bug** `image-downloader.ts` | 路径越界 assert 用 `resolve(p) + "/"` 后 `startsWith`;Win 上 resolve 返反斜杠路径、硬加 `/` 致前缀永不匹配 → **所有飞书图片下载误报"落盘路径越界"失败**(真实 Win 用户收图全挂)。改 `+ "/"` → `+ path.sep` | 6(I1/I3/I4/I5/S3/S4)+ 真实用户 |
| 2 | 测试用 Unix 路径 `reply-actions.test.ts` | `classifyAttachment` 代码本就用 `sep`(对);测试 `ROOT="/tmp/test-workspace"` 在 Win 被 resolve 成带盘符 `C:\tmp\...` 对不上 → 全 reject。改 `ROOT = resolve(...)`,安全语义不变 | 6 |
| 3 | 断言写死 `/` `secret-ref.test.ts` | `defaultFilePath` 代码用 `join`(对);测试 `toContain(".opencode/feishu-secrets")` 在 Win(`\`)失败。改 `toContain(join(".opencode","feishu-secrets"))` | 1 |
| 4 | 时序裕度太窄 `dedup.test.ts` | 2 个 TTL 刷新测试 ttl 30 / sleep 20+20,Win `setTimeout` ~16ms 粒度抖动把"未过期"翻成"过期"。放大到 ttl 300 / sleep 100 | 2 |

只 #1 是代码 bug(影响真实 Windows 用户),#2-#4 纯测试侧。`resolve`/`join`/`sep` 跨平台一致,Mac 语义不变。

## 测试 / 回归

修后 **飞书 622 pass / 0 fail(Windows)** + 全仓 typecheck 17/17。起源:这 15 个 fail 是 media-gen 合并前体检时实证为 origin/main 自带(纯 origin/main 同样 607/15),非 media-gen 引入。

## 回退

revert `b6e2f2f4a`。注意 #1 是真 bug 修复,回退会让 Windows 用户重新无法下载飞书图片。
