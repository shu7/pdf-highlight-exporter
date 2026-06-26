import { useCallback, useReducer, useRef, useState } from 'react'
import PdfViewer from './components/PdfViewer'
import HighlightList from './components/HighlightList'
import ExportButton from './components/ExportButton'
import { extractHighlights, extractTable } from './api/client'

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2)
}

// ハイライト一覧の状態管理
function highlightsReducer(state, action) {
  switch (action.type) {
    case 'set':
      return action.items
    case 'add':
      return [...state, { id: uid(), note: '', ...action.item }]
    case 'addMany':
      return [
        ...state,
        ...action.items.map((it) => ({ id: uid(), note: '', ...it })),
      ]
    case 'reorder':
      return action.items
    case 'note':
      return state.map((h) =>
        h.id === action.id ? { ...h, note: action.note } : h
      )
    case 'delete':
      return state.filter((h) => h.id !== action.id)
    case 'clear':
      return []
    default:
      return state
  }
}

export default function App() {
  const [file, setFile] = useState(null)
  const [highlights, dispatch] = useReducer(highlightsReducer, [])
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [tableBusy, setTableBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleFile = useCallback(async (f) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF ファイルを選択してください。')
      return
    }
    setError('')
    setFile(f)
    dispatch({ type: 'clear' })

    // 既存ハイライト（Adobe / Foxit 等）を自動抽出
    setExtracting(true)
    try {
      const items = await extractHighlights(f)
      if (items.length > 0) dispatch({ type: 'addMany', items })
    } catch (err) {
      setError(err.message || 'ハイライト抽出に失敗しました。')
    } finally {
      setExtracting(false)
    }
  }, [])

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    handleFile(f)
  }

  // ドラッグ選択した領域を表として再構成し、行ごとにリストへ追加
  const handleRegion = useCallback(
    async ({ page, bbox }) => {
      if (!file) return
      setError('')
      setTableBusy(true)
      try {
        const rows = await extractTable(file, page, bbox)
        const items = rows
          .filter((cells) => cells.some((c) => c && c.trim()))
          .map((cells) => ({
            cells,
            text: cells.filter(Boolean).join('  '),
            page,
            color: '#FFFF00',
          }))
        if (items.length > 0) dispatch({ type: 'addMany', items })
      } catch (err) {
        setError(err.message || '表の再構成に失敗しました。')
      } finally {
        setTableBusy(false)
      }
    },
    [file]
  )

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ヘッダー */}
      <header className="flex items-center gap-4 border-b bg-brand px-5 py-3 text-white">
        <h1 className="text-lg font-bold">PDF ハイライト エクスポーター</h1>
        <span className="text-xs text-blue-100">
          投資リサーチ向け・ハイライト抽出 → Excel / Google Sheets
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：PDF 表示 */}
        <main className="flex min-w-0 flex-1 flex-col border-r">
          <PdfViewer file={file} onRegionSelected={handleRegion} busy={tableBusy} />
        </main>

        {/* 右：操作パネル */}
        <aside className="flex w-[400px] flex-col bg-gray-50">
          {/* アップロード */}
          <div className="border-b bg-white p-4">
            <div
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center text-sm transition ${
                dragOver
                  ? 'border-brand bg-brandLight'
                  : 'border-gray-300 hover:border-brand hover:bg-gray-50'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <p className="font-medium text-gray-700">
                PDF をドラッグ＆ドロップ
              </p>
              <p className="mt-1 text-xs text-gray-400">またはクリックして選択</p>
              {file && (
                <p className="mt-2 truncate text-xs text-brand">📄 {file.name}</p>
              )}
            </div>
            {extracting && (
              <p className="mt-2 text-xs text-gray-500">既存ハイライトを抽出中…</p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>

          {/* ハイライト一覧 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                ハイライト一覧（{highlights.length}）
              </h2>
              {highlights.length > 0 && (
                <button
                  onClick={() => dispatch({ type: 'clear' })}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  すべて削除
                </button>
              )}
            </div>
            <HighlightList
              highlights={highlights}
              onReorder={(items) => dispatch({ type: 'reorder', items })}
              onNoteChange={(id, note) => dispatch({ type: 'note', id, note })}
              onDelete={(id) => dispatch({ type: 'delete', id })}
            />
          </div>

          {/* エクスポート */}
          <div className="space-y-3 border-t bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Google スプレッドシート ID（任意・未入力時は .env の値を使用）
              </label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder="例: 1AbC...xyz"
                className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <ExportButton
              highlights={highlights}
              filename={file?.name}
              spreadsheetId={spreadsheetId}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
