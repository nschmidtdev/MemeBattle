'use client'

import { useEffect, useRef, useState } from 'react'
import type { FreeformLine, TextAlign, TemplateData } from '@/lib/types'
import { FONT_OPTIONS } from '@/lib/types'
import { imageUrl } from '@/lib/images'

const MAX_LINES = 12

interface Props {
  template: TemplateData
  lines: FreeformLine[]
  setLines: (lines: FreeformLine[]) => void
  disabled?: boolean
}

const NEW_LINE: Omit<FreeformLine, 'id'> = {
  text: 'NEW TEXT',
  x: 0.5,
  y: 0.5,
  w: 0.7,
  fontSize: 0.08,
  color: '#ffffff',
  stroke: '#000000',
  font: 'Impact',
  align: 'center' as TextAlign,
  rotation: 0,
}

/**
 * WYSIWYG meme editor: text lines are rendered directly on the template image
 * (same styling the canvas render uses) and can be dragged, styled, added and
 * removed freely. The player decides how many texts to use and where they go.
 */
export default function FreeformEditor({ template, lines, setLines, disabled = false }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<string | null>(null)
  const [stageH, setStageH] = useState(320)

  // font size is relative to the image height -> track the rendered stage height
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageH(el.clientHeight))
    ro.observe(el)
    setStageH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const update = (id: string, patch: Partial<FreeformLine>) =>
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const onLinePointerDown = (e: React.PointerEvent, id: string) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(id)
    dragRef.current = id
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    update(dragRef.current, { x, y })
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const addLine = () => {
    if (disabled || lines.length >= MAX_LINES) return
    const y = Math.min(0.85, 0.2 + lines.length * 0.13)
    const id = crypto.randomUUID()
    setLines([...lines, { ...NEW_LINE, id, y }])
    setSelectedId(id)
  }

  const removeLine = (id: string) => {
    setLines(lines.filter((l) => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const sliderCls = 'w-full accent-punch'
  const labelCls = 'flex items-center gap-2 text-xs text-dim'

  return (
    <div>
      {/* ---------------------------------------------------------- stage */}
      <div
        ref={stageRef}
        className="relative mx-auto w-full max-w-xl touch-none select-none overflow-hidden rounded-2xl border border-line bg-black shadow-2xl"
        style={{ cursor: disabled ? 'default' : 'crosshair' }}
        onPointerDown={() => setSelectedId(null)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(template.imageKey)} alt={template.name} className="pointer-events-none block w-full" draggable={false} />
        {lines.map((l) => {
          const fs = Math.max(6, l.fontSize * stageH)
          return (
            <div
              key={l.id}
              onPointerDown={(e) => onLinePointerDown(e, l.id)}
              className="absolute break-words px-1 leading-[1.05]"
              style={{
                left: `${l.x * 100}%`,
                top: `${l.y * 100}%`,
                width: `${l.w * 100}%`,
                transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
                fontSize: `${fs}px`,
                fontFamily: `${l.font}, Impact, sans-serif`,
                fontWeight: l.font === 'Impact' ? 900 : 700,
                color: l.color,
                WebkitTextStroke: `${Math.max(1, fs * 0.09)}px ${l.stroke}`,
                paintOrder: 'stroke fill',
                textAlign: l.align,
                cursor: disabled ? 'default' : 'move',
                pointerEvents: disabled ? 'none' : 'auto',
                outline: selectedId === l.id ? '2px dashed rgba(76, 201, 240, 0.95)' : 'none',
                outlineOffset: 3,
              }}
            >
              {l.text || <span className="opacity-40">text…</span>}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-center text-xs text-dim">
        {disabled
          ? 'Locked — your meme is in.'
          : 'Drag texts on the meme · click a card to style · add as many as you like'}
      </p>

      {/* ---------------------------------------------------------- line cards */}
      <div className="mt-3 grid gap-2">
        {lines.map((l, i) => {
          const sel = selectedId === l.id
          return (
            <div
              key={l.id}
              className={`rounded-xl border bg-night2/80 p-2 transition-colors ${
                sel ? 'border-sky' : 'border-line'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-8 w-8 flex-none rounded-lg border border-line bg-card2 text-sm text-dim hover:text-ink"
                  title={sel ? 'Collapse style options' : 'Style this text'}
                  onClick={() => setSelectedId(sel ? null : l.id)}
                >
                  {sel ? '▾' : '🎨'}
                </button>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-line bg-night px-3 py-2 font-semibold"
                  style={{ fontFamily: `${l.font}, Impact, sans-serif` }}
                  value={l.text}
                  maxLength={120}
                  disabled={disabled}
                  placeholder={`Text ${i + 1}…`}
                  onFocus={() => setSelectedId(l.id)}
                  onChange={(e) => update(l.id, { text: e.target.value })}
                />
                <button
                  type="button"
                  className="h-8 w-8 flex-none rounded-lg border border-line bg-card2 text-rose hover:border-rose"
                  title="Remove this text"
                  disabled={disabled}
                  onClick={() => removeLine(l.id)}
                >
                  ✕
                </button>
              </div>

              {sel && !disabled && (
                <div className="mt-3 grid gap-x-5 gap-y-3 border-t border-line pt-3 sm:grid-cols-2">
                  <label className={labelCls}>
                    Size
                    <input
                      type="range" min={0.03} max={0.2} step={0.005}
                      className={sliderCls} value={l.fontSize}
                      onChange={(e) => update(l.id, { fontSize: parseFloat(e.target.value) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Width
                    <input
                      type="range" min={0.1} max={1} step={0.05}
                      className={sliderCls} value={l.w}
                      onChange={(e) => update(l.id, { w: parseFloat(e.target.value) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Angle
                    <input
                      type="range" min={-45} max={45} step={1}
                      className={sliderCls} value={l.rotation}
                      onChange={(e) => update(l.id, { rotation: parseInt(e.target.value, 10) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Font
                    <select
                      className="flex-1 rounded-lg border border-line bg-night px-2 py-1"
                      value={l.font}
                      onChange={(e) => update(l.id, { font: e.target.value })}
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <div className={labelCls}>
                    Align
                    <span className="flex overflow-hidden rounded-lg border border-line">
                      {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                        <button
                          key={a}
                          type="button"
                          className={`flex-1 px-2 py-1 text-xs ${l.align === a ? 'bg-punch text-night font-bold' : 'bg-card2 text-dim'}`}
                          onClick={() => update(l.id, { align: a })}
                        >
                          {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-dim">
                    <label className="flex items-center gap-1">
                      Color <input type="color" className="h-7 w-9 cursor-pointer rounded border border-line bg-night" value={l.color} onChange={(e) => update(l.id, { color: e.target.value })} />
                    </label>
                    <label className="flex items-center gap-1">
                      Outline <input type="color" className="h-7 w-9 cursor-pointer rounded border border-line bg-night" value={l.stroke} onChange={(e) => update(l.id, { stroke: e.target.value })} />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!disabled && (
        <button
          type="button"
          className="mt-3 w-full rounded-xl border-2 border-dashed border-line py-2.5 text-sm font-semibold text-dim transition hover:border-punch hover:text-punch disabled:opacity-40"
          disabled={lines.length >= MAX_LINES}
          onClick={addLine}
        >
          + Add text {lines.length >= MAX_LINES ? `(max ${MAX_LINES})` : `(${lines.length}/${MAX_LINES})`}
        </button>
      )}
    </div>
  )
}
