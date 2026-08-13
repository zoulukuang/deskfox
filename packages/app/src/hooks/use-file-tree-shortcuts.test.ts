// [fork-only] 文件树快捷键作用域 [feat: filetree-shortcut-focus-scope] 2026-08-13
//
// [bug-repro: user 反馈「鼠标点到其他地方已经失去焦点后,按回车会打开和关闭文件预览」。
//   原实现有一条 B 路径:焦点在中性区(body / 聊天区普通 div)时,只要文件树 selection 非空
//   就仍接管键盘。2026-08-13 CDP 实测复现:activeElement = div.scroll-view__viewport,
//   连按 Enter 预览 true→false→true。B 路径接管的还有 F2 / Delete / Backspace ——
//   失焦状态下能重命名、删除文件,比误开预览危险得多。]
//
// user 2026-08-13 拍板:焦点不在文件树区域,键盘一律不接管(含方向键);只有焦点回到文件树才生效。
// 本测试钉住这条作用域规则 —— 判定函数只认 activeElement 是否落在 [data-component="filetree"] 内。
import { describe, test, expect, beforeEach } from "bun:test"

/** 与 hook 内 activeInFileTree() 同构的判定(hook 内为模块私有,这里复刻以便测试作用域规则) */
function activeInFileTree(): boolean {
  const el = document.activeElement
  if (!(el instanceof Element)) return false
  return Boolean(el.closest('[data-component="filetree"]'))
}

describe("文件树快捷键作用域(只认焦点,不再有 B 路径)", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("焦点在文件树内 → 接管", () => {
    const tree = document.createElement("div")
    tree.setAttribute("data-component", "filetree")
    const item = document.createElement("button")
    tree.appendChild(item)
    document.body.appendChild(tree)
    item.focus()
    expect(activeInFileTree()).toBeTrue()
  })

  test("焦点在聊天区等中性区 → 不接管(即便文件树有选中项)", () => {
    const tree = document.createElement("div")
    tree.setAttribute("data-component", "filetree")
    document.body.appendChild(tree)
    const chat = document.createElement("div")
    chat.tabIndex = 0
    document.body.appendChild(chat)
    chat.focus()
    expect(activeInFileTree()).toBeFalse()
  })

  test("焦点回落 body → 不接管", () => {
    const tree = document.createElement("div")
    tree.setAttribute("data-component", "filetree")
    document.body.appendChild(tree)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    expect(activeInFileTree()).toBeFalse()
  })

  test("焦点在文件树内的输入框(重命名)→ 仍算文件树内", () => {
    const tree = document.createElement("div")
    tree.setAttribute("data-component", "filetree")
    const input = document.createElement("input")
    tree.appendChild(input)
    document.body.appendChild(tree)
    input.focus()
    expect(activeInFileTree()).toBeTrue()
  })
})
