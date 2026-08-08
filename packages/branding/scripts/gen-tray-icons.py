#!/usr/bin/env python3
# [fork-only] REQ-099 托盘三态图标生成 [feat: tray-health-status] 2026-08-07
#
# 为什么是脚本 + 生成物入库(而不是运行时读文件):
#   tray.ts 的图标是编译期内联 base64 常量(对齐 Tauri include_image!,运行时无文件 IO,
#   dev/打包一致)。所以本脚本产出两份东西:① 供人眼审阅 / md5 回归的 PNG;
#   ② packages/desktop/src/main/deskfox/tray-icons.generated.ts 里的 base64 常量。
#
# 为什么用 Python + Pillow(而不是 @resvg/resvg-js):
#   packages/branding 现无 resvg 依赖,加 dep 会动 bun.lock(pre-commit 路径黑名单)→ 平白多一笔
#   R4 override。徽标是纯几何(圆 + 挖洞感叹号),在既有 32x32 基图上合成即可,不需要 SVG 重渲。
#
# ⚠️ macOS template image 约束(会让人白做的坑):
#   tray.ts 对 darwin 调 setTemplateImage(true) → 系统【只用 alpha 通道,颜色全丢】。
#   所以徽标不能靠颜色区分:gave-up 的感叹号必须是【挖成透明洞】,差异才落在 alpha 层,
#   彩色 / 模板两种模式下都成立(否则 restarting 与 gave-up 产出同一张图,md5 一致)。
#
# 用法:  python3 packages/branding/scripts/gen-tray-icons.py
# 幂等:  同输入必产同输出(md5 稳定),可重复执行。

import base64
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[3]
TRAY_DIR = REPO / "packages/branding/src/assets/tray-icons"
OUT_DIR = TRAY_DIR / "status"
TS_OUT = REPO / "packages/desktop/src/main/deskfox/tray-icons.generated.ts"

# 基图:彩色 = 品牌深蓝狐狸(Win/Linux 托盘);模板 = 纯黑 alpha 廓形(macOS 菜单栏)
BASE_COLOR = TRAY_DIR / "default.png"
BASE_TEMPLATE = TRAY_DIR / "source/tray-template-mac-32.png"

# 徽标几何(32x32 画布,作 @2x → 16pt 逻辑尺寸)
BADGE_CENTER = (25, 25)
BADGE_R = 6  # 实心圆半径(直径 12px @2x = 6pt,托盘尺寸可辨且不过分遮挡狐狸)
MOAT_R = 7.5  # 先清出的透明护城河半径 —— 让徽标与狐狸廓形在 alpha 层分离(模板模式下尤其关键)

# 感叹号(仅 gave-up,挖成透明洞)
BANG_BAR = (24, 20, 25, 26)  # x0, y0, x1, y1(含)
BANG_DOT = (24, 28, 25, 29)

COLOR_RESTARTING = (208, 138, 30, 255)  # 琥珀 #D08A1E
COLOR_GAVE_UP = (192, 57, 43, 255)  # 红 #C0392B
COLOR_TEMPLATE_BADGE = (0, 0, 0, 255)  # 模板模式只看 alpha,填黑

TRANSPARENT = (0, 0, 0, 0)


def _ellipse(draw: ImageDraw.ImageDraw, center, r, fill):
    cx, cy = center
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def make_variant(base_path: Path, badge_fill, punch_bang: bool) -> Image.Image:
    """在基图右下角合成徽标。badge_fill=None 表示 ok 态(基图原样)。"""
    img = Image.open(base_path).convert("RGBA")
    if badge_fill is None:
        return img
    draw = ImageDraw.Draw(img)
    # ① 护城河:先把徽标周边清成全透明,徽标才不会跟狐狸糊成一团(alpha 层可辨)
    _ellipse(draw, BADGE_CENTER, MOAT_R, TRANSPARENT)
    # ② 实心圆徽标
    _ellipse(draw, BADGE_CENTER, BADGE_R, badge_fill)
    # ③ gave-up:感叹号挖成透明洞(差异落在 alpha 层 → 模板模式也可辨)
    if punch_bang:
        draw.rectangle(list(BANG_BAR), fill=TRANSPARENT)
        draw.rectangle(list(BANG_DOT), fill=TRANSPARENT)
    return img


VARIANTS = [
    ("ok", "color", BASE_COLOR, None, False),
    ("restarting", "color", BASE_COLOR, COLOR_RESTARTING, False),
    ("gave-up", "color", BASE_COLOR, COLOR_GAVE_UP, True),
    ("ok", "template", BASE_TEMPLATE, None, False),
    ("restarting", "template", BASE_TEMPLATE, COLOR_TEMPLATE_BADGE, False),
    ("gave-up", "template", BASE_TEMPLATE, COLOR_TEMPLATE_BADGE, True),
]

TS_KEY = {"ok": "ok", "restarting": "restarting", "gave-up": "gaveUp"}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    b64: dict[str, dict[str, str]] = {"color": {}, "template": {}}
    digests: dict[str, str] = {}

    for state, mode, base, fill, punch in VARIANTS:
        img = make_variant(base, fill, punch)
        out = OUT_DIR / f"{state}-{mode}.png"
        # optimize=True + 固定参数 → 幂等(同输入同字节)
        img.save(out, format="PNG", optimize=True)
        raw = out.read_bytes()
        b64[mode][state] = base64.b64encode(raw).decode("ascii")
        digests[f"{state}-{mode}"] = hashlib.md5(raw).hexdigest()

    lines = [
        "// [fork-only] 由 packages/branding/scripts/gen-tray-icons.py 生成,请勿手改。",
        "//   REQ-099 托盘三态图标(编译期内联 base64,运行时无文件 IO)[feat: tray-health-status] 2026-08-07",
        "//   重新生成:python3 packages/branding/scripts/gen-tray-icons.py",
        "//   源 PNG:packages/branding/src/assets/tray-icons/status/<state>-<mode>.png",
        "",
        'import type { TrayIconKey } from "./tray-status"',
        "",
        "/** Win/Linux 托盘彩色图标(品牌深蓝狐狸 + 状态徽标)。 */",
        "export const TRAY_ICON_COLOR_BASE64: Record<TrayIconKey, string> = {",
    ]
    for state in ("ok", "restarting", "gave-up"):
        lines.append(f'  "{state}": "{b64["color"][state]}",')
    lines += [
        "}",
        "",
        "/** macOS 菜单栏 template 图标(纯 alpha,系统按明暗自动反色;徽标靠挖洞区分)。 */",
        "export const TRAY_ICON_MAC_TEMPLATE_BASE64: Record<TrayIconKey, string> = {",
    ]
    for state in ("ok", "restarting", "gave-up"):
        lines.append(f'  "{state}": "{b64["template"][state]}",')
    lines += ["}", ""]

    TS_OUT.write_text("\n".join(lines), encoding="utf-8")

    print(f"wrote {len(VARIANTS)} PNG -> {OUT_DIR}")
    print(f"wrote {TS_OUT}")
    for k, v in digests.items():
        print(f"  md5 {k:22s} {v}")
    color = {k: v for k, v in digests.items() if k.endswith("-color")}
    tmpl = {k: v for k, v in digests.items() if k.endswith("-template")}
    assert len(set(color.values())) == 3, "彩色三态 md5 必须互不相同"
    assert len(set(tmpl.values())) == 3, "模板三态 md5 必须互不相同(alpha 层可辨)"
    print("OK: 彩色 / 模板 两种模式下三态均互不相同")


if __name__ == "__main__":
    main()
