// [fork-only] 架构约束守卫:经典布局镜像一律用 order,禁止 flex-row-reverse
// [feat: mirror-layout-overflow] 2026-08-12
//
// ## 为什么需要「源码级」守卫,而不是只靠 e2e
//
// 2026-08-12 这个缺陷**修了又复发**,原因值得记死:
//
//  第一次:user 报「所有文件」tab 被 activity rail 盖住。定位到 session.tsx 五栏容器的
//          `md:flex-row-reverse`,改成 order,真机验证通过,并加了 e2e 断言
//          「不得存在 .md\:flex-row-reverse」。
//  复发  :user 再次截图 —— 同样的症状。根因是 session-side-panel.tsx 里**还有两处**
//          `flex-row-reverse`(侧面板内部 文件树 vs 审查区、文件树 tab 顺序),当时被我判断为
//          「子项 flex-1 自适应,风险小」而没改 —— 判断错了,文件树是固定宽度,一样会溢出。
//
// 两层失误,对应两层机制修补:
//
//  ① **只修了触发点,没扫同类模式**。发现某个 pattern 有害后,必须全仓 grep 该 pattern 逐个评估,
//     而不是只改复现路径上的那一处。→ 本测试即「全仓扫描」的自动化固化。
//  ② **e2e 抓不到这类问题**。SessionSidePanel 外层是 <Show when={isDesktop()}>,
//     e2e 跑 web 端时整棵子树不渲染,DOM 里根本不存在那两处 class,断言再严也是空过。
//     → 凡是「渲染条件依赖桌面环境」的样式约束,e2e 无能为力,必须上源码级静态检查。
//
// ## 约束本身
//
// `flex-row-reverse` 在子项总宽超出容器时,会把溢出方向从「右」翻成「左」;
// DeskFox 经典布局的左边是 activity rail,于是溢出内容被压在 rail 底下、开头字符被吃掉。
// 视觉镜像一律改用 `order-first` / `order-last`:视觉顺序与 DOM 顺序都不变(上游增删子项仍可正常 merge),
// 而溢出方向保持正常的向右 —— 即 user 要求的「宽度不够该省略右侧,不是切左边」。
import { test, expect } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// FORK 2026-08-14 [feat: upstream-sync-2026-08]:必须用 `fileURLToPath`,不能用 `.pathname`。
// [bug-repro: Windows 上 `new URL(...).pathname` 得到的是 `/D:/project/.../src/` ——
//  盘符前多一个斜杠,`readdirSync` 直接 ENOENT。于是**这个守卫在 Windows 上从未真正跑过**:
//  它每次都以异常收场,`bun run test` 整体红,而它本该检查的 `flex-row-reverse` 一次也没检查。
//  守卫失效比没有守卫更危险 —— 前者让人以为已经防住了。macOS 上 pathname 恰好是合法 POSIX 路径,
//  所以 Mac 端看不到这个问题。]
const ROOT = fileURLToPath(new URL("../../", import.meta.url)) // packages/app/src

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__snapshots__") continue
      walk(p, out)
    } else if (/\.(tsx|ts|css)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** 去掉行注释与块注释,避免把「解释为什么禁用它」的说明文字本身判成违规 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

test("经典布局镜像不得使用 flex-row-reverse(一律改用 order)", () => {
  const offenders: string[] = []
  for (const file of walk(ROOT)) {
    if (file.endsWith("no-row-reverse.test.ts")) continue
    const code = stripComments(readFileSync(file, "utf-8"))
    if (!code.includes("flex-row-reverse")) continue
    for (const [i, line] of code.split("\n").entries()) {
      if (line.includes("flex-row-reverse")) {
        offenders.push(`${file.replace(ROOT, "src/")}:${i + 1}: ${line.trim().slice(0, 100)}`)
      }
    }
  }
  expect(
    offenders,
    "flex-row-reverse 会把溢出方向翻到左侧、压进 activity rail(2026-08-12 修了又复发)。" +
      "视觉镜像请改用 order-first / order-last。若确有必须使用的场景,在本测试加显式豁免并写明理由。\n" +
      offenders.join("\n"),
  ).toEqual([])
})
