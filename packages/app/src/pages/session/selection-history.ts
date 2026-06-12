// FORK: Pierre Shadow DOM 选区历史栈机制 — 抽出 module 2026-05-29
//
// 唯一合法消费者:`handleSelectionContextMenu`(代码/HTML 等 Pierre shadow DOM 右键).
// 用途:对抗 macOS WebKit 右键瞬间 OS 级 collapse 选区到点中那个词的 bug。
//
// === 不要把这套机制扩散到其他路径 ===
//
// - 键盘 Ctrl+C **没有** collapse 问题 — 已退役到 `decideCtrlCAction` 当前选区直读(2026-05-29 R2)
// - light DOM 右键(`handleLightDomContextMenu`)**没有** collapse 问题 — 直接读 window.getSelection()
// - 聊天区 / PDF / office 右键 — `ContextMenuHost` + `DomSelectionProvider` 自己一套,也是直读当前选区
//
// history 用法被严格限定的设计动因:
// "挑 30 秒内最长那条" 是为 collapse 设计的特效药 — 给健康路径喂药会引入"重选短覆盖长"和
// "幽灵复制"两个 bug(详 file-tabs-ctrl-c.ts 头部注释)。
//
// === 历史原因 ===
//
// 第三轮 pop+block 方案失败:用户刚选完就右键时,最后一条历史条目正是用户真实选区(<100ms 新),
// 被 pop 掉 → 栈空 → fallback 读 collapse 后的词。
//
// 第四轮(本方案):**最近 30s 内挑最长** — WebKit collapse 出的单词必然比用户多行选区短。
//   1) selectionchange 不加任何屏蔽,所有非空选区(本 viewer 内)都进历史栈(限 16 条)
//   2) 不在 mousedown 时 pop(那是错的)
//   3) contextmenu 时:从最近 30 秒的历史里挑文本最长的那条 → 必为用户真实选区

export type SelSnapshot = {
  text: string
  range: Range
  shadow: ShadowRoot | null
  time: number
}

export const SEL_HISTORY_LIMIT = 16
export const SEL_HISTORY_RECENT_MS = 30_000

/**
 * 单个 viewer 的选区历史 + 自家 knownShadows 集。
 *
 * Per-viewer instance(不是全局)— 跨 tab 互不污染。
 *
 * 数据流:
 * 1. `collectShadowFromEvent(mousedownEvent)` 在 mousedown 时从 composedPath 收 ShadowRoot
 * 2. `pushFromSelection(sel)` 在 selectionchange 时读 sel 文本(含 shadow 兼容三策略)入栈
 * 3. `pickBestRecent()` 在 contextmenu 时挑最佳
 * 4. `readSelection(sel)` 仅读不存(给 Ctrl+C keydown 用,绕开 history)
 */
export class ViewerSelectionHistory {
  private entries: SelSnapshot[] = []
  private readonly knownShadows = new Set<ShadowRoot>()

  /** 收 Shadow Root(mousedown / contextmenu 时调用)*/
  collectShadow(root: ShadowRoot): void {
    this.knownShadows.add(root)
  }

  /**
   * 从 mouse 事件的 composedPath 提取 ShadowRoot 并收入 knownShadows;返回提取到的(若有)。
   * `pierreContainer` 可选,从 `event.currentTarget` 找 `<diffs-container>` 备用。
   */
  collectShadowFromEvent(event: MouseEvent, pierreContainerSelector = "diffs-container"): ShadowRoot | null {
    let found: ShadowRoot | null = null
    const composedPath = typeof event.composedPath === "function" ? event.composedPath() : []
    for (const node of composedPath) {
      if (node instanceof ShadowRoot) {
        this.knownShadows.add(node)
        found = node
        break
      }
    }
    const target = event.currentTarget as HTMLElement | null
    if (target && pierreContainerSelector) {
      const host = target.querySelector(pierreContainerSelector)
      const sr = (host as HTMLElement | null)?.shadowRoot
      if (sr) this.knownShadows.add(sr)
    }
    return found
  }

  /**
   * 从 Selection 对象读文本(三策略:getComposedRanges → ShadowRoot.getSelection → window.getSelection)。
   * 不入栈,纯读 — 给 Ctrl+C keydown 或其他即时消费者用。
   */
  readSelection(sel: Selection): { text: string; range: Range | null; shadow: ShadowRoot | null } {
    return readSelectionWithShadows(sel, this.knownShadows)
  }

  /** 入栈(走 readSelection,非空才入)*/
  pushFromSelection(sel: Selection): void {
    const result = this.readSelection(sel)
    if (!result.text.trim() || !result.range) return
    this.entries.push({
      text: result.text,
      range: result.range,
      shadow: result.shadow,
      time: Date.now(),
    })
    if (this.entries.length > SEL_HISTORY_LIMIT) this.entries.shift()
  }

  /** 从最近 30s 历史里挑文本最长的快照(对抗右键 collapse)*/
  pickBestRecent(now: number = Date.now()): SelSnapshot | null {
    if (this.entries.length === 0) return null
    let best: SelSnapshot | null = null
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const s = this.entries[i]!
      if (now - s.time > SEL_HISTORY_RECENT_MS) break
      if (!best || s.text.length > best.text.length) best = s
    }
    return best
  }

  /** 测试 / 边界用 */
  size(): number {
    return this.entries.length
  }

  clear(): void {
    this.entries = []
  }
}

/**
 * 三策略 shadow-aware 选区读取(被 ViewerSelectionHistory.readSelection 复用,export 给测试)。
 * 策略 1: `getComposedRanges({ shadowRoots })` — WebKit 17+ 跨 shadow 选区 API
 * 策略 2: `ShadowRoot.getSelection()` — Chromium 专有
 * 策略 3: `window.getSelection().toString()` — light DOM / md 默认路径
 */
export function readSelectionWithShadows(
  sel: Selection,
  knownShadows: Set<ShadowRoot>,
): { text: string; range: Range | null; shadow: ShadowRoot | null } {
  // 策略 1:getComposedRanges({ shadowRoots }) — WebKit 17+ 跨 shadow 选区 API
  if (knownShadows.size > 0 && typeof (sel as any).getComposedRanges === "function") {
    try {
      const shadowArray = [...knownShadows]
      const staticRanges = (sel as any).getComposedRanges({ shadowRoots: shadowArray }) as StaticRange[]
      if (staticRanges?.length > 0) {
        const sr = staticRanges[0]
        const r = document.createRange()
        r.setStart(sr.startContainer, sr.startOffset)
        r.setEnd(sr.endContainer, sr.endOffset)
        const t = r.toString() || r.cloneContents()?.textContent || ""
        if (t.trim()) {
          const root = sr.startContainer.getRootNode()
          return { text: t, range: r, shadow: root instanceof ShadowRoot ? root : null }
        }
      }
    } catch {
      // ignore — 落到下一策略
    }
  }

  // 策略 2:ShadowRoot.getSelection (Chromium 专有)
  for (const sh of knownShadows) {
    try {
      const shadowSel = (sh as unknown as { getSelection?: () => Selection | null }).getSelection?.()
      if (shadowSel && shadowSel.toString().trim()) {
        return {
          text: shadowSel.toString(),
          range: shadowSel.rangeCount > 0 ? shadowSel.getRangeAt(0).cloneRange() : null,
          shadow: sh,
        }
      }
    } catch {
      // ignore — 落到下一策略
    }
  }

  // 策略 3:window.getSelection (light DOM / md 文件)
  const t = sel.toString()
  if (t.trim() && sel.rangeCount > 0) {
    return { text: t, range: sel.getRangeAt(0).cloneRange(), shadow: null }
  }

  return { text: "", range: null, shadow: null }
}
