// [fork-only] CSV / TSV 表格查看器(只读 + 虚拟滚动)
//
// 上游 electron / Tauri 原版都没有 —— CSV 一直走代码/文本视图(原始逗号文本)。user 拍板新增:
// 以表格形式展示。只读、首行表头、列横向滚、大文件用 virtua 虚拟滚动不卡;单元格文字可选
// (在 data-component="file-viewer" 作用域内 → 沿用既有右键加入聊天)。顶栏留"用本机软件打开"兜底。
// [feat: csv-table-viewer] 2026-06-14

import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { Virtualizer } from "virtua/solid"

/** RFC4180-ish 解析:处理引号字段("" 转义、字段内逗号/换行)。返回 string[][]。 */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(field)
      field = ""
      i++
      continue
    }
    if (ch === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i++
      continue
    }
    if (ch === "\r") {
      i++
      continue
    }
    field += ch
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const MIN_COL_PX = 120

export function CsvTable(props: {
  text: string
  /** 分隔符;不传按扩展名(.tsv → tab)/ 内容嗅探 */
  delimiter?: string
  /** "用本机软件打开"回调(可选) */
  onOpenExternal?: () => void
}): JSX.Element {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()

  const delim = createMemo(() => {
    if (props.delimiter) return props.delimiter
    // 嗅探:首行 tab 数 > 逗号数 → tab
    const firstLine = props.text.split("\n", 1)[0] ?? ""
    const tabs = (firstLine.match(/\t/g) || []).length
    const commas = (firstLine.match(/,/g) || []).length
    return tabs > commas ? "\t" : ","
  })

  const rows = createMemo(() => parseDelimited(props.text, delim()))
  const colCount = createMemo(() => rows().reduce((m, r) => Math.max(m, r.length), 0))
  const header = createMemo(() => rows()[0] ?? [])
  const body = createMemo(() => rows().slice(1))
  const gridCols = createMemo(() => `repeat(${Math.max(1, colCount())}, minmax(${MIN_COL_PX}px, 1fr))`)
  const minWidth = createMemo(() => `${Math.max(1, colCount()) * MIN_COL_PX}px`)

  const cellClass =
    "px-2 py-1 text-12-regular text-text-base whitespace-nowrap overflow-hidden text-ellipsis border-r border-b border-border-weak-base"

  return (
    <div class="flex flex-col h-full select-text" data-slot="csv-table">
      <div class="flex items-center justify-between gap-2 px-3 py-1 border-b border-border-base bg-surface-raised-stronger-non-alpha text-xs shrink-0">
        <span class="text-text-weak">
          {body().length} 行 × {colCount()} 列
        </span>
        <button
          type="button"
          onClick={() => props.onOpenExternal?.()}
          class="px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
          title="用 Excel / 系统默认应用打开"
        >
          用本机软件打开
        </button>
      </div>
      <div ref={setScrollEl} class="flex-1 min-h-0 overflow-auto">
        <div style={{ "min-width": minWidth() }}>
          {/* 表头(sticky) */}
          <div
            class="grid sticky top-0 z-10 bg-background-stronger border-b border-border-base font-medium"
            style={{ "grid-template-columns": gridCols() }}
          >
            {Array.from({ length: colCount() }).map((_, c) => (
              <div class={cellClass + " text-text-strong"} title={header()[c] ?? ""}>
                {header()[c] ?? ""}
              </div>
            ))}
          </div>
          {/* 数据行(虚拟滚动) */}
          <Show when={scrollEl()} keyed>
            {(root) => (
              <Virtualizer data={body()} scrollRef={root} itemSize={29} startMargin={29}>
                {(r: string[]) => (
                  <div
                    class="grid hover:bg-surface-base-hover"
                    style={{ "grid-template-columns": gridCols() }}
                  >
                    {Array.from({ length: colCount() }).map((_, c) => (
                      <div class={cellClass} title={r[c] ?? ""}>
                        {r[c] ?? ""}
                      </div>
                    ))}
                  </div>
                )}
              </Virtualizer>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
