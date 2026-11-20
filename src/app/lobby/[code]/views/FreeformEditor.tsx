'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FreeformLine, MemePadding, TextAlign, TemplateData } from '@/lib/types'
import {
  FONT_OPTIONS,
  LINE_BOUNDS,
  MAX_LINES,
  MAX_TEXT_LEN,
  ROTATION_BOUNDS,
  TEXT_WIDTH_BOUNDS,
} from '@/lib/types'
import { imageUrl } from '@/lib/images'
import {
  MAX_MEME_PAD_RATIO,
  MEME_TEXT_BOX_PAD_RATIO,
  clampFreeformLine,
  isLightTextColor,
  memeFontFamily,
  memeFontWeight,
  resizeFreeformLine,
  type MemeResizeHandle,
} from '@/lib/meme'
import { randomId } from '@/lib/client'

/**
 * Text input that grows with its content and on focus. Enter inserts a hard
 * line break, which the meme renderer already honours.
 */
function GrowingTextarea({
  value,
  onChange,
  maxLength,
  disabled,
  placeholder,
  onFocus,
  style,
}: {
  value: string
  onChange: (value: string) => void
  maxLength: number
  disabled: boolean
  placeholder: string
  onFocus: () => void
  style: CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={2}
      className="min-h-11 w-full resize-none overflow-hidden rounded-lg border border-line bg-night px-3 py-2 text-base font-semibold leading-snug focus:min-h-24"
      style={style}
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

interface Props {
  template: TemplateData
  lines: FreeformLine[]
  setLines: (lines: FreeformLine[]) => void
  disabled?: boolean
  padding: MemePadding
  onPaddingChange: (padding: MemePadding) => void
  /** Per-round text cap (e.g. 40 in Chaos "short text"). */
  maxTextLen?: number
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

type ResizeHandle = MemeResizeHandle

/** Eight Windows-style handles around the selected text block. */
const RESIZE_HANDLES: Array<{
  id: ResizeHandle
  left: string
  top: string
  cursor: string
}> = [
  { id: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { id: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { id: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { id: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { id: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { id: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { id: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { id: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
]

interface ResizeState {
  id: string
  handle: ResizeHandle
  pointerX: number
  pointerY: number
  line: Pick<FreeformLine, 'x' | 'y' | 'w' | 'fontSize' | 'rotation'>
  stageW: number
  stageH: number
}

/**
 * WYSIWYG meme editor: text lines are rendered directly on the template image
 * (same font stack, weight, wrapping and line height the canvas render uses)
 * and can be dragged, styled, added and removed freely.
 */
export default function FreeformEditor({
  template,
  lines,
  setLines,
  disabled = false,
  padding,
  onPaddingChange,
  maxTextLen = MAX_TEXT_LEN,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastDeleted, setLastDeleted] = useState<{ line: FreeformLine; index: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const [stageH, setStageH] = useState(320)
  const [imageSize, setImageSize] = useState<{ key: string; width: number; height: number } | null>(null)

  // Natural image size drives the stage aspect ratio (bar heights are relative
  // to the image height). Fallback 4:3 until the image has loaded.
  const natural = imageSize && imageSize.key === template.imageKey ? imageSize : null
  const imageW = natural?.width ?? 4
  const imageH = natural?.height ?? 3
  const padTopRatio = clamp(padding.top, 0, MAX_MEME_PAD_RATIO)
  const padBottomRatio = clamp(padding.bottom, 0, MAX_MEME_PAD_RATIO)
  const totalRatio = 1 + padTopRatio + padBottomRatio

  // Font size is relative to the full canvas height (image + bars) -> track the stage height.
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

  // Switching the white box on must keep the text readable: very light text
  // flips to dark. Switching it off leaves the colour untouched.
  const setWhiteBackground = (line: FreeformLine, enabled: boolean) => {
    const patch: Partial<FreeformLine> = { whiteBackground: enabled }
    if (enabled && isLightTextColor(line.color)) patch.color = '#111111'
    update(line.id, patch)
  }

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const ok = img.naturalWidth > 0 && img.naturalHeight > 0
    setImageSize({
      key: template.imageKey,
      width: ok ? img.naturalWidth : 4,
      height: ok ? img.naturalHeight : 3,
    })
  }

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
    const resize = resizeRef.current
    if (resize) {
      const dx = (e.clientX - resize.pointerX) / resize.stageW
      const dy = (e.clientY - resize.pointerY) / resize.stageH
      update(resize.id, resizeFreeformLine(resize.line, resize.handle, dx, dy))
      return
    }

    const drag = dragRef.current
    if (!drag) return
    const point = stagePoint(e.clientX, e.clientY)
    if (!point) return
    update(drag.id, {
      x: clamp(point.x - drag.dx, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
      y: clamp(point.y - drag.dy, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
    })
  }

  const onResizePointerDown = (
    e: React.PointerEvent,
    line: FreeformLine,
    handle: ResizeHandle,
  ) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(line.id)
    const el = stageRef.current
    if (!el) return
    const stageW = el.clientWidth
    const stageH = el.clientHeight
    if (!stageW || !stageH) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Older browsers: stage pointermove still handles the drag.
    }
    resizeRef.current = {
      id: line.id,
      handle,
      pointerX: e.clientX,
      pointerY: e.clientY,
      line: {
        x: line.x,
        y: line.y,
        w: line.w,
        fontSize: line.fontSize,
        rotation: line.rotation,
      },
      stageW,
      stageH,
    }
  }

  const endDrag = () => {
    dragRef.current = null
    resizeRef.current = null
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <div className="min-w-0 lg:sticky lg:top-4">
      {/* ---------------------------------------------------------- stage */}
      <div
        ref={stageRef}
        className="relative mx-auto w-full max-w-2xl select-none overflow-hidden rounded-2xl border border-line bg-black shadow-2xl"
        style={{
          aspectRatio: `${imageW} / ${imageH * totalRatio}`,
          // Keep the whole meme above the fold on landscape laptops; the
          // height budget accounts for the header, hint and page padding.
          maxWidth: `min(42rem, calc((100dvh - 10rem) * ${imageW / (imageH * totalRatio)}))`,
          cursor: disabled ? 'default' : 'crosshair',
        }}
        onPointerDown={() => {
          if (!disabled) setSelectedId(null)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {padTopRatio > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 bg-white"
            style={{ height: `${(padTopRatio / totalRatio) * 100}%` }}
          />
        )}
        {padBottomRatio > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-white"
            style={{ height: `${(padBottomRatio / totalRatio) * 100}%` }}
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(template.imageKey, 1200)}
          alt={template.name}
          className="pointer-events-none absolute left-0 w-full"
          style={{ top: `${(padTopRatio / totalRatio) * 100}%`, height: `${(1 / totalRatio) * 100}%` }}
          draggable={false}
          onLoad={onImageLoad}
        />
        {lines.map((l) => {
          const fs = Math.max(4, l.fontSize * stageH)
          const selected = selectedId === l.id
          const showWhite = l.whiteBackground === true && l.text.trim() !== ''
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
                backgroundColor: showWhite ? '#ffffff' : undefined,
                paddingTop: showWhite ? fs * MEME_TEXT_BOX_PAD_RATIO : 0,
                paddingBottom: showWhite ? fs * MEME_TEXT_BOX_PAD_RATIO : 0,
                paddingLeft: 0,
                paddingRight: 0,
                WebkitTextStroke: `${Math.max(1, fs * 0.09)}px ${l.stroke}`,
                paintOrder: 'stroke fill',
                textAlign: l.align,
                whiteSpace: 'pre-line',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
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
              {selected && !disabled && (
                <>
                  {RESIZE_HANDLES.map((h) => (
                    <span
                      key={h.id}
                      aria-hidden
                      onPointerDown={(e) => onResizePointerDown(e, l, h.id)}
                      className="absolute z-20 flex h-7 w-7 touch-none items-center justify-center"
                      style={{
                        left: h.left,
                        top: h.top,
                        transform: 'translate(-50%, -50%)',
                        cursor: h.cursor,
                      }}
                    >
                      <span className="h-2.5 w-2.5 rounded-sm border border-sky bg-night shadow" />
                    </span>
                  ))}
                </>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-center text-xs text-dim">
        {disabled
          ? 'Locked — your meme is in.'
          : 'Drag texts · resize with the corner/edge handles · arrow keys nudge the selected text'}
      </p>

      </div>

      {/* ---------------------------------------------------------- controls */}
      <div className="grid min-w-0 gap-2 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
      {/* ------------------------------------------------------ whitespace */}
      <div className="rounded-xl border border-line bg-night2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-dim">
            Canvas whitespace
            <span className="ml-2 font-normal">0–100% of the image height per side</span>
          </span>
          {(padTopRatio > 0 || padBottomRatio > 0) && (
            <button
              type="button"
              className="text-xs font-semibold text-dim underline hover:text-ink disabled:opacity-40"
              disabled={disabled}
              onClick={() => onPaddingChange({ top: 0, bottom: 0 })}
            >
              Clear
            </button>
          )}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-dim">
            <span className="w-12 font-semibold">Top</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(padTopRatio * 100)}
              disabled={disabled}
              aria-valuetext={`${Math.round(padTopRatio * 100)} percent of the image height`}
              className="min-w-0 flex-1 accent-punch disabled:opacity-40"
              onChange={(event) =>
                onPaddingChange({ ...padding, top: Number(event.target.value) / 100 })
              }
            />
            <span className="w-9 text-right tabular-nums">{Math.round(padTopRatio * 100)}%</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-dim">
            <span className="w-12 font-semibold">Bottom</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(padBottomRatio * 100)}
              disabled={disabled}
              aria-valuetext={`${Math.round(padBottomRatio * 100)} percent of the image height`}
              className="min-w-0 flex-1 accent-punch disabled:opacity-40"
              onChange={(event) =>
                onPaddingChange({ ...padding, bottom: Number(event.target.value) / 100 })
              }
            />
            <span className="w-9 text-right tabular-nums">{Math.round(padBottomRatio * 100)}%</span>
          </label>
        </div>
      </div>

      {/* ---------------------------------------------------------- line cards */}
      <div className="grid gap-2">
        {lines.map((l, i) => {
          const sel = selectedId === l.id
          return (
            <div
              key={l.id}
              className={`overflow-hidden rounded-xl border bg-night2/80 p-2 transition-colors ${
                sel ? 'border-sky' : 'border-line'
              }`}
            >
              <div className="flex items-start gap-2">
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
                <div className="min-w-0 flex-1">
                  <GrowingTextarea
                    value={l.text}
                    onChange={(text) => update(l.id, { text })}
                    maxLength={maxTextLen}
                    disabled={disabled}
                    placeholder={`Text ${i + 1}…`}
                    onFocus={() => setSelectedId(l.id)}
                    style={{ fontFamily: memeFontFamily(l.font), fontWeight: memeFontWeight(l.font) }}
                  />
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <span className="text-right text-[11px] tabular-nums text-dim" aria-hidden>
                      {l.text.length}/{maxTextLen}
                    </span>
                    <button
                      type="button"
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line bg-card2 text-sm text-rose hover:border-rose"
                      title="Remove this text"
                      aria-label="Remove this text"
                      disabled={disabled}
                      onClick={() => removeLine(l.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
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
                  <label className={labelCls}>
                    <input
                      type="checkbox"
                      className="h-5 w-5 flex-none accent-punch"
                      checked={l.whiteBackground === true}
                      onChange={(e) => setWhiteBackground(l, e.target.checked)}
                    />
                    White text box
                  </label>
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
          className="mt-1 w-full rounded-xl border-2 border-dashed border-line py-3 text-sm font-semibold text-dim transition hover:border-punch hover:text-punch disabled:opacity-40"
          disabled={lines.length >= MAX_LINES}
          onClick={addLine}
        >
          + Add text {lines.length >= MAX_LINES ? `(max ${MAX_LINES})` : `(${lines.length}/${MAX_LINES})`}
        </button>
      )}
      </div>
    </div>
  )
}
