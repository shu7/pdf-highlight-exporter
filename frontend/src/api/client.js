// FastAPI バックエンド呼び出しラッパー。
// 開発時は vite.config.js のプロキシ経由、本番は同一オリジンで動作する。
// lang を Accept-Language ヘッダーで送り、サーバー側メッセージも言語対応させる。

const BASE = '/api'

function langHeaders(lang) {
  return lang ? { 'Accept-Language': lang } : {}
}

async function parseError(res, lang) {
  const fallback =
    lang === 'en'
      ? `An error occurred (HTTP ${res.status})`
      : `エラーが発生しました (HTTP ${res.status})`
  try {
    const data = await res.json()
    return data.detail || fallback
  } catch {
    return fallback
  }
}

// PDF をアップロードして既存ハイライトを抽出する
export async function extractHighlights(file, lang) {
  const form = new FormData()
  form.append('file', file)

  const res = await fetch(`${BASE}/extract-highlights`, {
    method: 'POST',
    body: form,
    headers: langHeaders(lang),
  })
  if (!res.ok) throw new Error(await parseError(res, lang))

  const data = await res.json()
  return data.highlights || []
}

// ドラッグ選択した矩形（視覚PDF座標）から表を再構成する
export async function extractTable(file, page, bbox, lang) {
  const form = new FormData()
  form.append('file', file)
  form.append('page', String(page))
  form.append('x0', String(bbox[0]))
  form.append('y0', String(bbox[1]))
  form.append('x1', String(bbox[2]))
  form.append('y1', String(bbox[3]))

  const res = await fetch(`${BASE}/extract-table`, {
    method: 'POST',
    body: form,
    headers: langHeaders(lang),
  })
  if (!res.ok) throw new Error(await parseError(res, lang))
  const data = await res.json()
  return data.rows || []
}

// ハイライト一覧を Excel + Google Sheets へエクスポートする
export async function exportHighlights({ highlights, filename, spreadsheetId, lang }) {
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...langHeaders(lang) },
    body: JSON.stringify({
      highlights,
      filename,
      spreadsheet_id: spreadsheetId || null,
    }),
  })
  if (!res.ok) throw new Error(await parseError(res, lang))
  return res.json()
}

// Excel をブラウザにダウンロードさせる
export async function downloadExcel(excelUrl, filename) {
  const res = await fetch(excelUrl)
  if (!res.ok) throw new Error(await parseError(res))

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'highlights.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
