// [fork-only] REQ-102 语音 WebUI 品牌化 [feat: voice-dispatch-minimal] 2026-08-22
//
// qwen-audio-agent 的 WebUI 是打包好的 React SPA,文案全在 JS bundle 里,而且它**没有品牌
// 定制入口**(自带的 skin 机制只管悬浮球外观)。所以只能在运行时改 DOM。
//
// ⚠️ 一律按**文案**匹配,不按类名/结构。
// 类名是构建产物(`index-D09JtNnt.js` 这种带 hash 的),每次升级都会变;而界面文案相对稳定。
// 匹配错了最多是某处没换掉,不会把页面搞坏。
//
// SPA 会不断重渲染,所以用 MutationObserver 持续施加,而不是只跑一次。

;(() => {
  const BRAND = "小狐狸投研助手"
  const SUBTITLE = "DeskFox · 语音助手"
  const SLOGAN = "小狐狸投研"
  const LOGO = "/skins/deskfox/logo.png"

  /** 整段隐藏:这些是给开发者看的技术标识,对使用者没有决策价值 */
  const HIDE_IF_TEXT_INCLUDES = [
    "OpenCode",
    "Qwen Audio",
    "qwen-audio",
    "模型支持",
    "Web 传输",
    "REALTIME VOICE",
    "VOICE FRONTEND",
  ]

  /** 原文 → 新文。只换完全相等的,避免误伤正文里恰好出现同样的字 */
  const REPLACE_EXACT = new Map([
    ["qwen-audio-agent", BRAND],
    ["你说，我来调度。", SLOGAN],
    ["你说,我来调度。", SLOGAN],
  ])

  const isLeaf = (el) => el.children.length === 0

  /** 绝不能隐藏的骨架 —— 误伤一个就是整页空白(2026-08-22 真机出过白屏) */
  const NEVER_HIDE = new Set(["HTML", "BODY", "MAIN", "HEADER", "SECTION"])
  const isSkeleton = (el) => NEVER_HIDE.has(el.tagName) || el.id === "root" || el.closest("#root") === el

  /** 往上找到"值得整块隐藏"的那层 —— 只跨极小的包装层,免得把半个页面藏了 */
  const hideTarget = (el) => {
    let node = el
    for (let i = 0; i < 2 && node.parentElement; i++) {
      const parent = node.parentElement
      // 父节点还塞着别的内容、或者本身是页面骨架,就停手
      if (parent.children.length > 1 || isSkeleton(parent)) break
      node = parent
    }
    return isSkeleton(node) ? el : node
  }

  function applyOnce() {
    document.title = BRAND

    for (const el of document.querySelectorAll("body *")) {
      if (!isLeaf(el)) continue
      const text = (el.textContent || "").trim()
      if (!text) continue

      const replacement = REPLACE_EXACT.get(text)
      if (replacement && text !== replacement) {
        el.textContent = replacement
        continue
      }
      if (HIDE_IF_TEXT_INCLUDES.some((needle) => text.includes(needle))) {
        const target = hideTarget(el)
        if (!target.dataset.deskfoxHidden) {
          target.dataset.deskfoxHidden = "1"
          target.style.display = "none"
        }
      }
    }

    // 顶栏那个 "V" 圆形头像换成狐狸 logo。它是唯一一个只有单字母的圆形块,
    // 按文案锁定比按类名稳:内容恰好是 "V" 且没有子元素。
    for (const el of document.querySelectorAll("body *")) {
      if (el.dataset.deskfoxLogo) continue
      if (!isLeaf(el)) continue
      if ((el.textContent || "").trim() !== "V") continue
      el.dataset.deskfoxLogo = "1"
      el.textContent = ""
      el.style.backgroundImage = `url("${LOGO}")`
      el.style.backgroundSize = "cover"
      el.style.backgroundPosition = "center"
    }

    // 副标题:被隐藏的 "REALTIME VOICE · LIVE" 那行位置补一句自己的
    const title = [...document.querySelectorAll("body *")].find(
      (el) => isLeaf(el) && (el.textContent || "").trim() === BRAND,
    )
    if (title && !title.dataset.deskfoxSub) {
      title.dataset.deskfoxSub = "1"
      const sub = document.createElement("div")
      sub.textContent = SUBTITLE
      sub.className = "deskfox-subtitle"
      title.insertAdjacentElement("afterend", sub)
    }
  }

  // ⚠️ 2026-08-22 真机把页面跑挂过("1 个页面无响应")。原因是**自激循环**:
  // SPA 本身在持续改 DOM,observer 每次都触发一次 `body *` 全量扫描;
  // 而扫描里的修改(隐藏/插节点)又是新的 mutation,再触发下一轮 —— 越滚越快直到卡死。
  // 三道闸一起上:防抖合并、施加期间断开 observer、以及施加本身的幂等(dataset 标记)。
  const THROTTLE_MS = 400
  let observer = null
  let scheduled = false

  const connect = () => observer?.observe(document.documentElement, { childList: true, subtree: true })

  const run = () => {
    // 自己改 DOM 的这段时间不听,否则必然自激
    observer?.disconnect()
    try {
      applyOnce()
    } catch {
      // 品牌化失败不该让语音界面挂掉
    } finally {
      connect()
    }
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      run()
    }, THROTTLE_MS)
  }

  run()
  observer = new MutationObserver(schedule)
  connect()
  // SPA 首屏可能晚于 observer 注册,补几拍(仍走防抖,不会叠加)
  for (const delay of [100, 300, 800, 2000]) setTimeout(schedule, delay)
})()
