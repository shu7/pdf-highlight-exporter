"""PDF の指定領域から表を再構成するモジュール（PyMuPDF）。

ブラウザでドラッグ選択した矩形（視覚座標＝PDF.js のビューポート座標を
拡大率で割ったもの）を受け取り、その範囲の単語を行・列に復元する。

- ページ回転（/Rotate 90 等）に対応（rotation_matrix で視覚座標へ変換）。
- 数値は右揃えされる前提で、数値語の右端をクラスタリングして列を決める。
- 先頭の非数値カラム（ラベル：銘柄名・期間など）は1列に結合する。
"""

from __future__ import annotations

import re

import fitz

_CURRENCY = set("$€£¥")
# 単語単体が数値とみなせるか（通貨記号は事前に除去）
_NUM_WORD = re.compile(r"^[(]?\d[\d,.]*[)%]?$|^\d[\d,.]*x$")
# セル全体が「きれいな数値」か（ラベル列判定用）
_NUM_CELL = re.compile(r"^[(]?[$€£¥]?\d[\d,.]*[)%]?$|^[$€£¥]?\d[\d,.]*x$")
# 「値らしい」セル（金額・比率・倍率）。単独の4桁年（例 1996, 1999)）は除外したい。
_RICH_VALUE = re.compile(r"[,$€£¥%]|\d+\.?\d*x$|\d{5,}")


def _is_num_word(t: str) -> bool:
    return bool(_NUM_WORD.match(t.lstrip("$€£¥")))


def _is_num_cell(t: str) -> bool:
    return bool(_NUM_CELL.match(t.strip()))


def _visual_words(page: "fitz.Page") -> list[list]:
    """ページ単語を視覚座標 [x0, y0, x1, y1, text] に変換して返す。"""
    mat = page.rotation_matrix
    out = []
    for w in page.get_text("words"):
        if not w[4]:
            continue
        r = fitz.Rect(w[:4]) * mat
        out.append([r.x0, r.y0, r.x1, r.y1, w[4]])
    return out


def _cluster(vals: list[float], tol: float) -> list[list[float]]:
    vals = sorted(vals)
    groups = [[vals[0]]]
    for v in vals[1:]:
        if v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return groups


def reconstruct_table(
    page: "fitz.Page",
    bbox: tuple[float, float, float, float],
    row_tol: float = 4.0,
    col_tol: float = 7.0,
) -> list[list[str]]:
    """視覚座標 bbox 内の単語から表（行×列）を復元して返す。

    Returns:
        list[list[str]] : 行ごとのセル文字列。全行同じ列数。
    """
    words = _visual_words(page)
    x0, y0, x1, y1 = bbox
    sel = [
        w
        for w in words
        if w[0] >= x0 - 1 and w[2] <= x1 + 1 and w[1] >= y0 - 1 and w[3] <= y1 + 1
    ]
    if not sel:
        return []

    # --- 行のグループ化（視覚 y で近接結合） ---
    sel.sort(key=lambda w: (w[1], w[0]))
    rows: list[list[list]] = []
    cur: list[list] = []
    cy = None
    for w in sel:
        if cy is None or abs(w[1] - cy) <= row_tol:
            cur.append(w)
            cy = w[1] if cy is None else (cy + w[1]) / 2
        else:
            rows.append(cur)
            cur = [w]
            cy = w[1]
    if cur:
        rows.append(cur)

    # --- 行内で通貨記号を直後の数値に結合（"$" "140,714" -> "$140,714"） ---
    for r in rows:
        r.sort(key=lambda w: w[0])
        i = 0
        while i < len(r) - 1:
            if r[i][4] in _CURRENCY:
                r[i + 1][0] = r[i][0]
                r[i + 1][4] = r[i][4] + r[i + 1][4]
                del r[i]
            else:
                i += 1

    # --- 数値語の右端をクラスタリングして値カラムを決定 ---
    n_rows = len(rows)
    rights = [w[2] for r in rows for w in r if _is_num_word(w[4])]
    if not rights:
        # 数値がない＝表ではない。各行を1セルにして返す
        return [[" ".join(w[4] for w in r)] for r in rows]

    support = max(3, int(0.15 * n_rows))
    groups = _cluster(rights, col_tol)
    strong = [g for g in groups if len(g) >= support]
    if not strong:
        strong = groups
    anchors = sorted(sum(g) / len(g) for g in strong)

    # ラベル境界：最も左の値カラムに属する単語の左端
    lefts = []
    for g in strong:
        lo, hi = min(g), max(g)
        for r in rows:
            for w in r:
                if _is_num_word(w[4]) and lo - 1 <= w[2] <= hi + 1:
                    lefts.append(w[0])
    label_right = (min(lefts) - 4) if lefts else x1

    # --- 各単語を列へ割り当て ---
    grid: list[list[str]] = []
    for r in rows:
        cells = [""] * (len(anchors) + 1)
        for w in r:
            center = (w[0] + w[2]) / 2
            if center < label_right:
                cells[0] = (cells[0] + " " + w[4]).strip()
            else:
                k = min(range(len(anchors)), key=lambda i: abs(anchors[i] - w[2]))
                cells[k + 1] = (cells[k + 1] + " " + w[4]).strip()
        grid.append(cells)

    grid = _merge_leading_label_columns(grid)
    grid = _drop_empty_columns(grid)
    return grid


def _merge_leading_label_columns(grid: list[list[str]]) -> list[list[str]]:
    """先頭の非数値カラム（銘柄名・期間など）を1つのラベル列に結合する。"""
    if not grid:
        return grid
    n_cols = len(grid[0])

    def rich_ratio(col: int) -> float:
        vals = [row[col] for row in grid if row[col]]
        if not vals:
            return 0.0
        # 金額・比率・倍率などの「値らしさ」。単独の年（1996 等）は値とみなさない
        return sum(bool(_RICH_VALUE.search(v)) for v in vals) / len(vals)

    # 最初に「値らしい」列＝最初の値カラムを探す（手前はすべてラベルへ結合）
    first_value_col = n_cols
    for c in range(n_cols):
        if rich_ratio(c) >= 0.5:
            first_value_col = c
            break

    if first_value_col <= 1:
        return grid  # 結合不要

    merged = []
    for row in grid:
        label = " ".join(p for p in row[:first_value_col] if p).strip()
        merged.append([label, *row[first_value_col:]])
    return merged


def _drop_empty_columns(grid: list[list[str]]) -> list[list[str]]:
    if not grid:
        return grid
    keep = [j for j in range(len(grid[0])) if any(row[j] for row in grid)]
    return [[row[j] for j in keep] for row in grid]
