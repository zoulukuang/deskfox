// [fork-only] 文件树键盘快捷键(commit #3 of file-tree-dnd + file-tree-ux-polish 2026-05-04 扩)
//
// 触发条件(OR):
//   A. activeElement 在 [data-component=filetree] 内(用户刚点过文件树)
//   B. 文件树 selection 非空 + activeElement 不是可编辑控件 + 浏览器文本选区为空(或落在文件树内)
//      ←  v1 用户单击文件后焦点常跑到 main editor,但文件树 selection 还在,这时 Ctrl+C/V 期望仍生效
//      ←  浏览器文本选区在文件树外(聊天区 / 只读 viewer)时,意图是复制文本,B 让位给原生
//
// 这避免抢占编辑器 / 输入框 / 终端的 Ctrl+X/C/V/Z(它们的 activeElement 是可编辑控件,B 不满足)
// 也避免抢占聊天气泡 / 文档查看器的 Ctrl+C(那些是普通 div,activeElement 是 body,靠"文本选区在外"兜底)
//
// 支持:
// - Ctrl+X (Cut)  剪切当前 selection
// - Ctrl+C (Copy) 复制当前 selection
// - Ctrl+V (Paste) 粘贴到当前 active 文件夹(如果 active 是文件,粘贴到其父目录)
// - Ctrl+Z (Undo) commit #4 接入
// FORK: 2026-05-04 file-tree-ux-polish 扩展导航键(无 ctrl/meta/shift/alt 时):
// - ↑↓        在可见节点序列里上下移动 selection
// - Enter     单选时 — 文件:打开;文件夹:toggle 展开
// - F2        单选时:重命名
// - Delete    selection 非空时:删除(macOS 同时绑 Backspace,决议 E)

import { onCleanup, onMount } from "solid-js"

export type ShortcutHandlers = {
  onCut?: () => void | Promise<void>
  onCopy?: () => void | Promise<void>
  onPaste?: () => void | Promise<void>
  onUndo?: () => void | Promise<void>
  // FORK: file-tree-ux-polish 2026-05-04
  onArrowUp?: () => void
  onArrowDown?: () => void
  // FORK: 左右键展开/折叠/跳父子(树控件标准)[feat: file-tree-arrow-lr] 2026-06-13
  onArrowLeft?: () => void
  onArrowRight?: () => void
  onEnter?: () => void
  onRename?: () => void
  onDelete?: () => void
  // FORK: Ctrl+A 全选 [feat: file-tree-select-all] 2026-06-13
  onSelectAll?: () => void
}

/** activeElement 是否在文件树内 */
function activeInFileTree(): boolean {
  const el = document.activeElement
  if (!(el instanceof Element)) return false
  return Boolean(el.closest('[data-component="filetree"]'))
}

export function useFileTreeShortcuts(handlers: ShortcutHandlers) {
  // FORK: 2026-08-13 user 拍板 —— **焦点不在文件树区域,键盘一律不接管**(含方向键)。
  //   原实现有一条「B 路径」:焦点在中性区(body / 聊天区等普通 div)时,只要文件树 selection 非空
  //   就仍然接管键盘,方便用户不点回文件树也能键盘浏览。
  //   [bug-repro: user 反馈「鼠标点到其他地方已经失去焦点后,按回车会打开和关闭文件预览」——
  //    点过文件树某项(selection 残留)再点聊天区,Enter 仍被文件树吃掉去 toggle 预览。
  //    2026-08-13 CDP 实测复现:activeElement = div.scroll-view__viewport(聊天区滚动容器),
  //    连按 Enter 预览 true→false→true。]
  //   B 路径接管的不只 Enter,还有 F2 / Delete / Backspace —— **失焦状态下能重命名和删除文件**,
  //   比误开预览危险得多。user 决定整条路径去掉,只保留 A 路径(焦点真在文件树内才响应)。
  //   [feat: filetree-shortcut-focus-scope] 2026-08-13
  const shouldTrigger = (): boolean => activeInFileTree()

  const onKeyDown = (event: KeyboardEvent) => {
    // FORK: REQ-085 [feat: popup-enter-passthrough] 2026-08-02
    if (!shouldTrigger()) return

    // FORK-BEGIN: 导航键 — 无任何 modifier 时响应 [feat: file-tree-ux-polish] 2026-05-04
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      switch (event.key) {
        case "ArrowUp":
          if (handlers.onArrowUp) {
            event.preventDefault()
            handlers.onArrowUp()
          }
          return
        case "ArrowDown":
          if (handlers.onArrowDown) {
            event.preventDefault()
            handlers.onArrowDown()
          }
          return
        case "ArrowLeft":
          if (handlers.onArrowLeft) {
            event.preventDefault()
            handlers.onArrowLeft()
          }
          return
        case "ArrowRight":
          if (handlers.onArrowRight) {
            event.preventDefault()
            handlers.onArrowRight()
          }
          return
        case "Enter":
          if (handlers.onEnter) {
            event.preventDefault()
            handlers.onEnter()
          }
          return
        case "F2":
          if (handlers.onRename) {
            event.preventDefault()
            handlers.onRename()
          }
          return
        case "Delete":
        case "Backspace": // macOS 习惯(决议 E)
          if (handlers.onDelete) {
            event.preventDefault()
            handlers.onDelete()
          }
          return
      }
    }
    // FORK-END

    const meta = event.ctrlKey || event.metaKey
    if (!meta) return
    // 跳过 shift / alt 组合,留给浏览器/系统
    if (event.shiftKey || event.altKey) return

    switch (event.key.toLowerCase()) {
      case "x":
        if (handlers.onCut) {
          event.preventDefault()
          void handlers.onCut()
        }
        return
      case "c":
        if (handlers.onCopy) {
          event.preventDefault()
          void handlers.onCopy()
        }
        return
      case "v":
        if (handlers.onPaste) {
          event.preventDefault()
          void handlers.onPaste()
        }
        return
      case "z":
        if (handlers.onUndo) {
          event.preventDefault()
          void handlers.onUndo()
        }
        return
      case "a":
        // FORK: Ctrl+A 全选(仅焦点在文件树内时;中性区有文本选区时上面的 B 路径已 return)
        //   [feat: file-tree-select-all] 2026-06-13
        if (handlers.onSelectAll && activeInFileTree()) {
          event.preventDefault()
          handlers.onSelectAll()
        }
        return
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown)
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown)
  })
}
