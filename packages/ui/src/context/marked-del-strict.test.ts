// [fork-only] REQ-098 单波浪号误判删除线单测 [feat: chat-tilde-del-fix] 2026-08-07
//
// bug-repro:同一行两个「数字~数字」区间时,GFM 内置 `~~?` 规则把中间整段闭合成 <del>。
// 注意 ⚠️:单区间(全句只有一个 `~`)、`~5%`、`~/path` 这些【修前本来就不会被划】,
// 拿它们当验收用例是无效的 —— 见文末"无效用例"一组(用 BEFORE 断言把这条钉死)。
import { describe, expect, test } from "bun:test"
import { Marked } from "marked"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { STRICT_DEL_RE, strictDelExtension } from "./marked-del-strict"

/** 修后解析(接入 strictDelExtension) */
const after = (src: string) => new Marked().use(strictDelExtension).parse(src) as string
/** 修前解析(marked 原样) */
const before = (src: string) => new Marked().parse(src) as string

// 同一行两个区间 —— 真正会触发的形态
const REPRO = [
  "预计在 4.80~5.05 区间内震荡,突破 5.20~5.35 的概率低",
  "波动 0.5%~1.2%,回撤 3%~5%",
  "PE 12~15 倍,PB 1.2~1.8 倍",
]

describe("REQ-098 单波浪号误判删除线", () => {
  describe("bug-repro:同行两个数值区间", () => {
    for (const src of REPRO) {
      test(`修前被划 / 修后不划 — ${src}`, () => {
        expect(before(src)).toContain("<del>") // 修前确实中招(bug 存在的证据)
        expect(after(src)).not.toContain("<del>") // 修后不再中招
      })
    }

    test("区间数字原样保留(不是靠删字符躲开的)", () => {
      const html = after(REPRO[0])
      expect(html).toContain("4.80~5.05")
      expect(html).toContain("5.20~5.35")
    })
  })

  describe("不回归:标准 GFM `~~删除~~` 仍要工作", () => {
    test("单个删除线", () => {
      expect(after("~~删掉~~")).toContain("<del>删掉</del>")
    })

    test("同行两个删除线", () => {
      const html = after("~~a~~ 和 ~~b~~")
      expect(html).toContain("<del>a</del>")
      expect(html).toContain("<del>b</del>")
    })

    test("删除线内嵌套 inline(粗体)不丢", () => {
      expect(after("~~跨 **粗体** 删除~~")).toContain("<del>跨 <strong>粗体</strong> 删除</del>")
    })

    test("与修前对同一段 `~~` 输入产出完全一致(最小差分)", () => {
      for (const src of ["~~删掉~~", "~~a~~ 和 ~~b~~", "~~跨 **粗体** 删除~~"]) {
        expect(after(src)).toBe(before(src))
      }
    })
  })

  describe("不受影响的路径", () => {
    test("行内代码里的区间原样进 <code>", () => {
      const html = after("代码 `4.80~5.05` 不受影响")
      expect(html).toContain("<code>4.80~5.05</code>")
      expect(html).not.toContain("<del>")
    })

    test("围栏代码块内不受影响", () => {
      const html = after("```\n4.80~5.05 和 5.20~5.35\n```")
      expect(html).not.toContain("<del>")
    })
  })

  describe("无效用例(修前就不会被划,别拿来当验收)", () => {
    for (const src of ["约 ~5% 到 ~10% 之间", "路径 ~/a 和 ~/b", "预计在 4.80~5.05 区间内震荡"]) {
      test(`修前修后都不划 — ${src}`, () => {
        expect(before(src)).not.toContain("<del>")
        expect(after(src)).not.toContain("<del>")
      })
    }
  })

  describe("实现陷阱", () => {
    test("非匹配返回 undefined(返 false 会回退内置 `~~?` 规则,等于没改)", () => {
      const lexer = { inlineTokens: () => [] }
      const del = strictDelExtension.tokenizer!.del!
      expect(del.call({ lexer } as never, "4.80~5.05 区间")).toBeUndefined()
    })

    test("返 false 的写法确实会失效(反例固化,防后人「改成 false 更直觉」)", () => {
      const falsy = {
        tokenizer: {
          del(this: { lexer: { inlineTokens: (s: string) => unknown[] } }, src: string) {
            const cap = STRICT_DEL_RE.exec(src)
            if (!cap) return false
            return { type: "del", raw: cap[0], text: cap[2], tokens: this.lexer.inlineTokens(cap[2]) }
          },
        },
      }
      expect(new Marked().use(falsy as never).parse(REPRO[0]) as string).toContain("<del>")
    })
  })

  describe("防漂移守卫:web share 页那份副本", () => {
    // Win core.autocrlf=true 时 checkout 出来是 CRLF,归一化后守卫正则(要求 `/` 紧贴 `\n`)才能双端一致
    const webCopy = readFileSync(
      join(import.meta.dir, "../../../web/src/components/share/marked-del-strict.ts"),
      "utf-8",
    ).replace(/\r\n/g, "\n")

    test("web 副本存在且导出同名扩展", () => {
      expect(webCopy).toContain("export const strictDelExtension")
      expect(webCopy).toContain("export const STRICT_DEL_RE")
    })

    test("两份正则字面量逐字一致(改一处忘改另一处 → 这条红)", () => {
      const match = webCopy.match(/export const STRICT_DEL_RE = (\/.*\/)\n/)
      expect(match).not.toBeNull()
      expect(match![1]).toBe(STRICT_DEL_RE.toString())
    })

    test("web 副本的 tokenizer 同样返 undefined 而非 false", () => {
      expect(webCopy).toContain("return undefined")
      expect(webCopy).not.toMatch(/if \(!cap\) return false/)
    })

    test("share 页与聊天页对同一输入产出一致(同一份 tokenizer 语义)", async () => {
      const web = await import("../../../web/src/components/share/marked-del-strict")
      for (const src of [...REPRO, "~~删掉~~", "代码 `4.80~5.05` 不受影响"]) {
        expect(new Marked().use(web.strictDelExtension).parse(src)).toBe(after(src))
      }
    })
  })
})
