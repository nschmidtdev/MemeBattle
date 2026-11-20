'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TemplateBox, TemplateData, TextAlign } from '@/lib/types'
import {
  DEFAULT_BOX,
  FONT_OPTIONS,
  LINE_BOUNDS,
  MAX_ID_LENGTH,
  MAX_TEMPLATE_BOXES,
  ROTATION_BOUNDS,
  TEXT_WIDTH_BOUNDS,
} from '@/lib/types'
import { randomId } from '@/lib/client'
import { UPLOAD_ACCEPT } from '@/lib/images'
import MemeView from '@/components/MemeView'

export type AdminTemplate = TemplateData & {
  packId: string
  isActive: boolean
  /** ISO timestamp from the server; absent on older API responses. */
  updatedAt?: string
}

interface Props {
  template: AdminTemplate
  onClose: () => void
  onSaved: () => void
  /** Re-fetches the template after an edit conflict; null if it was deleted. */
  onReload: (id: string) => Promise<AdminTemplate | null>
}

/** Keep new ids inside the template-box API limit. */
const newBoxId = () => randomId().slice(0, MAX_ID_LENGTH)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const num = (v: string, fallback: number) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

export default function TemplateEditor({ template, onClose, onSaved, onReload }: Props) {
  const router = useRouter()
  const [name, setName] = useState(template.name)
  const [imageKey, setImageKey] = useState(template.imageKey)
  const [isFreeform, setIsFreeform] = useState(template.isFreeform)
  const [boxes, setBoxes] = useState<TemplateBox[]>(template.boxes)
  const [isActive, setIsActive] = useState(template.isActive)
  const [updatedAt, setUpdatedAt] = useState<string | undefined>(template.updatedAt)
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const previewTemplate = useMemo(
    () => ({ id: template.id, name, imageKey, isFreeform, boxes: isFreeform ? [] : boxes }),
    [template.id, name, imageKey, isFreeform, boxes],
  )
  const previewSubmission = useMemo(
    () => ({ texts: Object.fromEntries(boxes.map((b) => [b.id, b.defaultText ?? b.id])), lines: [] }),
    [boxes],
  )

  // The editor is an overlay; Escape closes it unless a save is in flight.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [busy, onClose])

  const patchBox = (id: string, patch: Partial<TemplateBox>) =>
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const removeBox = (id: string) => setBoxes((prev) => prev.filter((b) => b.id !== id))

  const addBox = () =>
    setBoxes((prev) => {
      if (prev.length >= MAX_TEMPLATE_BOXES) return prev
      return [
        ...prev,
        {
          ...DEFAULT_BOX,
          id: newBoxId(),
          x: clamp(0.5, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
          y: clamp(0.85, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
          // DEFAULT_BOX.w (0.9) is already inside the server's 0..1 range.
          w: DEFAULT_BOX.w,
          fontSize: clamp(DEFAULT_BOX.fontSize, LINE_BOUNDS.fontSizeMin, LINE_BOUNDS.fontSizeMax),
        },
      ]
    })

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.replace('/admin/login')
        throw new Error('Session expired — please sign in again.')
      }
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setImageKey(data.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setConflict(false)
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
          // Optimistic concurrency: the server rejects the write with 409 if
          // another tab changed the template in the meantime.
          ...(updatedAt ? { updatedAt } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.replace('/admin/login')
        throw new Error('Session expired — please sign in again.')
      }
      if (res.status === 409) {
        setConflict(true)
        setError('This template was changed in another tab. Reload to get the latest version.')
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      if (typeof data.template?.updatedAt === 'string') setUpdatedAt(data.template.updatedAt)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const reload = async () => {
    if (busy || reloading) return
    if (!confirm('Discard your unsaved changes and load the latest version from the server?')) return
    setReloading(true)
    setError(null)
    try {
      const fresh = await onReload(template.id)
      if (!fresh) {
        setError('This template no longer exists. Close the editor and refresh the list.')
        return
      }
      setName(fresh.name)
      setImageKey(fresh.imageKey)
      setIsFreeform(fresh.isFreeform)
      setBoxes(fresh.boxes)
      setIsActive(fresh.isActive)
      setUpdatedAt(fresh.updatedAt)
      setConflict(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reload failed')
    } finally {
      setReloading(false)
    }
  }

  const tooManyBoxes = !isFreeform && boxes.length > MAX_TEMPLATE_BOXES
  const atBoxLimit = boxes.length >= MAX_TEMPLATE_BOXES

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-editor-title"
        tabIndex={-1}
        autoFocus
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-line bg-card shadow-2xl outline-none sm:rounded-2xl"
      >
        {/* Fixed header: title + close stay visible while the body scrolls. */}
        <header className="flex flex-none items-start justify-between gap-3 border-b border-line bg-card2/40 px-4 py-3">
          <div className="min-w-0">
            <h2 id="template-editor-title" className="flex flex-wrap items-center gap-2 text-lg font-bold">
              <span>Edit template</span>
              <span className="badge max-w-full truncate">{template.name}</span>
            </h2>
            <p className="text-xs text-dim">
              {isFreeform ? 'Freeform template' : `Fixed template · ${boxes.length} starting boxes`}
            </p>
          </div>
          <button className="ghost px-2 py-1" onClick={onClose} aria-label="Close template editor">
            ✕ Close
          </button>
        </header>

        {error && (
          <div className="flex-none px-4 pt-3">
            <div className="error-banner mb-0 flex flex-wrap items-start justify-between gap-2" role="alert">
              <span className="min-w-0 flex-1 basis-[220px]">{error}</span>
              {conflict && (
                <button className="ghost shrink-0" onClick={reload} disabled={busy || reloading}>
                  {reloading ? 'Reloading…' : 'Reload latest'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Only this region scrolls inside the viewport-capped dialog. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <div className="grid gap-5 lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)] lg:items-start">
            <div className="min-w-0">
              <p className="muted mb-1">Preview</p>
              <div className="meme-canvas-wrap">
                <MemeView template={previewTemplate} submission={previewSubmission} maxDim={300} />
              </div>

              <div className="mt-2.5 grid gap-2">
                <label className="muted">
                  Name
                  <input
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full"
                  />
                </label>
                <label className="muted">
                  Image
                  <input
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) upload(f)
                      e.target.value = ''
                    }}
                    className="mt-1 w-full"
                  />
                </label>
                {uploading && <p className="muted">Uploading…</p>}
                <label className="checkbox-row">
                  <input type="checkbox" checked={isFreeform} onChange={(e) => setIsFreeform(e.target.checked)} />
                  <span>
                    Freeform (players start with an empty meme){' '}
                    {!isFreeform && (
                      <em>
                        — note: boxes below are only starting positions now; players can move, restyle, delete and add
                        texts freely
                      </em>
                    )}
                  </span>
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>Active (available in game)</span>
                </label>
              </div>
            </div>

            <div className="min-w-0">
              <p className="muted">
                Text boxes{' '}
                {isFreeform ? '— disabled for freeform templates' : `(${boxes.length}/${MAX_TEMPLATE_BOXES})`}
              </p>
              {isFreeform ? (
                <p className="muted">Players can place as many text lines on the image as they want.</p>
              ) : (
                <>
                  <div className="grid gap-2">
                    {boxes.map((b, i) => (
                      <div key={b.id} className="panel mb-0 p-2.5">
                        <div className="row spread">
                          <strong>Box {i + 1}</strong>
                          <button className="danger" onClick={() => removeBox(b.id)}>
                            Remove
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-end gap-x-2.5 gap-y-2">
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
                            X{' '}
                            <Num
                              value={b.x}
                              min={LINE_BOUNDS.xMin}
                              max={LINE_BOUNDS.xMax}
                              onChange={(v) => patchBox(b.id, { x: v })}
                            />
                          </label>
                          <label className="muted">
                            Y{' '}
                            <Num
                              value={b.y}
                              min={LINE_BOUNDS.yMin}
                              max={LINE_BOUNDS.yMax}
                              onChange={(v) => patchBox(b.id, { y: v })}
                            />
                          </label>
                          <label className="muted">
                            Width{' '}
                            <Num
                              value={b.w}
                              min={TEXT_WIDTH_BOUNDS.min}
                              max={TEXT_WIDTH_BOUNDS.max}
                              step={0.05}
                              onChange={(v) => patchBox(b.id, { w: v })}
                            />
                          </label>
                          <label className="muted">
                            Size{' '}
                            <Num
                              value={b.fontSize}
                              min={LINE_BOUNDS.fontSizeMin}
                              max={LINE_BOUNDS.fontSizeMax}
                              step={0.005}
                              onChange={(v) => patchBox(b.id, { fontSize: v })}
                            />
                          </label>
                          <label className="muted">
                            Rotation{' '}
                            <Num
                              value={b.rotation}
                              min={ROTATION_BOUNDS.min}
                              max={ROTATION_BOUNDS.max}
                              step={1}
                              onChange={(v) => patchBox(b.id, { rotation: v })}
                            />
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
                            Color{' '}
                            <input
                              type="color"
                              value={b.color}
                              onChange={(e) => patchBox(b.id, { color: e.target.value })}
                            />
                          </label>
                          <label className="muted">
                            Outline{' '}
                            <input
                              type="color"
                              value={b.stroke}
                              onChange={(e) => patchBox(b.id, { stroke: e.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button className="ghost" disabled={atBoxLimit} onClick={addBox}>
                      + Add box
                    </button>
                    <span className="muted">
                      {boxes.length}/{MAX_TEMPLATE_BOXES} boxes{atBoxLimit ? ' — maximum reached' : ''}
                    </span>
                  </div>
                  {tooManyBoxes && (
                    <p className="muted">
                      This template has more than {MAX_TEMPLATE_BOXES} boxes. Remove{' '}
                      {boxes.length - MAX_TEMPLATE_BOXES} before saving; the API accepts at most {MAX_TEMPLATE_BOXES}.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Fixed footer: save stays reachable no matter how many boxes exist. */}
        <footer className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-line bg-card2/50 px-4 py-3">
          <span className="text-xs text-dim" aria-live="polite">
            {isFreeform ? 'Freeform template' : `${boxes.length}/${MAX_TEMPLATE_BOXES} boxes`}
            {uploading ? ' · uploading image…' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || uploading || reloading || tooManyBoxes}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Numeric input clamped to the same bounds the API validates against. */
function Num({
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(clamp(num(e.target.value, value), min, max))}
      style={{ width: 64 }}
    />
  )
}
