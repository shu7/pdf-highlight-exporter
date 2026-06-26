"""Google Sheets API 連携モジュール（サービスアカウント認証）。

既存データを上書きせず、シート最終行の下に追記する。
"""

from __future__ import annotations

import os

from google.oauth2 import service_account
from googleapiclient.discovery import build

from excel_exporter import build_table

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


class SheetsConfigError(RuntimeError):
    """Google Sheets 連携の設定不備を表す例外。"""


def _get_service():
    key_path = os.getenv("GOOGLE_SA_KEY_PATH", "./credentials/service_account.json")
    if not os.path.exists(key_path):
        raise SheetsConfigError(
            f"サービスアカウントキーが見つかりません: {key_path}。"
            "GOOGLE_SA_KEY_PATH を確認してください。"
        )
    try:
        creds = service_account.Credentials.from_service_account_file(
            key_path, scopes=_SCOPES
        )
    except Exception as exc:  # noqa: BLE001 - 認証失敗を日本語で集約
        raise SheetsConfigError(f"サービスアカウント認証に失敗しました: {exc}") from exc

    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _ensure_header(service, spreadsheet_id: str, headers: list) -> None:
    """シートが空ならヘッダー行を書き込む。"""
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range="A1")
        .execute()
    )
    if not result.get("values"):
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range="A1",
            valueInputOption="RAW",
            body={"values": [headers]},
        ).execute()


def append_highlights(
    highlights: list[dict], filename: str, spreadsheet_id: str
) -> str:
    """ハイライト一覧を Google Sheets に追記し、スプレッドシート URL を返す。

    Raises:
        SheetsConfigError: 設定不備・認証失敗時。
    """
    if not spreadsheet_id:
        raise SheetsConfigError("スプレッドシート ID が指定されていません。")

    service = _get_service()
    headers, rows = build_table(highlights, filename)
    _ensure_header(service, spreadsheet_id, headers)

    service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range="A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()

    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
