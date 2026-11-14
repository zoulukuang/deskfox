# Tray icons — DeskFox 系统托盘图标

当前 Electron 托盘显示后台服务健康状态（REQ-099），由 `packages/desktop/src/main/deskfox/tray-status.ts` 映射：

| 后台状态 | 图标键 | 托盘提示 |
| --- | --- | --- |
| `ready` | `ok` | 状态:就绪 |
| `restarting` | `restarting` | 状态:后台服务重启中… |
| `gave-up` | `gave-up` | 状态:后台服务已停止,请重启 DeskFox |

每种状态都有彩色和模板两种图，共六张 32×32 RGBA PNG，位于 `status/`。

- **Windows / Linux**：使用彩色图，基图为品牌深蓝 `#3D63A0` 狐狸；重启中叠加琥珀色徽标，停止叠加红色感叹号徽标。
- **macOS**：使用模板图，Electron 设置 `setTemplateImage(true)`，系统根据菜单栏明暗反色。32px 图像以 `scaleFactor: 2` 显示为 16pt。模板只使用 alpha 通道，停止状态的感叹号通过透明挖孔与重启中区分。

## 来源与生成流程

品牌正本位于运营仓 `品牌设计/SVG/`，2026-09-30 从 OPENCODE-PLAN 迁出。本目录的 `source/icon-tray-template.svg` 是从其中 `icon-naked.svg` 派生的历史彩色基图来源。

现有生成脚本 `packages/branding/scripts/gen-tray-icons.py` 使用 Python 3 和 Pillow，读取两张已经落库的基图：

| 输入 | 用途 |
| --- | --- |
| `default.png` | Windows / Linux 彩色基图 |
| `source/tray-template-mac-32.png` | macOS 模板基图 |

该脚本在基图上合成状态徽标，同时生成：

- `status/{ok,restarting,gave-up}-{color,template}.png`：六张供检查的状态图。
- `packages/desktop/src/main/deskfox/tray-icons.generated.ts`：相同图像的 base64 常量。

需要更新状态图时，在主仓根目录执行：

```sh
python3 packages/branding/scripts/gen-tray-icons.py
```

脚本会写入上述生成文件，应一起审阅和提交。它不读取或重新渲染 SVG；若修改基图设计，须先更新对应的输入 PNG，再执行生成脚本。

运行时 `packages/desktop/src/main/deskfox/tray.ts` 导入生成的常量，不从磁盘读取本目录图片。更新生成文件后还需重新构建并启动相应桌面版本，才会显示新图标；不要手改 base64 常量。

## 历史文件

根目录的 `connected.png`、`offline.png`、`error.png` 是早期飞书连接状态方案留下的图片，目前与 `default.png` 相同，未用于现有 Electron 健康状态切换。`default.png` 仍是彩色生成流程的输入。

早期的四图重绘命令、统一蓝色托盘口径和 Tauri `tray_handle.set_icon_as_template` 调用不适用于当前实现。维护现有图标应以上述三态、两种平台模式及生成脚本为准。
