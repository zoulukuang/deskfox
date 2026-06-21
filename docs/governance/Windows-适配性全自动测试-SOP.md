# Windows 适配性全自动测试 SOP

> 目的:每次合上游 / 改 renderer / 发版前,在 Windows 上一键验证最新 `main` 的适配性无回归。
> 定位:本文是《[自动化测试规范](./自动化测试规范.md)》(R5/R8/R9 测试纪律)的**具体执行流程**。任何在本项目跑 Windows 验证的 agent 必读必守。
> 原则:**高质量完成测试是目标,过程尽量零人工参与**。能 CDP/脚本自动化的绝不要 user 动手。

## 0. 固定测试夹具(不要每次新造)

**统一测试项目目录:`D:\tmp\deskfox-doc-test`** —— 专为验证文件预览(PDF/Office/图片)预置样本的干净 git 项目。

为什么必须用**独立干净项目**而非往当前项目塞文件:DeskFox/opencode 对**已打开项目的新增文件不刷新**(文件树 `list` 是首次打开快照,Win 文件 watcher 不捕获后续新增;命令面板实时 `fs.find` 也搜不到)。只有让 DeskFox **首次打开**一个预置好样本的项目,样本才进索引。详见记忆 `reference_verify_file_viewer_needs_fresh_project`。

**重建测试夹具**(目录不存在或样本损坏时跑一次):

```bash
SOFFICE="/d/project/opencode-fork/packages/desktop/dist-deskfox/win-unpacked/libreoffice/program/soffice.exe"
GEN="/d/tmp/_gen"; TP="/d/tmp/deskfox-doc-test"
mkdir -p "$GEN"
printf 'DeskFox 预览验证样本\n中文 + English mixed.\nLibreOffice 转换 + pdf.js 渲染。\n' > "$GEN/s.txt"
printf '姓名,部门,数值\n张三,研发,123\n李四,测试,456\n' > "$GEN/s.csv"
"$SOFFICE" --headless "-env:UserInstallation=file:///d:/tmp/_lo" --convert-to pdf  --outdir "$GEN" "$GEN/s.txt"
"$SOFFICE" --headless "-env:UserInstallation=file:///d:/tmp/_lo" --convert-to docx --outdir "$GEN" "$GEN/s.txt"
"$SOFFICE" --headless "-env:UserInstallation=file:///d:/tmp/_lo" --convert-to xlsx --outdir "$GEN" "$GEN/s.csv"
rm -rf "$TP"; mkdir -p "$TP"
cp "$GEN/s.pdf" "$TP/sample.pdf"; cp "$GEN/s.docx" "$TP/sample.docx"; cp "$GEN/s.xlsx" "$TP/sample.xlsx"
cp "/d/project/opencode-fork/packages/branding/libreoffice-bundle/windows/program/intro.png" "$TP/sample.png"
printf '# DeskFox PDF/Office 预览验证项目\n' > "$TP/README.md"
cd "$TP" && git init -q && git add -A && git -c user.email=t@t.t -c user.name=t commit -qm "smoke samples"
```

样本必须全部 `git add` 成 tracked,确保 DeskFox 首次扫描必收录(.gitignore 通配 `*.png`/`*.xlsx` 等也不影响 tracked 文件显示)。

## 1. 测试流程(5 阶段,全自动)

每阶段命令见下;**build 前无条件先杀进程**(开发测试期自由杀,不等授权)。本 SOP 是 build 预览版 + 冒烟,按 CLAUDE.md 杀进程矩阵属「发布档」→ **只杀发布三档(正式版 + 预览版 + Beta)**(都共享 `opencode.db` 不能共存),**排除 local**(隔离 DB)、**不带通用 `electron`/`opencode-cli`**(会误伤其他 Electron 应用 / 别项目 sidecar)。

```powershell
Get-Process -Name DeskFox,'DeskFox 预览版','DeskFox Beta' -ErrorAction SilentlyContinue | Stop-Process -Force
```

| # | 阶段 | 命令 | 判定 |
|---|---|---|---|
| 1 | typecheck | `bun turbo typecheck --filter='!./packages/console/*'` | 全包 exit 0 |
| 2 | build dev win-unpacked | 见《CLAUDE.md 验证约定》(Bash 走 `OPENCODE_CHANNEL=dev bun run build` + `electron-builder --dir --win`) | 出 `dist-deskfox/win-unpacked/DeskFox 预览版.exe` |
| 3 | 冷启动健康 | 启动带 `--remote-debugging-port=9222` → `python ../OPENCODE-PLAN/诊断工具/cold-start-health-check.py` | **≥2 次 CLEAN** |
| 4 | 全量冒烟 | `python packages/branding/smoke/smoke.py` | 供应商/面板/设置/文件树全 PASS,0 崩溃 |
| 5 | 文件预览渲染 | `python packages/branding/smoke/verify-fileviewer.py`(详见 §2) | pdf/docx/xlsx 出 canvas、png 出 img,4/4 PASS |

启动 packaged exe 带 CDP:

```powershell
Start-Process -FilePath "D:\project\opencode-fork\packages\desktop\dist-deskfox\win-unpacked\DeskFox 预览版.exe" -ArgumentList '--remote-debugging-port=9222'
```

## 2. 阶段 5:文件预览渲染验证

判定逻辑(复用 `smoke.py` 的 `CDP` 类 + `RENDER_CHECK_JS`):文件树点 `[data-tree-path="sample.X"]` → `cdp.click` → 轮询查 viewer。
**pdf / docx / xlsx 都走 pdf.js canvas**(office 经内嵌 LibreOffice 转 PDF),断 `hasCanvas:true`;png 断 `hasImg:true`。顶栏"用本机软件打开"兜底按钮会让 `fallback:true`,**不影响主渲染判定**。

**一条命令跑完(零人工):**

```bash
python packages/branding/smoke/verify-fileviewer.py
```

脚本 `packages/branding/smoke/verify-fileviewer.py`(已入仓)做三件事:① **纯 CDP 点侧边栏 `deskfox-doc-test` 项目图标打开项目**(无 native 对话框)→ ② 等文件树出样本 → ③ 逐个点开验渲染。4/4 PASS 且 exit 0 即过。

### 打开测试项目(全自动方案 — 已打通 2026-06-21)

> 历史难点:desktop renderer 用 `MemoryRouter`(URL 不可驱动)+ `directory-picker-policy.ts` 写死 desktop+local→native 对话框 + 项目 id 非路径 sha1,所以"**首次**打开新项目"只能人工点系统对话框。
> **绕过方案(已验证):测试项目一旦被 DeskFox 打开过一次,就常驻左侧项目侧边栏。** 脚本直接用 CDP 点侧边栏那枚 `aria-label="deskfox-doc-test"` 的图标即可重新打开,**完全不碰 native 对话框**,零人工。前提:夹具项目此前至少被手动打开过一次(侧边栏有它);全新机器仍需人工首开一次,之后永久自动。

> ⚠️ **CDP 求值踩坑(2026-06-21 实测定论)**:在该 renderer 下,`[...document.querySelectorAll('[data-tree-path]')].map(...)` 这种 **spread + map/filter** 写法会让 `Runtime.evaluate` **稳定挂起**(websocket 2s 超时,`ev()` 返回 `{}`),而**等价的 `for` 循环遍历 NodeList 稳定正常**。`verify-fileviewer.py` 的 FIND/DETECT 已统一改 for-loop。新写 CDP 探测脚本遍历文件树元素时务必用 for-loop,别用 spread。(注:`smoke.py` 里对 `button`/`*` 选择器的既有 spread 用法实测正常、已绿,不在此坑范围,勿动。)

## 3. 验收标准

5 阶段全绿才算 Windows 适配性通过。任一 FAIL 在 feat 分支内解决干净(R9),不带病合 main。

## 历史实战

- 2026-06-21:首次跑通全套,5 阶段全绿(typecheck 22/22 · build · 冷启动 2/2 · 冒烟 23/23 · 文件预览 4/4)。阶段 5 当时靠 user 手动 Ctrl+O 打开项目,事后立本 SOP + 推进全自动化。
- 2026-06-21(固化):阶段 5 全自动打通 —— `verify-fileviewer.py` 入仓,纯 CDP 点侧边栏图标打开项目,零人工 4/4 PASS。期间定位并修掉 spread+map 写法让 CDP 求值稳定挂起的坑(改 for-loop),坑沉淀进 §2。
