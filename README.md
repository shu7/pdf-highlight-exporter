# PDF ハイライト エクスポーター

PDF のハイライト（マーカー）テキストを抽出し、**Excel (.xlsx)** と **Google Sheets** へ
ワンクリックで同時エクスポートする Web アプリです。投資リサーチ用途を想定しています。

- ブラウザ上で PDF を表示（PDF.js）し、本文をドラッグ選択してハイライト追加
- **Adobe Acrobat / Foxit などで付けた既存ハイライトも自動抽出**（PyMuPDF）
- 各ハイライトにメモを付与、不要なものを削除、ドラッグで並び替え
- 「エクスポート」1クリックで Excel ダウンロード ＋ Google Sheets 追記

---

## 構成

```
pdf-highlight-exporter/
├── backend/      FastAPI + PyMuPDF + openpyxl + Google Sheets API
└── frontend/     React 18 + Vite + Tailwind CSS v3 + PDF.js + @dnd-kit
```

---

## セットアップと起動

### 1. バックエンド（FastAPI）

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 環境変数（リポジトリ直下の .env.example をコピー）
cp ../.env.example .env             # 必要に応じて backend/ 直下に配置

# 起動（http://localhost:8000）
uvicorn main:app --reload --port 8000
```

### 2. フロントエンド（Vite 開発サーバー）

別ターミナルで:

```bash
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

ブラウザで <http://localhost:5173> を開きます。
開発時は Vite が `/api` を `http://localhost:8000` へプロキシします。

### 3. 本番ビルド（バックエンドから配信）

```bash
cd frontend
npm run build                       # frontend/dist を生成
```

`frontend/dist` が存在すると、FastAPI が `/` でフロントエンドを配信します。
この場合は <http://localhost:8000> だけでアプリ全体が動作します。

---

## Google Sheets 連携（サービスアカウント認証）

OAuth は使用せず、**サービスアカウント**で認証します。

1. Google Cloud Console でプロジェクトを作成し、**Google Sheets API** を有効化
2. サービスアカウントを作成し、JSON キーをダウンロード
3. キーを `backend/credentials/service_account.json` に配置（gitignore 済み）
4. 追記先スプレッドシートを開き、**サービスアカウントのメールアドレスを「編集者」として共有**
5. `.env` にスプレッドシート ID を設定（URL の `/d/` と `/edit` の間の文字列）

```
GOOGLE_SPREADSHEET_ID=1AbCdEf...xyz
GOOGLE_SA_KEY_PATH=./credentials/service_account.json
ALLOWED_ORIGINS=http://localhost:5173
```

> スプレッドシート ID は UI 右下の入力欄からも指定できます（未入力時は `.env` の値を使用）。
> Google Sheets が未設定でも Excel のダウンロードは動作します（その旨のメッセージを表示）。

---

## API

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/extract-highlights` | PDF（multipart）から既存ハイライトを抽出 |
| POST | `/api/export` | Excel 生成 + Google Sheets 追記。`{ excel_url, sheets_url, sheets_error }` を返す |
| GET | `/api/download/{file_id}` | 生成済み Excel をダウンロード（取得後に破棄） |

PDF はメモリ上で処理され、サーバーに保存されません。

---

## 出力フォーマット

| ハイライトテキスト | メモ | PDFファイル名 | 抽出日時 |
|---|---|---|---|

- Excel: シート名 = `<ファイル名>_Highlights`、ヘッダー太字・背景 `#1F4E79`・白文字、
  列幅自動調整、データ行は交互背景（白 / `#EBF3FB`）
- Google Sheets: 同一シートの最終行下に追記（既存データは上書きしない）

---

## デプロイ（無料で公開する）

このリポジトリには `Dockerfile`（フロントをビルドしてバックエンドから配信）と
`render.yaml`（Render 用設定）が含まれています。

### Render で公開（おすすめ・無料枠あり）

1. <https://render.com> にGitHubアカウントでサインイン
2. 「New +」→「Blueprint」→ このリポジトリ（`shu7/pdf-highlight-exporter`）を選択
3. `render.yaml` が読み込まれ、Docker でビルド＆デプロイされる
4. 数分後に `https://<name>.onrender.com` で誰でもアクセス可能

> 無料プランは一定時間アクセスがないとスリープし、次回アクセス時に起動に数十秒かかります。
> Google Sheets 連携を使う場合のみ環境変数 `GOOGLE_SPREADSHEET_ID` 等を設定してください
> （未設定でも Excel ダウンロードは動作します）。

### ローカルで Docker 実行

```bash
docker build -t pdf-highlight-exporter .
docker run -p 8000:8000 pdf-highlight-exporter
# http://localhost:8000
```

Fly.io / Google Cloud Run など他の Docker 対応PaaSでも同じ `Dockerfile` で動きます。

---

## ライセンスに関する注意（重要）

本プロジェクトのバックエンドは **PyMuPDF (`fitz`)** を使用しています。
PyMuPDF は **GNU AGPL v3** ライセンスで配布されています（商用ライセンスも別途提供）。

AGPL は、本ソフトウェアをネットワーク経由でユーザーに提供する場合、
**サーバー側ソースコードの開示義務**を伴います。商用・クローズドソースで運用する場合は、
Artifex 社の商用ライセンスを取得するか、ライセンス条件をよく確認してください。

- PyMuPDF: <https://github.com/pymupdf/PyMuPDF>（AGPL-3.0）
- 詳細: <https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright>

その他の主要依存（FastAPI, React, Vite, openpyxl, PDF.js, @dnd-kit）は
MIT / BSD / Apache 系のライセンスです。
