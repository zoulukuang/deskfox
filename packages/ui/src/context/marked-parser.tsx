import katex from "katex"
import { Marked, type MarkedExtension, type Tokens } from "marked"
import markedShiki from "marked-shiki"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return new Marked(
    {
      renderer: {
        link({ href, title, text }) {
          const titleAttr = title ? ` title="${title}"` : ""
          return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
        },
      },
    },
    katexExtension,
    markedShiki({ highlight }),
  )
}

// FORK-BEGIN: REQ-115 聊天区 LaTeX 补齐主流定界符 [feat: session-presentation-input-batch] 2026-08-17
//
// 上游只认两种小众写法:`\(…\)` 行内、以及 `$$` **必须紧跟换行** 的块级。而模型日常输出的
// `$…$`(最高频)/ `\[…\]` / 同行 `$$…$$` 全部落成裸文本 —— user 那份毕达哥拉斯平均样例四条公式
// 一条都没出图。**这不是本次上游同步的回归,是长期缺口。**
//
// 本扩展是**单一来源**:marked.tsx 从这里引用(此前两处逐字重复,改一处等于只修一半)。
//
// 三条护栏(货币零误伤是硬验收):
//   ① `$…$` 开定界后不接空白/美元、闭定界前不接空白、闭定界后不接数字、不跨行;
//   ② `\$` 转义不参与配对;
//   ③ 代码块 / 行内代码由 marked 自身的 token 优先级隔离(inline 扩展跑在 codespan 之后)。
export const inlineMathRegex = /^\\\(((?:\\.|[^\\\n])*?)\\\)/
// `$…$` 起点正则(2026-08-16 已用 bun test 实测:四条真实样例各命中 1 处、三条货币负例命中 0 处)
export const inlineDollarMathRegex = /^\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<!\s)\$(?!\d)/
// `\[…\]` 块级:同行或跨行都收,但**不跨空行** —— 空行是 markdown 的块边界,
//   `[\s\S]+?` 会让「开头\n\n\[a\n\n中间段\n\n结尾 \]」把中间所有段落吞进一个公式块
//   (2026-08-19 发版前 review 实测)。display math 内部不会有空行,限制不误伤真公式。
export const blockBracketMathRegex = /^ {0,3}\\\[((?:[^\n]|\n(?!\s*\n))+?)\\\](?:\n|$)/
// `$$…$$` 块级:去掉「$$ 后必须立刻换行」的强制,并允许 ≤3 空格缩进(与 markdown 块级惯例一致)
export const blockMathRegex = /^ {0,3}\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/

export const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const index = src.indexOf("\\(")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const match = src.match(inlineMathRegex)
        if (!match) return
        return {
          type: "inlineKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
    {
      // FORK: REQ-115 `$…$` 行内(模型默认写法,命中频率最高)
      name: "inlineDollarKatex",
      level: "inline",
      start(src) {
        // 跳过 `$$`(块级的活)与转义 `\$`
        for (let i = src.indexOf("$"); i !== -1; i = src.indexOf("$", i + 1)) {
          if (src[i + 1] === "$") continue
          if (i > 0 && src[i - 1] === "\\") continue
          return i
        }
        return
      },
      tokenizer(src) {
        const match = src.match(inlineDollarMathRegex)
        if (!match) return
        return {
          type: "inlineKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
    {
      // FORK: REQ-115 `\[…\]` 块级(同行 + 跨行)
      name: "blockBracketKatex",
      level: "block",
      // FORK: `start` 必须只认【行首】的 `\[` —— 2026-08-19 发版前 review 实测:
      //   无条件 `indexOf("\\[")` 会让 marked 在**任意位置**的 `\[` 处切开段落,
      //   而 `\[` 在 markdown 里最常见的用途是**转义字面方括号**,不是 LaTeX:
      //     `路径 C:\[temp\]` → 「路径 C:」+ 一个 KaTeX 块「temp」(方括号没了)
      //     `参考 \[1\]`      → 「参考」+ 一个 KaTeX 块「1」
      //   真实的 display math(`\[E = mc^2\]` 独占行 / `\[` 换行 `\]`)一律在行首,
      //   所以只认行首(允许 ≤3 空格缩进,与 markdown 块级惯例一致)既不误伤转义、也不漏真公式。
      //   2026-08-19 [feat: ship-2026-11-1-preflight]
      start(src) {
        const match = src.match(/(^|\n) {0,3}\\\[/)
        if (!match) return
        // 命中的是分组 1(行首锚点)之后的位置:`^` 时偏移 0,`\n` 时跳过换行本身
        return match.index! + match[1].length
      },
      tokenizer(src) {
        const match = src.match(blockBracketMathRegex)
        if (!match) return
        return {
          type: "blockKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "blockKatex",
      level: "block",
      // FORK: 同上,只认行首的 `$$` —— 否则 `在 shell 里 $$ 代表当前进程 pid` 这类正文
      //   也会被切开段落(tokenizer 随后不匹配,但段落已被劈成两半)。2026-08-19
      start(src) {
        const match = src.match(/(^|\n) {0,3}\$\$/)
        if (!match) return
        return match.index! + match[1].length
      },
      tokenizer(src) {
        const match = src.match(blockMathRegex)
        if (!match) return
        return {
          type: "blockKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
  ],
}
// FORK-END

export function renderKatexToken(token: Tokens.Generic) {
  return katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
}
