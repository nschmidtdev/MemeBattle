'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MAX_TEMPLATE_NAME_LENGTH,
  slugify,
  templateNameKey,
  uniqueTemplateName,
  type SourceItem,
} from '@/lib/memeSources'

const TITLE_ID = 'imgflip-pack-creator-title'
const MIN_IMAGE_BYTES = 1024
/** Mirrors MAX_UPLOAD_BYTES in src/lib/storage.ts (kept local: that module is server-only). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const PAUSE_BETWEEN_ITEMS_MS = 150

// Hover preview geometry. The popover is rendered in a body portal so it can
// never be clipped by the dialog's scroll container.
const PREVIEW_WIDTH = 440
const PREVIEW_IMAGE_HEIGHT = 400
const PREVIEW_ESTIMATED_HEIGHT = 470
const PREVIEW_GAP = 12

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface Props {
  onClose: () => void
  onImported: () => void
}

interface ExistingPack {
  id: string
  name: string
}

interface ImgflipResponse {
  memes?: SourceItem[]
  fetchedAt?: string
}

interface PacksResponse {
  packs?: ExistingPack[]
}

interface TemplatesResponse {
  templates?: Array<{ packId: string; name: string }>
}

interface CreatePackResponse {
  pack?: { id?: string }
}

interface UploadResponse {
  key?: string
}

interface Progress {
  done: number
  total: number
  current: string
}

interface ImportProblem {
  name: string
  reason: string
}

interface ImportSummary {
  imported: number
  skipped: number
  failed: number
  total: number
  cancelled: boolean
  packCreated: boolean
  packName: string
  problems: ImportProblem[]
}

type Stage = 'setup' | 'select' | 'import'

interface HoverPreview {
  meme: SourceItem
  left: number
  top: number
}

class HttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Per-item validation problem: counted as "skipped", not as a hard failure. */
class SkippableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkippableError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error'
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Case/whitespace-insensitive key used for the pack-name collision check. */
export function packNameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The upload endpoint accepts PNG, JPEG, GIF and WebP only. */
export function imageExtensionForContentType(value: string | null): string | null {
  const type = (value ?? '').split(';')[0].trim().toLowerCase()
  switch (type) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    default:
      return null
  }
}

export function isAllowedImageSize(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= MIN_IMAGE_BYTES && bytes <= MAX_IMAGE_BYTES
}

/**
 * Only show the hover preview on devices with a real pointer. Touch browsers
 * sometimes emulate mouseenter; the media query keeps taps selection-only.
 */
function canHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (response.status === 401) {
    window.location.assign('/admin/login')
    throw new HttpError('Session expired — please sign in again.', 401)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Request failed (HTTP ${response.status})`
    throw new HttpError(message, response.status)
  }
  if (!isRecord(payload)) throw new Error('Unexpected server response')
  return payload as unknown as T
}

function memeDetail(meme: SourceItem): string {
  const parts: string[] = []
  if (meme.width !== undefined && meme.height !== undefined) {
    parts.push(`${meme.width} × ${meme.height}`)
  }
  if (meme.boxCount !== undefined) {
    parts.push(`${meme.boxCount} ${meme.boxCount === 1 ? 'box' : 'boxes'}`)
  }
  return parts.join(' · ')
}

function fetchedLabel(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `Catalog fetched ${date.toLocaleString()}`
}

export default function ImgflipPackCreator({ onClose, onImported }: Props) {
  const [stage, setStage] = useState<Stage>('setup')

  // Pack details
  const [packName, setPackName] = useState('Imgflip Top 100')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [packs, setPacks] = useState<ExistingPack[] | null>(null)
  const [packsLoading, setPacksLoading] = useState(true)
  const [packsError, setPacksError] = useState<string | null>(null)

  // Catalog + selection
  const [memes, setMemes] = useState<SourceItem[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [memesLoading, setMemesLoading] = useState(true)
  const [memesError, setMemesError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null)

  // Import run
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, current: '' })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const notifiedRef = useRef(false)

  const notifyImported = useCallback(() => {
    if (notifiedRef.current) return
    notifiedRef.current = true
    onImported()
  }, [onImported])

  const loadPacks = useCallback(async () => {
    setPacksLoading(true)
    setPacksError(null)
    try {
      const data = await getJson<PacksResponse>('/api/packs')
      const list = Array.isArray(data.packs)
        ? data.packs.filter(
            (pack) =>
              typeof pack?.id === 'string' &&
              pack.id.length > 0 &&
              typeof pack?.name === 'string' &&
              pack.name.length > 0,
          )
        : null
      if (!list) throw new Error('Unexpected pack list response.')
      setPacks(list)
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return
      setPacksError(errorMessage(error))
    } finally {
      setPacksLoading(false)
    }
  }, [])

  const loadMemes = useCallback(async () => {
    setMemesLoading(true)
    setMemesError(null)
    try {
      const data = await getJson<ImgflipResponse>('/api/admin/imgflip')
      if (!Array.isArray(data.memes)) throw new Error('Unexpected Imgflip response.')
      setMemes(data.memes)
      setFetchedAt(typeof data.fetchedAt === 'string' ? data.fetchedAt : null)
      // Keep a refetch from silently retaining ids that disappeared upstream.
      setSelected((previous) => {
        const available = new Set(data.memes?.map((meme) => meme.sourceId) ?? [])
        const next = new Set([...previous].filter((id) => available.has(id)))
        return next.size === previous.size ? previous : next
      })
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return
      setMemesError(errorMessage(error))
    } finally {
      setMemesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPacks()
    void loadMemes()
  }, [loadPacks, loadMemes])

  // Lock page scrolling, remember where focus came from and restore it on close.
  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [])

  // Move focus to the meaningful control when the step changes.
  useEffect(() => {
    if (stage === 'setup') {
      nameInputRef.current?.focus()
    } else {
      bodyRef.current?.focus()
    }
  }, [stage])

  // A fixed preview would otherwise keep floating in place while the list
  // scrolls under it.
  useEffect(() => {
    if (!hoverPreview) return
    const hide = () => setHoverPreview(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [hoverPreview])

  // Escape closes (except mid-import); Tab is trapped inside the dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (runningRef.current) {
          setNotice('Import in progress — use “Cancel import” if you want to stop.')
        } else {
          onClose()
        }
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = panelRef.current.contains(active)

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Never leave downloads/uploads running after the dialog disappears.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const trimmedName = packName.trim()
  const nameKey = packNameKey(packName)
  const collidingPack =
    packs && nameKey ? (packs.find((pack) => packNameKey(pack.name) === nameKey) ?? null) : null
  const nameError = collidingPack
    ? `A pack named “${collidingPack.name}” already exists. Choose a different name.`
    : null
  const canContinue = Boolean(trimmedName) && !collidingPack && packs !== null && !packsLoading

  const filteredMemes = useMemo(() => {
    if (!memes) return []
    const needle = query.trim().toLowerCase()
    if (!needle) return memes
    return memes.filter(
      (meme) =>
        meme.name.toLowerCase().includes(needle) ||
        meme.sourceId.toLowerCase().includes(needle),
    )
  }, [memes, query])

  const allFilteredSelected =
    filteredMemes.length > 0 && filteredMemes.every((meme) => selected.has(meme.sourceId))

  const chosenMemes = useMemo(
    () => (memes ?? []).filter((meme) => selected.has(meme.sourceId)),
    [memes, selected],
  )

  const requestClose = () => {
    if (runningRef.current) {
      setNotice('Import in progress — use “Cancel import” if you want to stop.')
      return
    }
    onClose()
  }

  const toggleMeme = (sourceId: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  /**
   * Anchor the fixed preview beside the hovered row, preferring the right
   * side and falling back to the left / clamped viewport edges.
   */
  const showHoverPreview = (meme: SourceItem, element: HTMLElement) => {
    if (!canHover()) return

    const rect = element.getBoundingClientRect()
    const maxLeft = Math.max(PREVIEW_GAP, window.innerWidth - PREVIEW_WIDTH - PREVIEW_GAP)
    let left = rect.right + PREVIEW_GAP
    if (left > maxLeft) left = rect.left - PREVIEW_WIDTH - PREVIEW_GAP
    left = Math.min(Math.max(PREVIEW_GAP, left), maxLeft)

    const maxTop = Math.max(
      PREVIEW_GAP,
      window.innerHeight - PREVIEW_ESTIMATED_HEIGHT - PREVIEW_GAP,
    )
    const centeredTop = rect.top + rect.height / 2 - PREVIEW_ESTIMATED_HEIGHT / 2
    const top = Math.min(Math.max(PREVIEW_GAP, centeredTop), maxTop)

    setHoverPreview({ meme, left, top })
  }

  const selectAllFiltered = () => {
    setSelected((previous) => {
      const next = new Set(previous)
      for (const meme of filteredMemes) next.add(meme.sourceId)
      return next
    })
  }

  const cancelImport = () => {
    if (!runningRef.current) return
    const confirmed = window.confirm(
      'Cancel the import? Templates already imported and the new pack will remain.',
    )
    if (!confirmed) return
    cancelledRef.current = true
    setNotice('Cancelling after the current request…')
    abortRef.current?.abort()
  }

  const startImport = async () => {
    if (runningRef.current) return
    const items = chosenMemes
    const targetName = trimmedName
    if (items.length === 0 || !targetName || collidingPack) return

    runningRef.current = true
    cancelledRef.current = false
    setHoverPreview(null)
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setStage('import')
    setSummary(null)
    setFatalError(null)
    setNotice('')
    setProgress({ done: 0, total: items.length, current: 'Loading existing templates…' })

    let packId: string | null = null
    let imported = 0
    let skipped = 0
    let failed = 0
    let wasCancelled = false
    const problems: ImportProblem[] = []

    try {
      // Load existing templates before creating anything so a failed read
      // leaves no half-prepared pack behind.
      const templateData = await getJson<TemplatesResponse>('/api/templates?limit=500', {
        signal: controller.signal,
      })
      const existingTemplates = Array.isArray(templateData.templates)
        ? templateData.templates
        : []

      const packData = await getJson<CreatePackResponse>('/api/packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: targetName,
          description: description.trim() || null,
          isPublic,
        }),
      })
      const createdPackId = packData.pack?.id
      if (typeof createdPackId !== 'string' || !createdPackId) {
        throw new Error('The server did not return the new pack id.')
      }
      packId = createdPackId

      const takenNames = new Set(
        existingTemplates
          .filter((template) => template.packId === packId)
          .map((template) => templateNameKey(template.name)),
      )

      for (let index = 0; index < items.length; index += 1) {
        if (cancelledRef.current) {
          wasCancelled = true
          skipped += items.length - index
          break
        }

        const meme = items[index]
        setProgress({ done: index, total: items.length, current: meme.name })

        try {
          if (!meme.imageUrl) {
            throw new SkippableError('No image URL in the Imgflip catalog.')
          }

          const imageResponse = await fetch(meme.imageUrl, {
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          })
          if (!imageResponse.ok) {
            throw new Error(`Image download failed (HTTP ${imageResponse.status}).`)
          }

          const contentType = imageResponse.headers.get('content-type')
          const extension = imageExtensionForContentType(contentType)
          if (!extension) {
            const label = contentType?.split(';')[0]?.trim() || 'missing Content-Type'
            throw new SkippableError(`Unsupported image type (${label}).`)
          }

          const rawLength = imageResponse.headers.get('content-length')
          const declaredLength = rawLength === null ? Number.NaN : Number(rawLength)
          if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
            throw new SkippableError('Image exceeds the 10 MB upload limit.')
          }

          const blob = await imageResponse.blob()
          if (!isAllowedImageSize(blob.size)) {
            throw new SkippableError(
              blob.size < MIN_IMAGE_BYTES
                ? 'Image is smaller than 1 KB.'
                : 'Image exceeds the 10 MB upload limit.',
            )
          }

          const form = new FormData()
          const fileName = `${slugify(meme.name, 40) || `imgflip-${meme.sourceId}`}${extension}`
          form.append('file', blob, fileName)

          const upload = await getJson<UploadResponse>('/api/upload', {
            method: 'POST',
            body: form,
            signal: controller.signal,
          })
          const imageKey = upload.key
          if (typeof imageKey !== 'string' || !imageKey) {
            throw new Error('Upload did not return an image key.')
          }

          const uniqueName = uniqueTemplateName(
            meme.name,
            (key) => takenNames.has(key),
            MAX_TEMPLATE_NAME_LENGTH,
          )
          await getJson('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              packId,
              name: uniqueName,
              imageKey,
              isFreeform: true,
              boxes: [],
            }),
            signal: controller.signal,
          })
          takenNames.add(templateNameKey(uniqueName))
          imported += 1
        } catch (error) {
          if (isAbortError(error) || cancelledRef.current) {
            wasCancelled = true
            skipped += items.length - index
            break
          }
          if (error instanceof HttpError && error.status === 401) {
            // The browser is already on its way to /admin/login.
            skipped += items.length - index
            break
          }
          if (error instanceof SkippableError) {
            skipped += 1
            problems.push({ name: meme.name, reason: error.message })
          } else {
            failed += 1
            problems.push({ name: meme.name, reason: errorMessage(error) })
          }
        }

        setProgress({ done: index + 1, total: items.length, current: '' })
        if (index < items.length - 1) await sleep(PAUSE_BETWEEN_ITEMS_MS)
      }

      setProgress({ done: items.length, total: items.length, current: '' })
      setSummary({
        imported,
        skipped,
        failed,
        total: items.length,
        cancelled: wasCancelled,
        packCreated: true,
        packName: targetName,
        problems,
      })
      notifyImported()
    } catch (error) {
      if (isAbortError(error) || cancelledRef.current) {
        const created = packId !== null
        setSummary({
          imported,
          skipped: created ? items.length - imported : 0,
          failed,
          total: items.length,
          cancelled: true,
          packCreated: created,
          packName: targetName,
          problems,
        })
        if (created) notifyImported()
      } else if (packId === null) {
        setFatalError(errorMessage(error))
      } else {
        // Defensive: an unexpected error after the pack exists still ends with
        // an honest summary instead of a frozen progress screen.
        const remaining = items.length - imported - skipped - failed
        if (remaining > 0) failed += remaining
        setSummary({
          imported,
          skipped,
          failed,
          total: items.length,
          cancelled: false,
          packCreated: true,
          packName: targetName,
          problems,
        })
        notifyImported()
      }
    } finally {
      runningRef.current = false
      abortRef.current = null
      setNotice('')
      setRunning(false)
    }
  }

  const stepNumber = stage === 'setup' ? 1 : stage === 'select' ? 2 : 3
  const percent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-hidden="true"
        onClick={requestClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-busy={running}
        className="relative flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-line bg-card text-ink shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
      >
        <header className="flex flex-none items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">
              Admin · Step {stepNumber} of 3
            </p>
            <h2 id={TITLE_ID} className="mt-1 text-lg font-bold sm:text-xl">
              Imgflip pack creator
            </h2>
            <p className="mt-1 text-sm text-dim">
              Create a new pack from Imgflip&apos;s current template catalog.
            </p>
          </div>
          <button
            type="button"
            className="ghost flex-none"
            onClick={requestClose}
            disabled={running}
            aria-label="Close dialog"
            title={running ? 'Cancel the import first' : 'Close'}
          >
            ✕
          </button>
        </header>

        <div
          ref={bodyRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto p-4 focus:outline-none sm:p-5"
        >
          {stage === 'setup' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Pack name</span>
                  <input
                    ref={nameInputRef}
                    value={packName}
                    maxLength={60}
                    placeholder="Imgflip Top 100"
                    onChange={(event) => setPackName(event.target.value)}
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? 'imgflip-pack-name-error' : undefined}
                    className="w-full"
                  />
                  {nameError ? (
                    <span
                      id="imgflip-pack-name-error"
                      role="alert"
                      className="mt-1 block text-sm text-rose"
                    >
                      {nameError}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-dim">
                      A new pack is created; existing packs are never modified.
                    </span>
                  )}
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Description (optional)</span>
                  <textarea
                    value={description}
                    rows={2}
                    maxLength={140}
                    placeholder="Shown in the pack list"
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full resize-y"
                  />
                  <span className="mt-1 block text-right text-xs text-dim">
                    {description.length}/140
                  </span>
                </label>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(event) => setIsPublic(event.target.checked)}
                  className="h-4 w-4 accent-punch"
                />
                <span>
                  Public pack
                  <span className="ml-2 text-xs text-dim">
                    Visible to players when it is active.
                  </span>
                </span>
              </label>

              <div className="rounded-lg border border-line bg-night2 p-3 text-sm">
                {packsLoading ? (
                  <p className="text-dim">Loading existing packs…</p>
                ) : packsError ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-rose">
                      Could not check pack names: {packsError}
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void loadPacks()}
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <p className="text-dim">
                    {packs && packs.length > 0
                      ? `${packs.length} existing pack${packs.length === 1 ? '' : 's'} loaded. `
                      : 'No packs yet. '}
                    Imports always create a new pack.
                  </p>
                )}
              </div>
            </div>
          )}

          {stage === 'select' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Choose templates</h3>
                  <p className="mt-1 text-xs text-dim">
                    {memes === null
                      ? 'Loading the Imgflip catalog…'
                      : `${filteredMemes.length} of ${memes.length} shown · ${selected.size} selected`}
                  </p>
                  {fetchedLabel(fetchedAt) && (
                    <p className="text-xs text-dim">{fetchedLabel(fetchedAt)}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="ghost"
                    onClick={selectAllFiltered}
                    disabled={filteredMemes.length === 0 || allFilteredSelected}
                  >
                    Select all shown
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setSelected(new Set())}
                    disabled={selected.size === 0}
                  >
                    Clear selection
                  </button>
                </div>
              </div>

              <label className="block">
                <span className="sr-only">Search templates</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Search by name or Imgflip id…"
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full"
                />
              </label>

              {memesError && (
                <div className="error-banner flex flex-wrap items-center justify-between gap-2">
                  <span>Could not load Imgflip templates: {memesError}</span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void loadMemes()}
                    disabled={memesLoading}
                  >
                    {memesLoading ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              )}

              {memesLoading && memes === null && (
                <p className="py-8 text-center text-sm text-dim">
                  Loading the Imgflip catalog…
                </p>
              )}

              {memes !== null && filteredMemes.length === 0 && (
                <p className="py-8 text-center text-sm text-dim">
                  {memes.length === 0
                    ? 'No templates are available right now.'
                    : 'No templates match your search.'}
                </p>
              )}

              {filteredMemes.length > 0 && (
                <ul className="grid max-h-[42vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {filteredMemes.map((meme) => {
                    const isSelected = selected.has(meme.sourceId)
                    return (
                      <li key={meme.sourceId}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition ${
                            isSelected
                              ? 'border-punch/70 bg-punch/10'
                              : 'border-line bg-night2 hover:border-dim/60'
                          }`}
                          onMouseEnter={(event) => showHoverPreview(meme, event.currentTarget)}
                          onMouseLeave={() => setHoverPreview(null)}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleMeme(meme.sourceId)}
                            className="h-4 w-4 flex-none accent-punch"
                          />
                          {/* eslint-disable-next-line @next/next/no-img-element -- remote Imgflip thumbnail, no Next image host config needed */}
                          <img
                            src={meme.imageUrl}
                            alt=""
                            width={56}
                            height={56}
                            loading="lazy"
                            decoding="async"
                            className="h-14 w-14 flex-none rounded-lg border border-line bg-black object-cover"
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className="block truncate text-sm font-medium"
                              title={meme.name}
                            >
                              {meme.name}
                            </span>
                            <span className="block text-xs text-dim">
                              {memeDetail(meme) || 'Imgflip template'}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              <p className="text-xs text-dim">
                Hover a template for a larger preview. Templates are imported one at a time
                with a 150 ms pause, so this can take a while for large selections. Keep the
                tab open.
              </p>
            </div>
          )}

          {stage === 'import' && (
            <div className="space-y-4">
              {running && (
                <>
                  <div>
                    <p className="text-sm font-medium" aria-live="polite">
                      {progress.total > 0
                        ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                        : 'Preparing import…'}
                    </p>
                    <p className="mt-1 truncate text-sm text-dim" title={progress.current}>
                      {progress.current || '…'}
                    </p>
                    <div
                      role="progressbar"
                      aria-label="Import progress"
                      aria-valuemin={0}
                      aria-valuemax={progress.total}
                      aria-valuenow={progress.done}
                      className="mt-3 h-2 overflow-hidden rounded-full bg-night2"
                    >
                      <div
                        className="h-full rounded-full bg-punch transition-[width] duration-200"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-dim">
                      {progress.done} of {progress.total} processed · {percent}%
                    </p>
                  </div>
                  <p className="rounded-lg border border-line bg-night2 p-3 text-sm text-dim">
                    You can cancel; the new pack and templates already imported will remain.
                  </p>
                </>
              )}

              {!running && fatalError && (
                <div className="error-banner" role="alert">
                  <strong>Import could not start.</strong>
                  <p className="mt-1">{fatalError}</p>
                  <p className="mt-1 text-sm">Nothing was imported.</p>
                </div>
              )}

              {!running && summary && (
                <>
                  <div className="rounded-xl border border-line bg-night2 p-4">
                    <p className="font-semibold">
                      {summary.cancelled
                        ? 'Import cancelled'
                        : summary.imported > 0
                          ? 'Import finished'
                          : 'Import finished without new templates'}
                    </p>
                    <p className="mt-1 text-sm text-dim">
                      {summary.cancelled
                        ? summary.packCreated
                          ? `“${summary.packName}” was created and the templates imported before cancellation were kept.`
                          : 'The import was cancelled before the pack was created.'
                        : summary.packCreated
                          ? summary.imported > 0
                            ? `“${summary.packName}” now contains ${summary.imported} new template${
                                summary.imported === 1 ? '' : 's'
                              }.`
                            : `“${summary.packName}” was created, but no templates were imported.`
                          : 'No pack was created.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-line bg-night2 p-3">
                      <div className="text-2xl font-bold text-mint">{summary.imported}</div>
                      <div className="text-xs text-dim">imported</div>
                    </div>
                    <div className="rounded-lg border border-line bg-night2 p-3">
                      <div className="text-2xl font-bold text-dim">{summary.skipped}</div>
                      <div className="text-xs text-dim">skipped</div>
                    </div>
                    <div className="rounded-lg border border-line bg-night2 p-3">
                      <div className="text-2xl font-bold text-rose">{summary.failed}</div>
                      <div className="text-xs text-dim">failed</div>
                    </div>
                  </div>

                  <p className="text-xs text-dim">
                    {summary.total} template{summary.total === 1 ? '' : 's'} selected.
                    {summary.skipped > 0
                      ? ' Skipped items were invalid, unsupported or left over after cancellation.'
                      : ''}
                  </p>

                  {summary.problems.length > 0 && (
                    <details
                      className="rounded-lg border border-line bg-night2 p-3"
                      open={summary.failed > 0}
                    >
                      <summary className="cursor-pointer text-sm font-medium">
                        Problems ({summary.problems.length})
                      </summary>
                      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                        {summary.problems.map((problem, index) => (
                          <li key={`${problem.name}-${index}`}>
                            <span className="font-medium">{problem.name}</span>
                            <span className="text-dim"> — {problem.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-line p-4 sm:p-5">
          <p className="min-h-5 text-xs text-dim" aria-live="polite">
            {notice}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {stage === 'setup' && (
              <>
                <button type="button" className="ghost" onClick={requestClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!canContinue}
                  onClick={() => setStage('select')}
                >
                  Continue to memes
                </button>
              </>
            )}

            {stage === 'select' && (
              <>
                <button type="button" className="ghost" onClick={() => setStage('setup')}>
                  Back
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={chosenMemes.length === 0 || memes === null}
                  onClick={() => void startImport()}
                >
                  Import {chosenMemes.length} template
                  {chosenMemes.length === 1 ? '' : 's'}
                </button>
              </>
            )}

            {stage === 'import' && running && (
              <button type="button" className="danger" onClick={cancelImport}>
                Cancel import
              </button>
            )}

            {stage === 'import' && !running && fatalError && (
              <>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setFatalError(null)
                    setStage('select')
                  }}
                >
                  Back to selection
                </button>
                <button type="button" className="primary" onClick={() => void startImport()}>
                  Try again
                </button>
              </>
            )}

            {stage === 'import' && !running && summary && (
              <button type="button" className="primary" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </footer>
      </div>

      {hoverPreview &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50 w-[440px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-card text-ink shadow-2xl"
            style={{ left: hoverPreview.left, top: hoverPreview.top }}
          >
            <div
              className="flex max-h-[55vh] w-full items-center justify-center bg-black"
              style={{ height: PREVIEW_IMAGE_HEIGHT }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- hover preview of the already-visible Imgflip thumbnail */}
              <img
                src={hoverPreview.meme.imageUrl}
                alt=""
                draggable={false}
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="border-t border-line px-3 py-2">
              <p className="line-clamp-2 text-sm font-medium">{hoverPreview.meme.name}</p>
              <p className="mt-0.5 text-xs text-dim">
                {memeDetail(hoverPreview.meme) || 'Imgflip template'}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
