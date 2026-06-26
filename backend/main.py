"""FastAPI エントリポイント。

エンドポイント:
  POST /api/extract-highlights : PDF からハイライトを抽出
  POST /api/export             : Excel 生成 + Google Sheets 追記
  GET  /api/download/{file_id} : 生成済み Excel のダウンロード

PDF は一時的にメモリ上で処理し、サーバーへ保存しない。
ビルド済みフロントエンド (frontend/dist) があれば配信する。
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
import fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from excel_exporter import build_excel
from pdf_parser import extract_highlights
from sheets_exporter import SheetsConfigError, append_highlights
from table_extractor import reconstruct_table

load_dotenv()

app = FastAPI(title="PDF Highlight Exporter")

_allowed = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 生成した Excel を一時保持する（ダウンロードされたら破棄）
_EXCEL_CACHE: dict[str, dict] = {}


# ---------- スキーマ ----------
class Highlight(BaseModel):
    text: str
    note: str = ""
    page: int | None = None
    color: str | None = None
    cells: list[str] | None = None  # 表として再構成済みのセル配列（先頭=ラベル）


class ExportRequest(BaseModel):
    highlights: list[Highlight]
    filename: str
    spreadsheet_id: str | None = None


# ---------- エンドポイント ----------
@app.post("/api/extract-highlights")
async def extract_highlights_endpoint(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF ファイルを指定してください。")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="ファイルが空です。")

    try:
        highlights = extract_highlights(pdf_bytes)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"PDF の解析に失敗しました: {exc}"
        ) from exc

    return {"highlights": highlights}


@app.post("/api/extract-table")
async def extract_table_endpoint(
    file: UploadFile = File(...),
    page: int = Form(...),
    x0: float = Form(...),
    y0: float = Form(...),
    x1: float = Form(...),
    y1: float = Form(...),
):
    """ドラッグ選択した矩形（視覚座標）から表を再構成して返す。

    Response: { rows: [[cell, ...], ...] }  ※先頭セルがラベル列
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF ファイルを指定してください。")

    pdf_bytes = await file.read()
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"PDF を開けませんでした: {exc}") from exc

    try:
        if page < 1 or page > doc.page_count:
            raise HTTPException(status_code=400, detail="ページ番号が範囲外です。")
        pdf_page = doc.load_page(page - 1)
        bbox = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        rows = reconstruct_table(pdf_page, bbox)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"表の再構成に失敗しました: {exc}") from exc
    finally:
        doc.close()

    return {"rows": rows}


@app.post("/api/export")
async def export_endpoint(req: ExportRequest):
    if not req.highlights:
        raise HTTPException(status_code=400, detail="エクスポートするハイライトがありません。")

    highlights = [h.model_dump() for h in req.highlights]

    # Excel 生成
    try:
        excel_bytes = build_excel(highlights, req.filename)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"Excel の生成に失敗しました: {exc}"
        ) from exc

    file_id = uuid.uuid4().hex
    download_name = Path(req.filename).stem + "_Highlights.xlsx"
    _EXCEL_CACHE[file_id] = {"data": excel_bytes, "name": download_name}
    excel_url = f"/api/download/{file_id}"

    # Google Sheets 追記（任意・失敗しても Excel は返す）
    sheets_url = None
    sheets_error = None
    spreadsheet_id = req.spreadsheet_id or os.getenv("GOOGLE_SPREADSHEET_ID")
    if spreadsheet_id:
        try:
            sheets_url = append_highlights(highlights, req.filename, spreadsheet_id)
        except SheetsConfigError as exc:
            sheets_error = str(exc)
        except Exception as exc:  # noqa: BLE001
            sheets_error = f"Google Sheets への追記に失敗しました: {exc}"
    else:
        sheets_error = "スプレッドシート ID が未設定のため Google Sheets 連携をスキップしました。"

    return {
        "excel_url": excel_url,
        "excel_filename": download_name,
        "sheets_url": sheets_url,
        "sheets_error": sheets_error,
    }


@app.get("/api/download/{file_id}")
async def download_endpoint(file_id: str):
    entry = _EXCEL_CACHE.pop(file_id, None)
    if entry is None:
        raise HTTPException(status_code=404, detail="ファイルが見つからないか期限切れです。")

    return Response(
        content=entry["data"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{entry["name"]}"'
        },
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ---------- フロントエンド配信（ビルド成果物があれば） ----------
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
