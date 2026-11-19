'use client'

import { useEffect, useRef, useState } from 'react'
import type { FreeformLine, TextAlign, TemplateData } from '@/lib/types'
import {
  FONT_OPTIONS,
  LINE_BOUNDS,
  MAX_LINES,
  MAX_TEXT_LEN,
  ROTATION_BOUNDS,
  TEXT_WIDTH_BOUNDS,
} from '@/lib/types'
import { imageUrl } from '@/lib/images'
import { clampFreeformLine, memeFontFamily, memeFontWeight } from '@/lib/meme'
import { randomId } from '@/lib/client'

interface Props {
  template: TemplateData
  lines: FreeformLine[]
  setLines: (lines: FreeformLine[]) => void
  disabled?: boolean
}

const NEW_LINE: Omit<FreeformLine, 'id'> = {
  text: '',
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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * WYSIWYG meme editor: text lines are rendered directly on the template image
 * (same font stack, weight, wrapping and line height the canvas render uses)
 * and can be dragged, styled, added and removed freely.
 */
export default function FreeformEditor({ template, lines, setLines, disabled = false }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastDeleted, setLastDeleted] = useState<{ line: FreeformLine; index: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
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

  // A new (re)rolled template: drop selection + undo history, but keep the
  // actual lines — CaptionView decides whether texts survive a reroll.
  useEffect(() => {
    setSelectedId(null)
    setLastDeleted(null)
  }, [template.id, template.imageKey])

  // Read-only (submitted): hide the editing outline and undo affordance.
  useEffect(() => {
    if (!disabled) return
    setSelectedId(null)
    setLastDeleted(null)
  }, [disabled])

  const update = (id: string, patch: Partial<FreeformLine>) =>
    setLines(lines.map((l) => (l.id === id ? clampFreeformLine({ ...l, ...patch }) : l)))

  // Arrow keys nudge the selected line even when focus is on a toolbar button
  // (text inputs/selects keep their normal arrow-key behaviour).
  useEffect(() => {
    if (disabled || !selectedId) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      const step = e.shiftKey ? 0.05 : 0.01
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      const line = lines.find((l) => l.id === selectedId)
      if (!line) return
      e.preventDefault()
      setLines(
        lines.map((l) =>
          l.id === selectedId
            ? clampFreeformLine({
                ...l,
                x: clamp(line.x + dx, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
                y: clamp(line.y + dy, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
              })
            : l,
        ),
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled, selectedId, lines, setLines])

  /** Pointer position in relative image coordinates (border excluded). */
  const stagePoint = (clientX: number, clientY: number) => {
    const el = stageRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const width = el.clientWidth
    const height = el.clientHeight
    if (!width || !height) return null
    return {
      x: (clientX - rect.left - el.clientLeft) / width,
      y: (clientY - rect.top - el.clientTop) / height,
    }
  }

  const onLinePointerDown = (e: React.PointerEvent, line: FreeformLine) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(line.id)
    const el = e.currentTarget as HTMLElement
    el.focus({ preventScroll: true })
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // Older browsers: dragging still works via the stage pointermove.
    }
    const point = stagePoint(e.clientX, e.clientY)
    dragRef.current = point
      ? { id: line.id, dx: point.x - line.x, dy: point.y - line.y }
      : { id: line.id, dx: 0, dy: 0 }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const point = stagePoint(e.clientX, e.clientY)
    if (!point) return
    update(drag.id, {
      x: clamp(point.x - drag.dx, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
      y: clamp(point.y - drag.dy, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
    })
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const addLine = () => {
    if (disabled || lines.length >= MAX_LINES) return
    const y = clamp(0.2 + lines.length * 0.13, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax)
    const line = clampFreeformLine({ ...NEW_LINE, id: randomId(), y })
    setLines([...lines, line])
    setSelectedId(line.id)
    setLastDeleted(null)
  }

  const removeLine = (id: string) => {
    if (disabled) return
    const index = lines.findIndex((l) => l.id === id)
    if (index < 0) return
    setLastDeleted({ line: lines[index], index })
    setLines(lines.filter((l) => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const undoDelete = () => {
    if (!lastDeleted || disabled || lines.length >= MAX_LINES) return
    const next = [...lines]
    next.splice(Math.min(lastDeleted.index, next.length), 0, lastDeleted.line)
    setLines(next)
    setSelectedId(lastDeleted.line.id)
    setLastDeleted(null)
  }

  const onLineKeyDown = (e: React.KeyboardEvent, line: FreeformLine) => {
    if (disabled) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeLine(line.id)
      return
    }
    const step = e.shiftKey ? 0.05 : 0.01
    let dx = 0
    let dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    else return
    e.preventDefault()
    e.stopPropagation()
    update(line.id, {
      x: clamp(line.x + dx, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
      y: clamp(line.y + dy, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
    })
  }

  const sliderCls = 'w-full accent-punch'
  const labelCls = 'flex min-h-11 items-center gap-2 text-xs text-dim'

  return (
    <div>
      {/* ---------------------------------------------------------- stage */}
      <div
        ref={stageRef}
        className="relative mx-auto w-full max-w-xl select-none overflow-hidden rounded-2xl border border-line bg-black shadow-2xl"
        style={{ cursor: disabled ? 'default' : 'crosshair' }}
        onPointerDown={() => {
          if (!disabled) setSelectedId(null)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(template.imageKey)} alt={template.name} className="pointer-events-none block w-full" draggable={false} />
        {lines.map((l) => {
          const fs = Math.max(4, l.fontSize * stageH)
          const selected = selectedId === l.id
          return (
            <div
              key={l.id}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`Text ${l.text || '(empty)'}`}
              aria-pressed={selected}
              onPointerDown={(e) => onLinePointerDown(e, l)}
              onKeyDown={(e) => onLineKeyDown(e, l)}
              onFocus={() => {
                if (!disabled) setSelectedId(l.id)
              }}
              className="absolute touch-none"
              style={{
                left: `${l.x * 100}%`,
                top: `${l.y * 100}%`,
                width: `${l.w * 100}%`,
                transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
                fontSize: `${fs}px`,
                fontFamily: memeFontFamily(l.font),
                fontWeight: memeFontWeight(l.font),
                lineHeight: 1.05,
                color: l.color,
                WebkitTextStroke: `${Math.max(1, fs * 0.09)}px ${l.stroke}`,
                paintOrder: 'stroke fill',
                textAlign: l.align,
                whiteSpace: 'pre-line',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                padding: 0,
                cursor: disabled ? 'default' : 'move',
                pointerEvents: disabled ? 'none' : 'auto',
                outline: selected ? '2px dashed rgba(76, 201, 240, 0.95)' : 'none',
                outlineOffset: 3,
                userSelect: 'none',
              }}
            >
              {l.text.trim() ? (
                l.text
              ) : (
                <span style={{ WebkitTextStroke: '0px', opacity: 0.45, fontWeight: 700 }}>+ text</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-center text-xs text-dim">
        {disabled
          ? 'Locked — your meme is in.'
          : 'Drag texts on the meme · click a card to style · arrow keys nudge the selected text'}
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
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-line bg-card2 text-sm text-dim hover:text-ink"
                  title={sel ? 'Collapse style options' : 'Style this text'}
                  aria-label={sel ? 'Collapse style options' : 'Style this text'}
                  disabled={disabled}
                  onClick={() => setSelectedId(sel ? null : l.id)}
                >
                  {sel ? '▾' : '🎨'}
                </button>
                <input
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-night px-3 py-2 text-base font-semibold"
                  style={{ fontFamily: memeFontFamily(l.font), fontWeight: memeFontWeight(l.font) }}
                  value={l.text}
                  maxLength={MAX_TEXT_LEN}
                  disabled={disabled}
                  placeholder={`Text ${i + 1}…`}
                  onFocus={() => setSelectedId(l.id)}
                  onChange={(e) => update(l.id, { text: e.target.value })}
                />
                <span className="w-11 flex-none text-right text-[11px] tabular-nums text-dim" aria-hidden>
                  {l.text.length}/{MAX_TEXT_LEN}
                </span>
                <button
                  type="button"
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-line bg-card2 text-rose hover:border-rose"
                  title="Remove this text"
                  aria-label="Remove this text"
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
                      type="range"
                      min={LINE_BOUNDS.fontSizeMin}
                      max={LINE_BOUNDS.fontSizeMax}
                      step={0.005}
                      className={sliderCls}
                      value={l.fontSize}
                      onChange={(e) => update(l.id, { fontSize: parseFloat(e.target.value) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Width
                    <input
                      type="range"
                      min={TEXT_WIDTH_BOUNDS.min}
                      max={TEXT_WIDTH_BOUNDS.max}
                      step={0.05}
                      className={sliderCls}
                      value={l.w}
                      onChange={(e) => update(l.id, { w: parseFloat(e.target.value) })}
                    />
                  </label>
                  <label className={labelCls}>
                    X
                    <input
                      type="range"
                      min={LINE_BOUNDS.xMin}
                      max={LINE_BOUNDS.xMax}
                      step={0.01}
                      className={sliderCls}
                      value={l.x}
                      onChange={(e) => update(l.id, { x: parseFloat(e.target.value) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Y
                    <input
                      type="range"
                      min={LINE_BOUNDS.yMin}
                      max={LINE_BOUNDS.yMax}
                      step={0.01}
                      className={sliderCls}
                      value={l.y}
                      onChange={(e) => update(l.id, { y: parseFloat(e.target.value) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Angle
                    <input
                      type="range"
                      min={ROTATION_BOUNDS.min}
                      max={ROTATION_BOUNDS.max}
                      step={1}
                      className={sliderCls}
                      value={l.rotation}
                      onChange={(e) => update(l.id, { rotation: parseInt(e.target.value, 10) })}
                    />
                  </label>
                  <label className={labelCls}>
                    Font
                    <select
                      className="min-h-11 flex-1 rounded-lg border border-line bg-night px-2 py-1 text-base"
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
                          aria-label={`Align ${a}`}
                          className={`min-h-11 min-w-11 flex-1 px-3 text-xs ${l.align === a ? 'bg-punch font-bold text-night' : 'bg-card2 text-dim'}`}
                          onClick={() => update(l.id, { align: a })}
                        >
                          {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="flex min-h-11 items-center gap-4 text-xs text-dim">
                    <label className="flex min-h-11 items-center gap-1">
                      Color
                      <input
                        type="color"
                        className="h-11 w-11 cursor-pointer rounded border border-line bg-night"
                        value={l.color}
                        onChange={(e) => update(l.id, { color: e.target.value })}
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-1">
                      Outline
                      <input
                        type="color"
                        className="h-11 w-11 cursor-pointer rounded border border-line bg-night"
                        value={l.stroke}
                        onChange={(e) => update(l.id, { stroke: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {lastDeleted && !disabled && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-line bg-night2 px-3 py-1 text-xs text-dim">
          <span>Text removed.</span>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-line px-3 text-xs font-bold text-sky hover:border-sky"
            onClick={undoDelete}
          >
            Undo
          </button>
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          className="mt-3 w-full rounded-xl border-2 border-dashed border-line py-3 text-sm font-semibold text-dim transition hover:border-punch hover:text-punch disabled:opacity-40"
          disabled={lines.length >= MAX_LINES}
          onClick={addLine}
        >
          + Add text {lines.length >= MAX_LINES ? `(max ${MAX_LINES})` : `(${lines.length}/${MAX_LINES})`}
        </button>
      )}
    </div>
  )
}
