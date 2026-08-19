// FORK-ONLY: REQ-115 聊天区 LaTeX 定界符矩阵 [feat: session-presentation-input-batch] 2026-08-17
//
// 锁两件事:
//   ① 该渲染的渲染、**该保持裸文本的也锁住**(货币零误伤是硬验收);
//   ② katexExtension 已收口成单一来源 —— 两条渲染路径(worker 的 createMarkdownParser 与
//      marked.tsx 的 jsParser)吃的是同一个对象,不再可能"只修一半"。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Marked } from "marked"
import { createMarkdownParser, katexExtension } from "./marked-parser"

const highlight = (code: string, language: string) => `<pre data-language="${language}">${code}</pre>`

// 路径 A:worker 侧真实入口
const workerParser = createMarkdownParser(highlight)
// 路径 B:marked.tsx 的 jsParser 走的是同一个 katexExtension(它从本模块 import)
const jsParser = new Marked().use(katexExtension)

const paths: [string, (md: string) => string | Promise<string>][] = [
  ["worker createMarkdownParser", (md) => workerParser.parse(md)],
  ["marked.tsx jsParser", (md) => jsParser.parse(md)],
]

const KATEX = 'class="katex'

for (const [name, parse] of paths) {
  describe(`LaTeX 定界符矩阵 · ${name}`, () => {
    // ---- 该渲染的 ----
    test("① `$…$` 行内(模型最高频写法)", async () => {
      expect(await parse("勾股定理 $a^2 + b^2 = c^2$ 成立")).toContain(KATEX)
    })

    test("② `\\(…\\)` 行内(原支持,不回退)", async () => {
      expect(await parse("面积 \\(\\pi r^2\\) 如上")).toContain(KATEX)
    })

    test("③ `$$`+换行 块级(原支持,不回退)", async () => {
      expect(await parse("$$\nx^2 + y^2 = z^2\n$$\n")).toContain("katex-display")
    })

    test("④ 同行 `$$…$$` 块级", async () => {
      expect(await parse("$$E = mc^2$$\n")).toContain("katex-display")
    })

    test("⑤ `\\[…\\]` 块级(同行)", async () => {
      expect(await parse("\\[E = mc^2\\]\n")).toContain("katex-display")
    })

    test("⑥ `\\[…\\]` 块级(跨行)", async () => {
      expect(await parse("\\[\n\\frac{a+b}{2}\n\\]\n")).toContain("katex-display")
    })

    test("⑦ `$$` 前 ≤3 空格缩进仍算块级", async () => {
      expect(await parse("   $$\nx^2\n$$\n")).toContain("katex-display")
    })

    test("⑧ 一行里多个 `$…$` 各自成公式", async () => {
      const html = await parse("设 $x$ 与 $y$ 均为正")
      expect(html.match(/class="katex"/g)?.length).toBe(2)
    })

    test("⑨ user 样例:毕达哥拉斯三均值混排", async () => {
      const html = await parse(
        ["算术平均 $A = \\frac{a+b}{2}$,几何平均 $G = \\sqrt{ab}$,", "调和平均 $H = \\frac{2ab}{a+b}$,且", "\\[A \\ge G \\ge H\\]"].join("\n"),
      )
      expect(html.match(/class="katex(?:"|-display")/g)?.length).toBeGreaterThanOrEqual(4)
    })

    // ---- 该保持裸文本的(货币护栏)----
    test("⑩ 货币:`一台 $100,另一台 $200` 不得成公式", async () => {
      expect(await parse("一台 $100,另一台 $200")).not.toContain(KATEX)
    })

    test("⑪ 货币:`价格是 $5.00 起` 不得成公式", async () => {
      expect(await parse("价格是 $5.00 起")).not.toContain(KATEX)
    })

    test("⑫ 货币:`成本 $ 5 左右`(开定界后接空白)不得成公式", async () => {
      expect(await parse("成本 $ 5 左右")).not.toContain(KATEX)
    })

    test("⑬ 转义 `\\$100` 不参与配对", async () => {
      expect(await parse("报价 \\$100 到 \\$200")).not.toContain(KATEX)
    })

    test("⑭ `$` 不跨行配对", async () => {
      expect(await parse("这里有个 $ 符号\n下一行还有个 $ 符号")).not.toContain(KATEX)
    })

    test("⑮ 行内代码里的 `$PATH` 保持原样", async () => {
      const html = await parse("环境变量 `$PATH` 与 `$HOME`")
      expect(html).not.toContain(KATEX)
      expect(html).toContain("<code>")
    })

    test("⑯ 代码块里的 `$` 不参与配对", async () => {
      const html = await parse('```py\nprint(f"${x} and ${y}")\n```\n')
      expect(html).not.toContain(KATEX)
    })
  })
}

describe("katexExtension 单一来源(防「只修一半」)", () => {
  const source = readFileSync(new URL("./marked.tsx", import.meta.url), "utf8")

  test("marked.tsx 不再自带第二份 katexExtension 定义", () => {
    expect(source).not.toMatch(/const\s+katexExtension\s*[:=]/)
  })

  test("marked.tsx 从 marked-parser 引用共享扩展", () => {
    expect(source).toMatch(/import\s*\{\s*katexExtension\s*\}\s*from\s*"\.\/marked-parser"/)
  })

  test("两条路径吃的是同一个扩展对象", () => {
    expect(katexExtension.extensions?.length).toBeGreaterThanOrEqual(4)
  })
})

// FORK: 2026-08-19 发版前 code-review 抓出 —— 块级 `\\[…\\]` / `$$` 的 `start()` 原本无条件
//   `indexOf`,会在**任意位置**切开段落。而 `\\[` 在 markdown 里最常见的用途是**转义字面方括号**。
//   实测症状:`路径 C:\\[temp\\]` 渲染成「路径 C:」+ 公式块「temp」;三个段落中间夹一对
//   `\\[ \\]` 会被整个吞进一个公式块。修法 = start 只认行首 + 块级正则不跨空行。
//   [feat: ship-2026-11-1-preflight]
describe("块级定界符只在行首生效(转义方括号零误伤)", () => {
  for (const [name, parse] of paths) {
    describe(name, () => {
      test("Ⓐ 行内的 `\\[…\\]` 是转义方括号,保持字面", async () => {
        const html = await parse("路径 C:\\[temp\\]")
        expect(html).not.toContain(KATEX)
        expect(html).toContain("[temp]")
      })

      test("Ⓑ 脚注式 `\\[1\\]` 保持字面", async () => {
        const html = await parse("参考 \\[1\\]")
        expect(html).not.toContain(KATEX)
        expect(html).toContain("[1]")
      })

      test("Ⓒ 跨空行不吞段落", async () => {
        const html = await parse("开头\n\n\\[a\n\n中间段\n\n结尾 \\]\n\n最后一段")
        expect(html).not.toContain(KATEX)
        expect(html).toContain("中间段")
        expect(html).toContain("最后一段")
      })

      test("Ⓓ 正文里的 `$$`(shell 变量)不切段落也不渲染", async () => {
        const html = await parse("在 shell 里 $$ 代表当前进程 pid")
        expect(html).not.toContain(KATEX)
        expect(html).toContain("代表当前进程 pid")
      })

      test("Ⓔ 真 display math 仍渲染:同行 / 跨行 / ≤3 空格缩进 / 段落之后", async () => {
        for (const src of ["\\[E = mc^2\\]", "\\[\nE = mc^2\n\\]", "  \\[a+b\\]", "如下:\n\n\\[E = mc^2\\]"]) {
          expect(await parse(src)).toContain(KATEX)
        }
      })
    })
  }
})
