feat-id: chat-tilde-del-fix
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-098 聊天渲染:单波浪号被误判成删除线

> 来源:`OPENCODE-PLAN/需求计划/2026-08-07.md`(小成本确定性收口批,IN SCOPE 第 1 条)
> 规模:**Medium**(2 个包各加一次 tokenizer override + 单测 + 防漂移守卫)
> 核查基线:fork HEAD `26511dc6b4`(main)

## 需求

用户在聊天里让模型输出带数值区间的内容(金融/量化场景高频),同一行出现两个「数字~数字」区间时,中间整段被渲染成删除线,读起来像模型自我否定。属于**用户每天都在看**的渲染缺陷。

## 根因(源码复核 + 真 marked 实测,已独立复验)

GFM 内置 del tokenizer 的开闭定界符是 `~~?` —— **一个或两个 `~` 都算**:

```
del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/
```

同一行出现第二个 `~` 时即闭合成 `<del>`。真 marked 17.0.1 实测(2026-08-07 复验):

| 输入 | 修前 |
|---|---|
| `预计在 4.80~5.05 区间内震荡,突破 5.20~5.35 的概率低` | `预计在 4.80<del>5.05 区间内震荡,突破 5.20</del>5.35 的概率低` |
| `波动 0.5%~1.2%,回撤 3%~5%` | `波动 0.5%<del>1.2%,回撤 3%</del>5%` |
| `PE 12~15 倍,PB 1.2~1.8 倍` | `PE 12<del>15 倍,PB 1.2</del>1.8 倍` |

**判据修正(直接决定验收用例有效性)**:内置规则还要求开 `~` 后紧跟非空白非 `~`、闭 `~` 前也是非空白非 `~`。所以下面这些**修前本来就不会被划**,不能拿来当验收用例:

- `约 ~5% 到 ~10% 之间`(闭合侧是空格)— 实测无 `<del>`
- `路径 ~/a 和 ~/b`(同上)— 实测无 `<del>`
- `预计在 4.80~5.05 区间内震荡`(全句只有一个 `~`)— 实测无 `<del>`

### 解析链路定位:只有一个 parser 在产 `<del>`

| 环节 | 事实(已复验) |
|---|---|
| `MarkedProvider` 使用点 | 全仓仅 1 处 `packages/app/src/app.tsx`,裸 `<MarkedProvider>`,**未传 `nativeParser`** |
| 分支 | `packages/ui/src/context/marked.tsx:633` `if (props.nativeParser)` 才走原生,否则返回 `jsParser` |
| `platform.parseMarkdown` | renderer→preload→ipc→main 接线存在,但**全仓零消费方** |
| 实际解析版本 | `packages/ui` + `packages/web` 的 `marked` 均软链到 **17.0.1**(catalog 锁 17.0.1) |

→ `packages/desktop/src/main/markdown.ts`(`marked ^15`)对聊天渲染是**死路径**,不改、也不升版本对齐。

### 波及面:share 分享页同病

`packages/web/src/components/share/content-markdown.tsx:9` 的 `markedWithShiki = marked.use(...)` 同为 marked 17 且无 del 定制 → 分享页同样误判。**`marked.use()` 作用于各自模块实例,ui 的改动不会传导到 web** → 必须各自加一次。

## 方案(定稿)

在两处 `marked.use(...)` 的参数列表里各加一次同款 tokenizer override,把 del 收紧成**只认 `~~`**:

```ts
del(src: string) {
  const cap = /^(~~)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/.exec(src)
  if (!cap) return undefined
  return { type: "del", raw: cap[0], text: cap[2], tokens: this.lexer.inlineTokens(cap[2]) }
}
```

**⚠️ 非匹配必须返 `undefined`,不能返 `false`。** marked 的 `use()` 覆盖回退语义为 `c === false && (c = 内置实现(...))` —— 返 `false` 会**回退内置规则**,等于没改。已用对照组实测确认:返 `false` 时三条 bug 用例全部照旧产出 `<del>`。

**不做跨包复用**:`packages/web` 不依赖 `@opencode-ai/ui`(已核 `packages/web/package.json`),为复用而新建跨包依赖不划算。两处各放一份 fork-only 小模块(内容逐字相同),再加一条**防漂移守卫测试**保证两份不走偏。

## 测试用例清单(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | `预计在 4.80~5.05 区间内震荡,突破 5.20~5.35 的概率低` | unit(ui) | 修后 HTML **不含** `<del>`;修前含(bug-repro 断言) |
| T2 | `波动 0.5%~1.2%,回撤 3%~5%` | unit(ui) | 同 T1 |
| T3 | `PE 12~15 倍,PB 1.2~1.8 倍` | unit(ui) | 同 T1 |
| T4 | `~~删掉~~` | unit(ui) | 仍产 `<del>删掉</del>`(不回归) |
| T5 | `~~a~~ 和 ~~b~~` | unit(ui) | 仍产两个 `<del>`(不回归) |
| T6 | `~~跨 **粗体** 删除~~` | unit(ui) | `<del>跨 <strong>粗体</strong> 删除</del>`(嵌套 inline 不丢) |
| T7 | 代码块/行内代码 `` `4.80~5.05` `` | unit(ui) | 原样进 `<code>`,不受影响 |
| T8 | 单区间 `预计在 4.80~5.05 区间内震荡` | unit(ui) | 修前修后都无 `<del>`(**记录为"无效用例"防后人误用**) |
| T9 | ui 与 web 两份 del 模块正则源逐字一致 | unit(ui,防漂移守卫) | 相等,否则 fail |
| T10 | share 页与聊天页对同一段输入产出一致(均无 `<del>`) | unit(ui 跑 web 那份模块) | 一致 |
| T11 | 真机:DeskFox 里让模型回一段含两个数值区间的内容 | 真机 | 肉眼确认不再被划 |
| T12 | 真机:打开一条 share 链接页,同段内容 | 真机(可延后) | 同 T11 |

> T1–T10 已在真 marked 17.0.1 上以脚本形式跑通(2026-08-07 复验),施工时落成正式单测即可。

## 验收标准

- [ ] `packages/ui/src/context/marked.tsx` 与 `packages/web/src/components/share/content-markdown.tsx` **两处都改**,只改一处不算完成
- [ ] T1–T10 单测在 `packages/ui` 全绿(`bun test src` / turbo `@opencode-ai/ui#test`)
- [ ] 非匹配路径返 `undefined`(代码注释显式写明这条陷阱)
- [ ] T11 真机确认
- [ ] commit 带 `[override-blacklist: ...]`(见下)与 `[feat: chat-tilde-del-fix]`

## 治理约束(R2 / R4)

- `packages/ui/` 与 `packages/web/` **整包在 pre-commit 路径黑名单内**(`.husky/pre-commit:17`),即使新增 fork-only 文件也会被拦 → 本 feat **必须走 R4 override**,commit 打 `[override-blacklist: ...]`,3-changelog 附 wrapper 不可行性论证 + user 二次确认。
- **wrapper 不可行性(R4 论证要点)**:marked 的 tokenizer 覆盖必须通过 `marked.use()` 注册进**该模块实例**;两处 parser 实例分别构造于 ui / web 内部,外部无注入点(`MarkedProvider` 只暴露 `nativeParser` 开关,不接受扩展)。**已有同类先例**:`f5b22a840d` / `f7b79f5b94` / `2c2102295d` 三笔均以同样理由 override 过 `ui/marked.tsx`。
- 改上游文件按 R2 加 `// FORK: <reason> <YYYY-MM-DD>`。

## 边界 / 明确不做

- **不升 marked 版本**,不对齐 `packages/desktop/src/main/markdown.ts`(`^15`)—— 已确认对聊天渲染是死路径,升版本是独立回归风险。
- **不清理 `platform.parseMarkdown` 死接线** —— 独立清理项,删了可能影响未来接 native parser 的意图。
- 不改单个 `~` 的其他语义(`~/path`、`~5%` 等本来就不受影响)。
