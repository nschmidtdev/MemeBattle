'use client'

import { useRef, useState } from 'react'
import type { FreeformLine, TextAlign, TemplateData } from '@/lib/types'
import { FONT_OPTIONS } from '@/lib/types'
import { imageUrl } from '@/lib/images'

interface Props {
  template: TemplateData
  lines: FreeformLine[]
  setLines: (lines: FreeformLine[]) => void
}

const NEW_LINE: Omit<FreeformLine, 'id'> = {
  text: 'NEW TEXT',
  x: 0.5,
  y: 0.5,
  w: 0.6,
  fontSize: 0.07,
  color: '#ffffff',
  stroke: '#000000',
  font: 'Impact',
  align: 'center',
  rotation: 0,
}

export default function FreeformEditor({ template, lines, setLines }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<string | null>(null)

  const relPoint = (e: React.PointerEvent) => {
    const rect = stageRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  const update = (id: string, patch: Partial<FreeformLine>) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = relPoint(e)
    let best: string | null = null
    let bestD = Infinity
    for (const l of lines) {
      const d = Math.max(Math.abs(p.x - l.x), Math.abs(p.y - l.y))
      const threshold = Math.max(0.04, l.fontSize * 1.2, l.w * 0.2)
      if (d < threshold && d < bestD) {
        bestD = d
        best = l.id
      }
    }
    if (best) {
      setSelectedId(best)
      dragRef.current = best
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } else {
      setSelectedId(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const p = relPoint(e)
    update(dragRef.current, {
      x: Math.min(1, Math.max(0, p.x)),
      y: Math.min(1, Math.max(0, p.y)),
    })
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const selected = lines.find((l) => l.id === selectedId) ?? null

  return (
    <div>
      <div
        ref={stageRef}
        style={{ position: 'relative', maxWidth: 420, margin: '0 auto', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img src={imageUrl(template.imageKey)} alt="" style={{ display: 'block', width: '100%', borderRadius: 8 }} />
        {selected && (
          <div
            style={{
              position: 'absolute',
              left: `${(selected.x - selected.w / 2) * 100}%`,
              top: `${(selected.y - selected.fontSize / 2) * 100}%`,
              width: `${selected.w * 100}%`,
              height: `${selected.fontSize * 100}%`,
              border: '2px dashed rgba(0, 191, 255, 0.9)',
              borderRadius: 4,
              pointerEvents: 'none',
              transform: `rotate(${selected.rotation}deg)`,
            }}
          />
        )}
      </div>
      <p className="freeform-hint">Click the image to select a line, drag to move it.</p>

      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {lines.map((l) => (
          <div key={l.id} className={`panel${l.id === selectedId ? ' live' : ''}`} style={{ padding: 10 }}>
            <div className="row spread">
              <input
                value={l.text}
                maxLength={80}
                onChange={(e) => update(l.id, { text: e.target.value })}
                style={{ flex: 1 }}
                placeholder="Line text"
              />
              <button className="ghost" onClick={() => { setLines(lines.filter((x) => x.id !== l.id)); if (selectedId === l.id) setSelectedId(null) }}>
                ✕
              </button>
            </div>
            <div className="row" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              <label className="muted">
                Size{' '}
                <input
                  type="range"
                  min={0.03}
                  max={0.2}
                  step={0.005}
                  value={l.fontSize}
                  onChange={(e) => update(l.id, { fontSize: parseFloat(e.target.value) })}
                />
              </label>
              <label className="muted">
                Width{' '}
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={l.w}
                  onChange={(e) => update(l.id, { w: parseFloat(e.target.value) })}
                />
              </label>
              <label className="muted">
                Angle{' '}
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={1}
                  value={l.rotation}
                  onChange={(e) => update(l.id, { rotation: parseInt(e.target.value, 10) })}
                />
              </label>
              <label className="muted">
                Font{' '}
                <select value={l.font} onChange={(e) => update(l.id, { font: e.target.value })}>
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="muted">
                Align{' '}
                <select value={l.align} onChange={(e) => update(l.id, { align: e.target.value as TextAlign })}>
                  <option value="left">left</option>
                  <option value="center">center</option>
                  <option value="right">right</option>
                </select>
              </label>
              <label className="muted">
                Color{' '}
                <input type="color" value={l.color} onChange={(e) => update(l.id, { color: e.target.value })} />
              </label>
              <label className="muted">
                Outline{' '}
                <input type="color" value={l.stroke} onChange={(e) => update(l.id, { stroke: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" onClick={() => setLines([...lines, { ...NEW_LINE, id: crypto.randomUUID() }])}>
          + Add line
        </button>
      </div>
    </div>
  )
}
