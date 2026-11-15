'use client'

import { useMemo, useState } from 'react'
import type { TemplateBox, TextAlign } from '@/lib/types'
import { DEFAULT_BOX, FONT_OPTIONS } from '@/lib/types'
import { imageUrl } from '@/lib/images'
import MemeView from '@/components/MemeView'

export interface AdminTemplate {
  id: string
  packId: string
  name: string
  imageKey: string
  isFreeform: boolean
  boxes: TemplateBox[]
  isActive: boolean
}

interface Props {
  template: AdminTemplate
  onClose: () => void
  onSaved: () => void
}

const num = (v: string, fallback: number) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

export default function TemplateEditor({ template, onClose, onSaved }: Props) {
  const [name, setName] = useState(template.name)
  const [imageKey, setImageKey] = useState(template.imageKey)
  const [isFreeform, setIsFreeform] = useState(template.isFreeform)
  const [boxes, setBoxes] = useState<TemplateBox[]>(template.boxes)
  const [isActive, setIsActive] = useState(template.isActive)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewTemplate = useMemo(
    () => ({ id: template.id, name, imageKey, isFreeform, boxes: isFreeform ? [] : boxes }),
    [template.id, name, imageKey, isFreeform, boxes],
  )
  const previewSubmission = useMemo(
    () => ({ texts: Object.fromEntries(boxes.map((b) => [b.id, b.defaultText ?? b.id])), lines: [] }),
    [boxes],
  )

  const patchBox = (id: string, patch: Partial<TemplateBox>) =>
    setBoxes(boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setImageKey(data.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          imageKey,
          isFreeform,
          boxes: isFreeform ? [] : boxes,
          isActive,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <h3 className="row spread">
        <span>Edit template</span>
        <button className="ghost" onClick={onClose}>
          ✕ Close
        </button>
      </h3>

      {error && <div className="error-banner">{error}</div>}

      <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 1 300px', minWidth: 260 }}>
          <p className="muted">Preview</p>
          <div className="meme-canvas-wrap">
            <MemeView template={previewTemplate} submission={previewSubmission} maxDim={300} />
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <label className="muted">
              Name
              <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="muted">
              Image
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload(f)
                  e.target.value = ''
                }}
              />
            </label>
            {uploading && <p className="muted">Uploading…</p>}
            <label className="checkbox-row">
              <input type="checkbox" checked={isFreeform} onChange={(e) => setIsFreeform(e.target.checked)} />
              <span>Freeform (no fixed boxes — players place their own lines)</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>Active (available in game)</span>
            </label>
          </div>
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 320 }}>
          <p className="muted">
            Text boxes {isFreeform ? '— disabled for freeform templates' : ''}
          </p>
          {isFreeform ? (
            <p className="muted">Players can place as many text lines on the image as they want.</p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {boxes.map((b, i) => (
                  <div key={b.id} className="panel" style={{ padding: 10 }}>
                    <div className="row spread">
                      <strong>Box {i + 1}</strong>
                      <button
                        className="danger"
                        onClick={() => setBoxes(boxes.filter((x) => x.id !== b.id))}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <label className="muted">
                        Label{' '}
                        <input
                          value={b.defaultText ?? ''}
                          maxLength={60}
                          onChange={(e) => patchBox(b.id, { defaultText: e.target.value })}
                          style={{ width: 140 }}
                        />
                      </label>
                      <label className="muted">
                        X <Num value={b.x} onChange={(v) => patchBox(b.id, { x: v })} />
                      </label>
                      <label className="muted">
                        Y <Num value={b.y} onChange={(v) => patchBox(b.id, { y: v })} />
                      </label>
                      <label className="muted">
                        Width <Num value={b.w} onChange={(v) => patchBox(b.id, { w: v })} />
                      </label>
                      <label className="muted">
                        Size <Num value={b.fontSize} onChange={(v) => patchBox(b.id, { fontSize: v })} />
                      </label>
                      <label className="muted">
                        Align{' '}
                        <select
                          value={b.align}
                          onChange={(e) => patchBox(b.id, { align: e.target.value as TextAlign })}
                        >
                          <option value="left">left</option>
                          <option value="center">center</option>
                          <option value="right">right</option>
                        </select>
                      </label>
                      <label className="muted">
                        Font{' '}
                        <select value={b.font} onChange={(e) => patchBox(b.id, { font: e.target.value })}>
                          {FONT_OPTIONS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="muted">
                        Color <input type="color" value={b.color} onChange={(e) => patchBox(b.id, { color: e.target.value })} />
                      </label>
                      <label className="muted">
                        Outline <input type="color" value={b.stroke} onChange={(e) => patchBox(b.id, { stroke: e.target.value })} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="ghost"
                  onClick={() =>
                    setBoxes([...boxes, { ...DEFAULT_BOX, id: crypto.randomUUID(), x: 0.5, y: 0.85 }])
                  }
                >
                  + Add box
                </button>
              </div>
            </>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      step={0.05}
      min={0}
      max={1}
      value={value}
      onChange={(e) => onChange(num(e.target.value, value))}
      style={{ width: 64 }}
    />
  )
}
