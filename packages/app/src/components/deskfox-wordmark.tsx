// [fork-only] DeskFoX.Ai 品牌 wordmark
// 来源:OPENCODE-PLAN/品牌设计/SVG/wordmark.svg(几何无衬线,与三角图标呼应)
// 首页 home 用,替代上游 <Logo>。尺寸/透明度由调用方通过 class 控制(如 w-60 opacity-50)。
// 内部 fill 为品牌固有色(Desk 深 navy / Fo 钢蓝 / X 三角带珊瑚芯 / .Ai),属资产本身,inline 即可。
export function DeskFoxWordmark(props: { class?: string }) {
  const font = "'Inter','Segoe UI','PingFang SC','Helvetica Neue',Arial,sans-serif"
  return (
    <svg
      viewBox="0 0 400 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g font-family={font} font-weight="800">
        <text x="0" y="84" font-size="72" fill="#1F2D44" textLength="172" lengthAdjust="spacingAndGlyphs">
          Desk
        </text>
        <text x="172" y="84" font-size="72" fill="#7295C4" textLength="78" lengthAdjust="spacingAndGlyphs">
          Fo
        </text>
      </g>
      <g transform="translate(252, 36)">
        <path d="M 0,48 L 0,40 L 38,0 L 38,8 Z" fill="#7295C4" />
        <path d="M 0,0 L 8,0 L 38,40 L 38,48 Z" fill="#1F2D44" />
        <path d="M 16,19 L 26,19 L 21,27 Z" fill="#FF9A7A" />
      </g>
      <circle cx="302" cy="80" r="5" fill="#1F2D44" />
      <text
        x="312"
        y="84"
        font-family={font}
        font-weight="800"
        font-size="72"
        fill="#1F2D44"
        textLength="68"
        lengthAdjust="spacingAndGlyphs"
      >
        Ai
      </text>
    </svg>
  )
}
