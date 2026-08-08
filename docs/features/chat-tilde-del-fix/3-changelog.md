feat-id: chat-tilde-del-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志 — REQ-098 单波浪号误判删除线

**规模**:Medium(新增 4 文件,改上游 2 文件各 ~4 行)
**分支**:`feat/small-cost-cleanup-batch`
**commit**:`96c9e50ddf`(R4 override,user 2026-08-07 审批通过)
**R4 override**:**需要**(`packages/ui/` + `packages/web/` 整包在 pre-commit 黑名单)—— 论证见文末

## 实际改动

| 文件 | 改动 | 行数(约) |
|---|---|---|
| `packages/ui/src/context/marked-del-strict.ts` | 新增(fork-only):`STRICT_DEL_RE` + `strictDelExtension`,含"必须返 undefined"陷阱注释 | +40 |
| `packages/ui/src/context/marked.tsx` | `marked.use(...)` 参数列表插入 `strictDelExtension` + import,带 FORK marker | +6 |
| `packages/web/src/components/share/marked-del-strict.ts` | 新增:ui 那份的逐字副本(仅互指注释一行不同) | +40 |
| `packages/web/src/components/share/content-markdown.tsx` | `markedWithShiki = marked.use(...)` 插入 `strictDelExtension` + import,带 FORK marker | +5 |
| `packages/ui/src/context/marked-del-strict.test.ts` | 新增:19 测(bug-repro / 不回归 / 无效用例固化 / 陷阱反例 / 防漂移守卫) | +140 |
| `packages/app/e2e/regression/chat-tilde-del-v2026.8.7.spec.ts` | 新增:前端界面 e2e(真实渲染链路,mock server → 时间线 → markdown) | +85 |

## 根因与修法

GFM 内置 del tokenizer 定界符是 `~~?`(一或两个 `~`),同一行两个「数字~数字」区间即被闭合成 `<del>`。收紧成只认 `~~`,其余前后瞻断言逐字保留内置规则(最小差分)。

**两处都改**:`marked.use()` 作用于各自模块实例,ui 的改动不会传导到 web share 页;web 不依赖 `@opencode-ai/ui`,不为一个 tokenizer 建跨包依赖 → 两份逐字副本 + 守卫测试防漂移。

**陷阱**:非匹配必须返 `undefined`。marked 的覆盖包装是 `c === false && (c = 内置(...))`,返 `false` 会回退内置规则 = 完全没改。已把"返 false 的反例"固化成测试用例。

## 影响范围

- 桌面聊天 + 文件 markdown 预览(同一 `MarkedProvider` 实例)+ web share 分享页。
- 单个 `~` 的其他用法(`~/path`、`~5%`、单区间)**修前本来就不会被划**,行为无变化(已用 BEFORE 断言固化,防后人拿它们当验收用例)。
- `~~删除~~` 路径与修前**位元一致**(测试直接断言 `after(src) === before(src)`)。
- 未动 `packages/desktop/src/main/markdown.ts`(marked ^15):经复核对聊天渲染是死路径。

## 回归测试

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | 22/22 ✅ |
| `packages/ui` 全量 `bun test src` | **52 pass / 0 fail** |
| `packages/app` 全量单测 `bun run test` | **606 pass / 0 fail** |
| 新增单测(19) | 全绿;含 3 组 bug-repro 的 BEFORE/AFTER 对照 |
| **前端界面 e2e**(Playwright,真实渲染链路) | ✅ 1 passed |
| e2e 反证(撤掉修复后重跑) | ✅ 1 failed,实测抓到 `预计在 4.80<del>5.05 区间内震荡,突破 5.20</del>5.35 的概率低` |
| web share 页接线 | `bun build` 转译通过,产物中 `marked.use(strictDelExtension, …)` 首参正确 |

## 打包产物验证

`packages/desktop/out/renderer/assets/main-*.js` 内含收紧后的正则 → 修复确实进了打包后的渲染器。
所有产 HTML 的路径都走 `ui/context/marked.tsx` 的单一 parser 实例(`useMarked()` 经 context 下发);
`markdown-stream.ts` 虽直接 import marked,但只用 `marked.lexer` 做代码围栏切块、不产 HTML,不受影响。

✅ **桌面侧真机已验(2026-08-08,user 实测)**:在本地版 DeskFox 里让模型回一段含两个数值区间的内容,肉眼确认不再被划掉。

## ⚠️ share 分享页的实际生效范围(2026-08-08 追查澄清)

**本 feat 改的 web 那半边,今天对用户不生效**,原因不是没改对,是**页面不归我们部署**:

| 事实 | 位置 |
|---|---|
| 分享链接域名写死上游 `https://opncd.ai` | `packages/opencode/src/share/share-next.ts:210`(`enterprise?.url ?? "https://opncd.ai"`) |
| DeskFox **不部署 web 站点**,只发桌面端 | — |
| 仓内 share viewer 只有 **legacy `/s/<id>`** 路由 | `packages/web/src/pages/s/[id].astro`(SSR `fetch ${VITE_API_URL}/share_data?id=`) |
| 新链接 `/share/<id>` 的页面代码**不在本仓**(`packages/console` 里也没有) | 上游自建部署 |

→ 用户点「分享」拿到的链接由**上游服务器渲染上游代码**。本 feat 的 web 改动价值在于:① 将来自建分享站时不留坑 ② 把修复提 PR 给上游时是现成的。

## ✅ share 页浏览器实操已补(2026-08-08,user 拍板执行)

**新增 follow-up commit**:给 share 分享页补了真浏览器渲染的 e2e —— 之前只到组件层。

| 文件 | 作用 |
|---|---|
| `packages/app/playwright.web-share.deskfox.config.ts` | 独立 playwright 配置(文件名带 `.deskfox` —— pre-commit 黑名单拦 `*.config.ts`,EXCEPTION 放行 fork 自有的 `*.deskfox.config.ts`)(启 Astro dev + 假后端;不并进主配置,免每次跑聊天页 e2e 白等 ~30s) |
| `packages/app/e2e/utils/share-fixture.ts` | SSR 与 WebSocket 两条链路共用的 fixture |
| `packages/app/e2e/utils/share-fixture-server.ts` | `/share_data` 假后端(node:http) |
| `packages/app/e2e-web-share/share-tilde-del-v2026.8.7.spec.ts` | 真浏览器打开分享页,断言无 `<del>` + `~~删除~~` 不回归 |
| `packages/app/package.json` | 加 `test:e2e:web-share` 脚本(零新增依赖,复用 app 已有 @playwright/test) |

跑法:`bun run --cwd packages/app test:e2e:web-share` → **1 passed**。
**反证有效**:撤掉 `content-markdown.tsx` 里的 `strictDelExtension` 重跑 → 1 failed,实测抓到
`预计在 4.80<del>5.05 区间内震荡,突破 5.20</del>5.35 的概率低`。

**测试文件放 `packages/app` 而非 `packages/web`**:web 在 pre-commit 黑名单且零测试基建(无 test 脚本、无 playwright 依赖),放这里零新增依赖、不动 `bun.lock`、不多耗一笔 R4 override。

### 搭这套时踩的四个坑(都写进了配置注释)

1. **Clash 代理劫 localhost** —— astro 的 SSR 跑在 Cloudflare adapter 的 wrangler/workerd 里,它认 `HTTP(S)_PROXY`;本机 `~/.zshenv` 全局设了 Clash 代理 → SSR fetch 报 `fetch failed / other side closed`(假后端**根本收不到请求**),页面 500。配置里把代理变量置空 + `NO_PROXY=127.0.0.1,localhost` 才通。同类坑见 `reference_local_test_env_false_failures`。
2. **WebSocket 只能 mock 不能真起** —— `Share.tsx` 把 URL 强制成 `wss://`(`apiUrl.replace(/^https?:\/\//, "wss://")`),真起 WS 服务就得配自签 TLS;改用 Playwright `routeWebSocket` 直接在浏览器侧 mock,零 TLS。
3. **SSR 的 fetch 拦不到** —— `/share_data` 发生在 astro 服务进程里,`page.route` 够不着 → 必须真起一个假后端。且**要用 `node:http`**:workerd 打 `Bun.serve` 会 `other side closed`。
4. **路径必须带 `/docs` 前缀** —— 站点 base 是 `/docs`(starlight);裸 `/s/<id>` 在 `Accept: text/html` 下返回 404(非 HTML 请求反而 200,极易误判"路由没问题")。
5. **spec 必须放 `e2e-web-share/` 而非 `e2e/web-share/`** —— 主配置 `playwright.config.ts` 的 testDir 是 `./e2e`,会连带扫到这条 spec(它要额外两个 server,裸跑必挂,pre-push 跑 e2e 时同样炸)。挪出去即可,免改黑名单里的主配置。
6. 本机跑需要 `PLAYWRIGHT_BROWSERS_PATH=/Volumes/ExtSSD/devcache/ms-playwright`(定义在 `~/.zshrc`,非交互 shell 取不到)。

## 回退方法

`git revert <commit>`(一笔含两包改动)。回退后恢复内置 `~~?` 行为。

---

## R4 override 复核报告(single-person 二次确认用)

**① wrapper 替代不可行性**
marked 的 tokenizer 覆盖必须经 `marked.use()` 注册进**该模块实例**;两处 parser 实例分别在 `ui/src/context/marked.tsx` 与 `web/.../content-markdown.tsx` 内部构造,外部没有注入点(`MarkedProvider` 只暴露 `nativeParser` 开关,不接受扩展)。fork-only 新文件放在这两个包里同样触黑名单(路径规则是**整包**级)。
**先例**:`f5b22a840d` / `f7b79f5b94` / `2c2102295d` 三笔均以同一理由 override 过 `ui/marked.tsx`。

**② 风险评估**
- 上游冲突面:上游文件各 +4 行(1 行 import + 3 行注释/参数),带 FORK marker,merge 时是"上游新增 vs fork 加一行"的机械冲突,`UPSTREAM-MERGE-GUIDE §4.3` 三原则可解。
- 功能风险:低。`~~` 路径产出与修前位元一致(测试断言);仅影响单 `~` 的宽松扩展(非 GFM 标准)。
- 漂移风险:两份副本 → 已由守卫测试(比对正则字面量 + 行为一致)机器化。

**③ 逐文件论证**
| 文件 | 为什么必须动 |
|---|---|
| `ui/src/context/marked.tsx` | 唯一产 HTML 的 parser 实例构造点,扩展只能在此注册 |
| `web/.../content-markdown.tsx` | share 页独立 bundle 独立实例,ui 改动不传导 |
| `ui/src/context/marked-del-strict.ts`(新) | 逻辑尽量放新文件(R1 三级跳),上游只留 1 行注入 |
| `web/.../marked-del-strict.ts`(新) | 同上;不建跨包依赖(web 不依赖 ui) |
| `ui/src/context/marked-del-strict.test.ts`(新) | R5 要求;ui 有 test 脚本与 turbo task,web 没有 |

**commit message 将标**:`[override-blacklist: marked tokenizer 覆盖必须 .use() 注册到各自 parser 实例,ui/web 两包无外部注入点,无 wrapper 替代]`
