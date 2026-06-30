import { useState } from 'react'
import { downloadExcel, exportHighlights } from '../api/client'

export default function ExportButton({ highlights, filename, spreadsheetId, lang, t }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'success'|'warn'|'error', text }

  async function handleExport() {
    if (highlights.length === 0) {
      setMessage({ type: 'error', text: t.exportNoHighlights })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      // バックエンドへ送る項目（cells があれば表として整列済み）
      const payload = highlights.map((h) => ({
        text: h.text,
        note: h.note || '',
        page: h.page ?? null,
        color: h.color || null,
        cells: h.cells || null,
      }))

      const result = await exportHighlights({
        highlights: payload,
        filename: filename || 'highlights.pdf',
        spreadsheetId,
        lang,
      })

      // Excel をダウンロード
      await downloadExcel(result.excel_url, result.excel_filename)

      if (result.sheets_url) {
        setMessage({ type: 'success', text: t.exportSuccess })
      } else {
        setMessage({
          type: 'warn',
          text:
            t.exportExcelOnly +
            (result.sheets_error ? ` (${result.sheets_error})` : ''),
        })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || t.exportFailed })
    } finally {
      setBusy(false)
    }
  }

  const colorMap = {
    success: 'text-green-700',
    warn: 'text-amber-700',
    error: 'text-red-600',
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleExport}
        disabled={busy}
        className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white shadow hover:bg-[#163a5c] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t.exporting : t.exportBtn}
      </button>
      {message && (
        <p className={`text-xs ${colorMap[message.type]}`}>{message.text}</p>
      )}
    </div>
  )
}
