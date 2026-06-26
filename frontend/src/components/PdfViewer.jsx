import { useEffect, useRef, useState } from 'react'

const PDFJS_VERSION = '4.10.38'
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

// PDF.js を CDN から一度だけ動的読み込みする
let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL
      return lib
    })
  }
  return pdfjsPromise
}

export default function PdfViewer({ file, onRegionSelected, busy }) {
  const containerRef = useRef(null)
  const bandRef = useRef(null) // ラバーバンド（選択矩形）DOM
  const dragRef = useRef(null) // { wrapper, startX, startY }
  const onRegionRef = useRef(onRegionSelected)
  const scaleRef = useRef(1.3)

  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [errorMsg, setErrorMsg] = useState('')
  const [scale, setScale] = useState(1.3)

  onRegionRef.current = onRegionSelected
  scaleRef.current = scale

  // ---- レンダリング（キャンバスのみ。テキストレイヤーは使わない＝回転ズレを回避）----
  useEffect(() => {
    if (!file) {
      setStatus('idle')
      return
    }
    let cancelled = false

    async function render() {
      setStatus('loading')
      setErrorMsg('')
      try {
        const pdfjsLib = await loadPdfjs()
        const buffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

        const container = containerRef.current
        if (!container || cancelled) return
        container.innerHTML = ''

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return
          const page = await pdf.getPage(pageNum)
          const viewport = page.getViewport({ scale })

          const wrapper = document.createElement('div')
          wrapper.className = 'pdf-page-wrapper'
          wrapper.dataset.page = String(pageNum)
          wrapper.style.width = `${viewport.width}px`
          wrapper.style.height = `${viewport.height}px`

          const canvas = document.createElement('canvas')
          const dpr = window.devicePixelRatio || 1
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${viewport.width}px`
          canvas.style.height = `${viewport.height}px`
          const ctx = canvas.getContext('2d')
          wrapper.appendChild(canvas)

          // 「このページ全体を取り込む」ボタン（スクロール選択不要の保険）
          const visW = viewport.width / scale
          const visH = viewport.height / scale
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'page-import-btn'
          btn.textContent = '▦ このページの表を全部取り込む'
          btn.addEventListener('mousedown', (ev) => ev.stopPropagation())
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation()
            onRegionRef.current({ page: pageNum, bbox: [0, 0, visW, visH] })
          })
          wrapper.appendChild(btn)

          container.appendChild(wrapper)

          await page.render({
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise
        }

        if (!cancelled) setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          setErrorMsg('PDF の表示に失敗しました: ' + (err?.message || err))
          setStatus('error')
        }
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [file, scale])

  // ---- ラバーバンド選択（ドラッグで矩形を描き、視覚PDF座標を送る）----
  useEffect(() => {
    function updateBand(x0, y0, x1, y1) {
      const b = bandRef.current
      if (!b) return
      b.style.left = `${Math.min(x0, x1)}px`
      b.style.top = `${Math.min(y0, y1)}px`
      b.style.width = `${Math.abs(x1 - x0)}px`
      b.style.height = `${Math.abs(y1 - y0)}px`
    }

    function onDown(e) {
      const wrapper = e.target.closest?.('.pdf-page-wrapper')
      if (!wrapper || !containerRef.current?.contains(wrapper)) return
      if (e.target.closest?.('button')) return // ボタンクリックは無視
      e.preventDefault()
      const rect = wrapper.getBoundingClientRect()
      const startX = e.clientX - rect.left
      const startY = e.clientY - rect.top
      const band = document.createElement('div')
      band.className = 'selection-band'
      wrapper.appendChild(band)
      bandRef.current = band
      dragRef.current = { wrapper, startX, startY }
      updateBand(startX, startY, startX, startY)
    }

    function onMove(e) {
      const d = dragRef.current
      if (!d) return
      const rect = d.wrapper.getBoundingClientRect()
      updateBand(d.startX, d.startY, e.clientX - rect.left, e.clientY - rect.top)
    }

    function onUp(e) {
      const d = dragRef.current
      if (!d) return
      const rect = d.wrapper.getBoundingClientRect()
      const cx = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
      const cy = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
      const x0 = Math.min(d.startX, cx)
      const y0 = Math.min(d.startY, cy)
      const x1 = Math.max(d.startX, cx)
      const y1 = Math.max(d.startY, cy)
      if (bandRef.current) {
        bandRef.current.remove()
        bandRef.current = null
      }
      const page = Number(d.wrapper.dataset.page)
      dragRef.current = null
      if (x1 - x0 > 6 && y1 - y0 > 6) {
        const s = scaleRef.current
        onRegionRef.current({ page, bbox: [x0 / s, y0 / s, x1 / s, y1 / s] })
      }
    }

    const el = containerRef.current
    el?.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      el?.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-white px-3 py-2 text-sm">
        <span className="font-medium text-gray-700">表示倍率</span>
        <button
          className="rounded border px-2 py-0.5 hover:bg-gray-100"
          onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)))}
        >
          −
        </button>
        <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <button
          className="rounded border px-2 py-0.5 hover:bg-gray-100"
          onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}
        >
          ＋
        </button>
        <span className="ml-auto text-xs text-gray-400">
          {busy
            ? '表を再構成中…'
            : '表を四角く囲んで選択（縮小すると全体を一度に囲めます）'}
        </span>
      </div>

      <div className="relative flex-1 overflow-auto bg-gray-200 p-4">
        {status === 'idle' && (
          <p className="mt-10 text-center text-gray-500">
            右上から PDF をアップロードしてください。
          </p>
        )}
        {status === 'loading' && (
          <p className="mt-10 text-center text-gray-500">PDF を読み込み中…</p>
        )}
        {status === 'error' && (
          <p className="mt-10 text-center text-red-600">{errorMsg}</p>
        )}
        <div ref={containerRef} className="select-none" />
      </div>
    </div>
  )
}
