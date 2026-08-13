#!/usr/bin/env python3
"""[fork-only] 生成 UI 测试专用项目与各格式样本文件 [feat: ui-probe-toolkit] 2026-08-13

## 为什么要有独立测试项目

CHECKLIST 第 3 组含**归档 / 删除 / 分享**这类破坏性或对外的动作,第 4 组要逐格式验预览。
在 user 的真实项目(如 /Volumes/ExtSSD/Finance)里跑这些 = 拿真实数据练手,
「分享」还会把内容发到站外。所以固定用一个自建项目,内容全是可丢弃的样本。

顺带解决第 4 组的取材问题:.docx/.xlsx/.pdf/图片/超大文件 每次手工找一遍很浪费,
这里一次性生成,且**内容带可判定特征**(如 md 里的粗体/引用/内链),
预览对不对能直接断言,而不是「看着像渲染出来了」。

生成的是 git 仓且**故意留有未提交改动** —— 第 2 组 #15 的「N 更改」tab 需要真有 diff 才渲染。

跑法:
    python3 packages/branding/smoke/make_fixtures.py [目标目录]
默认目标 /Volumes/ExtSSD/deskfox-uitest(与 user 真实项目分开)。
"""
import os
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/Volumes/ExtSSD/deskfox-uitest"
APP = ("/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/"
       "DeskFox 本地版.app/Contents/Resources/libreoffice/Contents/MacOS/soffice")

# 每个样本都带**可判定特征**,预览结果能断言而不是靠肉眼「看着对」
MD_MAIN = """# 预览验收样本

这是一段普通正文,含**加粗特征词 BOLDMARK** 与 `行内代码 CODEMARK`。

## 二级标题 HEAD2

> 引用块特征词 QUOTEMARK

- 列表项一 LIST1
- 列表项二 LIST2
- 列表项三 LIST3

1. 有序项一
2. 有序项二

站内链接:[跳到子文档](./notes/sub.md)
站外链接:[example](https://example.com)

| 列 A | 列 B |
|---|---|
| A1 | B1 |
| A2 | B2 |
"""

MD_SUB = """# 子文档 SUBDOC

从 README 的站内链接跳过来应当**留在应用内**,不得外开浏览器。

返回:[回到 README](../README.md)
"""

PY_SRC = '''"""CodeMirror 路径样本 —— 代码类文件走 CodeMirror,选中行为与 DocumentViewer 不同。"""


def marked_function(value):
    """PYMARK 特征函数,便于在预览里定位。"""
    total = 0
    for index in range(value):
        total += index * 2
    return total


class SampleClass:
    def __init__(self, name):
        self.name = name

    def describe(self):
        return f"sample:{self.name}"


if __name__ == "__main__":
    print(marked_function(10))
'''

JSON_SRC = """{
  "marker": "JSONMARK",
  "nested": { "list": [1, 2, 3], "flag": true },
  "chinese": "中文键值也要正常显示"
}
"""

TOML_SRC = """# TOMLMARK
[section]
name = "sample"
count = 42

[section.nested]
enabled = true
"""

TXT_SRC = ("纯文本样本 TXTMARK\n"
           "第二行,含中文与 ASCII 混排 mixed 123\n"
           "第三行\n")


def w(rel, content):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def make_docx():
    from docx import Document
    doc = Document()
    doc.add_heading("DOCX 样本标题 DOCXMARK", level=1)
    doc.add_paragraph("第一段正文,内置 LibreOffice 转换后应能看到这句。")
    doc.add_heading("小节标题", level=2)
    for i in range(1, 4):
        doc.add_paragraph("列表项 %d" % i, style="List Bullet")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "表头A"
    table.cell(0, 1).text = "表头B"
    table.cell(1, 0).text = "值1"
    table.cell(1, 1).text = "值2"
    path = os.path.join(ROOT, "docs", "sample.docx")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    doc.save(path)
    return path


def make_xlsx():
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "数据表"
    ws.append(["名称", "数量", "备注"])
    for i in range(1, 11):
        ws.append(["条目%d" % i, i * 10, "XLSXMARK" if i == 1 else ""])
    ws2 = wb.create_sheet("第二表")
    ws2.append(["SHEET2MARK"])
    path = os.path.join(ROOT, "docs", "sample.xlsx")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)
    return path


def make_png():
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (640, 360), (36, 62, 99))
    d = ImageDraw.Draw(img)
    # 画三个高对比色块 —— 图片预览是否真渲染可用像素采样判定,不靠「看着有图」
    d.rectangle([40, 40, 200, 200], fill=(220, 80, 60))
    d.rectangle([240, 40, 400, 200], fill=(90, 200, 120))
    d.rectangle([440, 40, 600, 200], fill=(240, 200, 70))
    d.text((40, 260), "PNGMARK 640x360", fill=(255, 255, 255))
    path = os.path.join(ROOT, "images", "sample.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path


def make_pdf(docx_path):
    """用应用内置的 LibreOffice 转 PDF —— 与产品实际使用的是同一套引擎。"""
    if not os.path.exists(APP):
        print("  ! 找不到内置 LibreOffice,跳过 PDF 生成")
        return None
    out_dir = os.path.join(ROOT, "docs")
    r = subprocess.run([APP, "--headless", "--norestore", "--convert-to", "pdf",
                        "--outdir", out_dir, docx_path],
                       capture_output=True, text=True, timeout=180)
    path = os.path.join(out_dir, "sample.pdf")
    if not os.path.exists(path):
        print("  ! PDF 生成失败:", (r.stderr or r.stdout)[:200])
        return None
    return path


def make_big():
    """大文件预览守卫(#46)的取材。行内带行号,便于确认是截断还是全量。"""
    path = os.path.join(ROOT, "big", "large.txt")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for i in range(400000):
            f.write("第 %07d 行 —— 大文件守卫样本 BIGMARK 填充填充填充填充\n" % i)
    return path


def git(*args):
    return subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True)


def main():
    os.makedirs(ROOT, exist_ok=True)
    print("生成测试项目:%s" % ROOT)

    made = [w("README.md", MD_MAIN), w("notes/sub.md", MD_SUB),
            w("code/sample.py", PY_SRC), w("code/data.json", JSON_SRC),
            w("code/config.toml", TOML_SRC), w("code/plain.txt", TXT_SRC)]
    docx = make_docx(); made.append(docx)
    made.append(make_xlsx())
    made.append(make_png())
    pdf = make_pdf(docx)
    if pdf:
        made.append(pdf)
    made.append(make_big())

    # git 仓 + 故意留改动:第 2 组 #15 的「N 更改」tab 没有 diff 就不渲染
    if not os.path.isdir(os.path.join(ROOT, ".git")):
        git("init", "-q")
        git("config", "user.email", "uitest@local")
        git("config", "user.name", "uitest")
    w(".gitignore", "big/\n")
    git("add", "-A")
    git("commit", "-q", "-m", "fixtures baseline")
    w("README.md", MD_MAIN + "\n<!-- 未提交改动:让「N 更改」tab 有内容 -->\n")
    w("code/untracked.py", "# 未跟踪文件 UNTRACKEDMARK\nvalue = 1\n")

    st = git("status", "--porcelain").stdout.strip().splitlines()
    print("\n共 %d 个样本文件,git 未提交改动 %d 条" % (len(made), len(st)))
    for p in made:
        print("  %8.1f KB  %s" % (os.path.getsize(p) / 1024, p.replace(ROOT + "/", "")))
    print("\n改动清单:", ", ".join(st))


if __name__ == "__main__":
    main()
