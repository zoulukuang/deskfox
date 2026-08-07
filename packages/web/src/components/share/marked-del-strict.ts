// FORK-ONLY: REQ-098 单波浪号误判删除线 —— 收紧 GFM del 定界符 [feat: chat-tilde-del-fix] 2026-08-07
//
// GFM 内置 del tokenizer 的定界符是 `~~?`(一个或两个 `~` 都算),于是同一行出现两个
// 「数字~数字」区间时,第二个 `~` 直接把中间整段闭合成 <del>:
//   预计在 4.80~5.05 区间内震荡,突破 5.20~5.35 的概率低
//   → 预计在 4.80<del>5.05 区间内震荡,突破 5.20</del>5.35 的概率低
// 金融/数值场景高频(区间、百分比区间、PE/PB 区间),读起来像模型自我否定。
//
// 这里把定界符收紧成只认 `~~`(GFM 标准写法),其余前后瞻断言逐字保留内置规则 ——
// 最小差分,`~~删除~~` 路径行为与上游位元一致,将来升级 marked 对比成本最低。
//
// ⚠️⚠️ 非匹配必须返 undefined,绝不能返 false:
//   marked 的 tokenizer 覆盖包装是 `c = 覆盖(...); c === false && (c = 内置(...))`,
//   返 false 会【回退内置实现】→ 改动完全失效(已实测:返 false 时三条 bug 用例照旧产 <del>)。
//
// ⚠️ packages/ui/src/context/marked-del-strict.ts 是本文件的逐字副本
//    (web 不依赖 @opencode-ai/ui,不为一个 tokenizer 建跨包依赖)。
//    两份不得漂移 —— 由 marked-del-strict.test.ts 的守卫用例比对。

import type { MarkedExtension, Tokens } from "marked"

/** 只认 `~~`(而非内置的 `~~?`)的 del 规则。其余断言与 marked 17 内置规则逐字一致。 */
export const STRICT_DEL_RE = /^(~~)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/

/** 传给 `marked.use(...)` 的扩展:覆盖 del tokenizer。 */
export const strictDelExtension: MarkedExtension = {
  tokenizer: {
    del(src) {
      const cap = STRICT_DEL_RE.exec(src)
      if (!cap) return undefined // ← 必须 undefined,返 false 会回退内置 `~~?` 规则
      return {
        type: "del",
        raw: cap[0],
        text: cap[2],
        tokens: this.lexer.inlineTokens(cap[2]),
      } satisfies Tokens.Del
    },
  },
}
