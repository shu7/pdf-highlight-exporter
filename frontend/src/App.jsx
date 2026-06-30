import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import PdfViewer from './components/PdfViewer'
import HighlightList from './components/HighlightList'
import ExportButton from './components/ExportButton'
import { extractHighlights, extractTable } from './api/client'
import { detectLang, translations } from './i18n'

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
  const [lang, setLang] = useState(detectLang)
  const t = translations[lang]

  const [file, setFile] = useState(null)
  const [highlights, dispatch] = useReducer(highlightsReducer, [])
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [tableBusy, setTableBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  // 言語を保存し、<html lang> と <title> を更新
  useEffect(() => {
    localStorage.setItem('lang', lang)
    document.documentElement.lang = t.htmlLang
    document.title = t.docTitle
  }, [lang, t])

  const handleFile = useCallback(
    async (f) => {
      if (!f) return
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        setError(t.errPdfOnly)
        return
      }
      setError('')
      setFile(f)
      dispatch({ type: 'clear' })

      // 既存ハイライト（Adobe / Foxit 等）を自動抽出
      setExtracting(true)
      try {
        const items = await extractHighlights(f, lang)
        if (items.length > 0) dispatch({ type: 'addMany', items })
      } catch (err) {
        setError(err.message || t.errExtract)
      } finally {
        setExtracting(false)
      }
    },
    [lang, t]
  )

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
        const rows = await extractTable(file, page, bbox, lang)
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
        setError(err.message || t.errTable)
      } finally {
        setTableBusy(false)
      }
    },
    [file, lang, t]
  )

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ヘッダー */}
      <header className="flex items-center gap-4 border-b bg-brand px-5 py-3 text-white">
        <h1 className="text-lg font-bold">{t.appTitle}</h1>
        <span className="hidden text-xs text-blue-100 sm:inline">
          {t.appSubtitle}
        </span>
        <div className="ml-auto flex items-center gap-4">
          <button
            onClick={() => setLang((l) => (l === 'ja' ? 'en' : 'ja'))}
            className="rounded border border-blue-200/60 px-2 py-0.5 text-xs text-white hover:bg-white/10"
            title="Switch language / 言語切替"
          >
            {t.switchTo}
          </button>
          <a
            href="https://github.com/shu7/pdf-highlight-exporter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-100 underline hover:text-white"
            title={t.sourceCodeTitle}
          >
            {t.sourceCode}
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：PDF 表示 */}
        <main className="flex min-w-0 flex-1 flex-col border-r">
          <PdfViewer file={file} onRegionSelected={handleRegion} busy={tableBusy} t={t} />
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
              <p className="font-medium text-gray-700">{t.dropPdf}</p>
              <p className="mt-1 text-xs text-gray-400">{t.orClick}</p>
              {file && (
                <p className="mt-2 truncate text-xs text-brand">📄 {file.name}</p>
              )}
            </div>
            {extracting && (
              <p className="mt-2 text-xs text-gray-500">{t.extracting}</p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>

          {/* ハイライト一覧 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                {t.highlightsHeading(highlights.length)}
              </h2>
              {highlights.length > 0 && (
                <button
                  onClick={() => dispatch({ type: 'clear' })}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  {t.clearAll}
                </button>
              )}
            </div>
            <HighlightList
              highlights={highlights}
              onReorder={(items) => dispatch({ type: 'reorder', items })}
              onNoteChange={(id, note) => dispatch({ type: 'note', id, note })}
              onDelete={(id) => dispatch({ type: 'delete', id })}
              t={t}
            />
          </div>

          {/* エクスポート */}
          <div className="space-y-3 border-t bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                {t.sheetIdLabel}
              </label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder={t.sheetIdPlaceholder}
                className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <ExportButton
              highlights={highlights}
              filename={file?.name}
              spreadsheetId={spreadsheetId}
              lang={lang}
              t={t}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
