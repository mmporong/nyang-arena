#!/usr/bin/env python3
"""docs/*.md → PDF.

NAN 사전과제는 소개 문서와 AI 활용 기술 문서를 PDF로 요구한다.
마크다운을 단일 소스로 두고 여기서 변환한다 — 문서를 두 벌 관리하지 않기 위해서.

Chrome headless의 --print-to-pdf를 쓴다(이 머신에 pandoc/weasyprint가 없다).

실행: npm run docs
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

DOCS = Path(__file__).resolve().parent.parent / "docs"

CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: "Noto Sans KR", "Malgun Gothic", system-ui, -apple-system, sans-serif;
  font-size: 10.5pt; line-height: 1.65; color: #1a1a1f; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 19pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
h2 { font-size: 13.5pt; margin: 20pt 0 6pt; padding-bottom: 3pt;
     border-bottom: 1.5px solid #d8d4e4; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 13pt 0 4pt; page-break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
li { margin: 2pt 0; }
hr { border: none; border-top: 1px solid #e2dfea; margin: 14pt 0; }
strong { font-weight: 700; }
a { color: #2f5fd0; text-decoration: none; word-break: break-all; }
code {
  font-family: "DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 9pt; background: #f2f0f7; padding: 1px 4px; border-radius: 3px;
}
pre {
  background: #f7f6fb; border: 1px solid #e2dfea; border-radius: 5px;
  padding: 9pt 11pt; overflow-x: auto; page-break-inside: avoid; margin: 0 0 9pt;
}
pre code { background: none; padding: 0; font-size: 8.6pt; line-height: 1.5; }
table {
  border-collapse: collapse; width: 100%; margin: 0 0 10pt;
  font-size: 9.4pt; page-break-inside: avoid;
}
th, td { border: 1px solid #ddd9e8; padding: 4.5pt 7pt; text-align: left; vertical-align: top; }
th { background: #f4f2f9; font-weight: 700; }
blockquote { margin: 0 0 8pt; padding-left: 10pt; border-left: 3px solid #d8d4e4; color: #55506a; }
"""

TEMPLATE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>{title}</title>
<style>{css}</style></head><body>{body}</body></html>"""


def find_chrome() -> str:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    # playwright가 받아둔 크로미움도 후보
    for p in sorted((Path.home() / ".cache/ms-playwright").glob("chromium-*/chrome-linux/chrome")):
        return str(p)
    sys.exit("Chrome 계열 브라우저를 찾지 못했습니다")


def convert(md_path: Path, chrome: str) -> Path:
    html = markdown.markdown(
        md_path.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code", "sane_lists"],
    )
    title = md_path.stem
    doc = TEMPLATE.format(title=title, css=CSS, body=html)

    out = md_path.with_suffix(".pdf")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"{title}.html"
        src.write_text(doc, encoding="utf-8")
        subprocess.run(
            [
                chrome,
                "--headless",
                "--disable-gpu",
                "--no-sandbox",
                f"--user-data-dir={tmp}/profile",
                "--no-pdf-header-footer",
                f"--print-to-pdf={out}",
                src.as_uri(),
            ],
            check=True,
            capture_output=True,
        )
    return out


def main() -> None:
    chrome = find_chrome()
    targets = sorted(DOCS.glob("*.md"))
    if not targets:
        sys.exit(f"{DOCS}에 마크다운이 없습니다")
    for md in targets:
        pdf = convert(md, chrome)
        print(f"  {md.name} → {pdf.name} ({pdf.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
