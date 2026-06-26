"""PyMuPDF (fitz) を用いた PDF ハイライト抽出モジュール。

Adobe Acrobat / Foxit などで付与された既存のハイライト注釈
(Highlight annotation, subtype = 8) を読み取り、ハイライトされた
範囲のテキストを抽出する。
"""

from __future__ import annotations

import fitz  # PyMuPDF


# PyMuPDF の注釈タイプ番号
# 8 = Highlight, 9 = Underline, 10 = Squiggly, 11 = StrikeOut
_MARKUP_TYPES = {8: "highlight", 9: "underline", 10: "squiggly", 11: "strikeout"}


def _rgb_to_hex(rgb) -> str:
    """PyMuPDF の (r, g, b) 浮動小数色を #RRGGBB 形式へ変換する。"""
    if not rgb:
        return "#FFFF00"  # 既定は黄色
    try:
        r, g, b = (int(round(c * 255)) for c in rgb[:3])
        return f"#{r:02X}{g:02X}{b:02X}"
    except (TypeError, ValueError):
        return "#FFFF00"


def _text_from_quads(page: "fitz.Page", annot: "fitz.Annot") -> str:
    """ハイライト注釈の quadpoints から該当テキストを抽出する。

    1つのハイライトが複数行にまたがる場合、頂点 (vertices) は
    4点ずつのグループ（各行の四角形）として並ぶ。各行ごとに
    矩形を作りテキストを取り出して連結する。
    """
    vertices = annot.vertices
    if not vertices:
        # quadpoints が無い場合は注釈全体の矩形でフォールバック
        return page.get_textbox(annot.rect).strip()

    lines: list[str] = []
    for i in range(0, len(vertices), 4):
        quad_points = vertices[i : i + 4]
        if len(quad_points) < 4:
            continue
        rect = fitz.Quad(quad_points).rect
        # 取りこぼしを防ぐため僅かに矩形を拡張
        rect = rect + (-1, -1, 1, 1)
        line_text = page.get_textbox(rect).strip()
        if line_text:
            lines.append(line_text)

    # 行末ハイフンの連結などは行わず、空白で結合する
    return " ".join(lines).strip()


def extract_highlights(pdf_bytes: bytes) -> list[dict]:
    """PDF バイト列から既存ハイライトを抽出して返す。

    Returns:
        [{ "text": str, "page": int, "color": "#RRGGBB" }, ...]
    """
    highlights: list[dict] = []

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            annot = page.first_annot
            while annot:
                annot_type = annot.type[0]
                if annot_type in _MARKUP_TYPES:
                    text = _text_from_quads(page, annot)
                    if text:
                        colors = annot.colors or {}
                        stroke = colors.get("stroke") or colors.get("fill")
                        highlights.append(
                            {
                                "text": text,
                                "page": page_index + 1,
                                "color": _rgb_to_hex(stroke),
                            }
                        )
                annot = annot.next
    finally:
        doc.close()

    return highlights
