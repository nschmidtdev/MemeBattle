'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UPLOAD_ACCEPT, imageUrl } from '@/lib/images'
import ImgflipPackCreator from './ImgflipPackCreator'
import TemplateEditor, { type AdminTemplate } from './TemplateEditor'

interface AdminPack {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  isActive: boolean
  adult: boolean
  sortOrder: number
  templateCount: number
  activeTemplateCount: number
}

interface Props {
  email: string
}

type PackModalState = { mode: 'create' } | { mode: 'edit'; pack: AdminPack }

interface PackFormValues {
  name: string
  description: string
  isPublic: boolean
  isActive: boolean
  adult: boolean
}

type TemplateAction = 'toggle' | 'delete'

interface PreviewPlacement {
  left: number
  top: number
  width: number
}

interface HoverPreview extends PreviewPlacement {
  template: AdminTemplate
}

/** Delay before the enlarged card preview appears, so it does not flash while skimming. */
const HOVER_PREVIEW_DELAY_MS = 280

/**
 * Only devices with a real pointer and enough room get the hover preview.
 * Touch devices and the stacked mobile layout simply keep the card thumbnail.
 */
function canHoverPreview() {
  return window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)').matches
}

/** Fixed placement beside the card, flipped or centered when it would leave the viewport. */
function placementFor(rect: DOMRect): PreviewPlacement {
  const margin = 12
  const gap = 14
  const width = Math.min(440, window.innerWidth - margin * 2)
  // Roughly the max rendered height (image cap + caption + padding).
  const estimatedHeight = 470

  let left = rect.right + gap
  if (left + width > window.innerWidth - margin) left = rect.left - width - gap
  if (left < margin) left = Math.max(margin, (window.innerWidth - width) / 2)

  const centeredTop = rect.top + rect.height / 2 - estimatedHeight / 2
  const top = Math.max(margin, Math.min(window.innerHeight - margin - estimatedHeight, centeredTop))

  return { left, top, width }
}

export default function AdminPanel({ email }: Props) {
  const router = useRouter()
  const [packs, setPacks] = useState<AdminPack[] | null>(null)
  const [templates, setTemplates] = useState<AdminTemplate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminTemplate | null>(null)

  // Workspace navigation / filters.
  const [selectedPackId, setSelectedPackId] = useState<string>('all')
  const [packSearch, setPackSearch] = useState('')
  const [templateSearch, setTemplateSearch] = useState('')

  // Dialogs. All create/edit forms live in viewport-fixed overlays.
  const [packModal, setPackModal] = useState<PackModalState | null>(null)
  const [newTemplateOpen, setNewTemplateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Double-click guards for inline actions.
  const [busyTemplate, setBusyTemplate] = useState<{ id: string; action: TemplateAction } | null>(null)
  const [busyPackAction, setBusyPackAction] = useState<'public' | 'active' | 'delete' | null>(null)

  // Hover preview: the pending state is what the short delay timer is attached to.
  const [pendingPreview, setPendingPreview] = useState<HoverPreview | null>(null)
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null)

  const api = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init)
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        // Session expired or the cookie was cleared: go back to the login page.
        router.replace('/admin/login')
        throw new Error('Session expired — please sign in again.')
      }
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
      return data
    },
    [router],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [packData, tplData] = await Promise.all([api('/api/packs'), api('/api/templates')])
      setPacks(packData.packs)
      setTemplates(tplData.templates)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  // Keep the selection valid when a pack disappears (delete, import reload, another tab).
  useEffect(() => {
    if (selectedPackId !== 'all' && packs && !packs.some((p) => p.id === selectedPackId)) {
      setSelectedPackId('all')
    }
  }, [packs, selectedPackId])

  // Hover intent: wait a moment before showing the big preview.
  useEffect(() => {
    if (!pendingPreview) return
    const timer = window.setTimeout(() => {
      setHoverPreview(pendingPreview)
      setPendingPreview(null)
    }, HOVER_PREVIEW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [pendingPreview])

  // A fixed popover cannot follow a scrolling card; hide it instead of leaving it stale.
  useEffect(() => {
    if (!pendingPreview && !hoverPreview) return
    const hide = () => {
      setPendingPreview(null)
      setHoverPreview(null)
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [pendingPreview, hoverPreview])

  // Data or filter changes can remove the hovered card; never leave its preview floating.
  useEffect(() => {
    setPendingPreview(null)
    setHoverPreview(null)
  }, [selectedPackId, templateSearch, packs, templates])

  // Re-fetch a single template after a conflict (409) in the editor.
  const reloadTemplate = useCallback(
    async (id: string): Promise<AdminTemplate | null> => {
      const data = await api('/api/templates')
      const list: AdminTemplate[] = data.templates ?? []
      setTemplates(list)
      const fresh = list.find((t) => t.id === id) ?? null
      if (fresh) setEditing(fresh)
      return fresh
    },
    [api],
  )

  const run = (fn: () => Promise<unknown>) =>
    fn().catch((e) => setError(e instanceof Error ? e.message : 'Request failed'))

  const logout = () =>
    run(async () => {
      await api('/api/admin/logout', { method: 'POST' })
      router.push('/admin/login')
    })

  const hideHoverPreview = () => {
    setPendingPreview(null)
    setHoverPreview(null)
  }

  const scheduleHoverPreview = (template: AdminTemplate, card: HTMLElement) => {
    if (!canHoverPreview()) return
    setHoverPreview(null)
    setPendingPreview({ template, ...placementFor(card.getBoundingClientRect()) })
  }

  const openTemplateEditor = (template: AdminTemplate) => {
    hideHoverPreview()
    setEditing(template)
  }

  const togglePackFlag = (pack: AdminPack, field: 'public' | 'active') => {
    if (busyPackAction) return
    run(async () => {
      setBusyPackAction(field)
      try {
        await api(`/api/packs/${pack.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(field === 'public' ? { isPublic: !pack.isPublic } : { isActive: !pack.isActive }),
        })
        await load()
      } finally {
        setBusyPackAction(null)
      }
    })
  }

  const deletePack = (pack: AdminPack) => {
    if (busyPackAction) return
    if (!confirm(`Delete pack "${pack.name}" and all its templates?`)) return
    hideHoverPreview()
    run(async () => {
      setBusyPackAction('delete')
      try {
        await api(`/api/packs/${pack.id}`, { method: 'DELETE' })
        if (editing?.packId === pack.id) setEditing(null)
        setSelectedPackId('all')
        await load()
      } finally {
        setBusyPackAction(null)
      }
    })
  }

  const toggleTemplateActive = (template: AdminTemplate) => {
    if (busyTemplate) return
    run(async () => {
      setBusyTemplate({ id: template.id, action: 'toggle' })
      try {
        await api(`/api/templates/${template.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !template.isActive }),
        })
        await load()
      } finally {
        setBusyTemplate(null)
      }
    })
  }

  const deleteTemplate = (template: AdminTemplate) => {
    if (busyTemplate) return
    if (!confirm(`Delete template "${template.name}"?`)) return
    hideHoverPreview()
    run(async () => {
      setBusyTemplate({ id: template.id, action: 'delete' })
      try {
        await api(`/api/templates/${template.id}`, { method: 'DELETE' })
        if (editing?.id === template.id) setEditing(null)
        await load()
      } finally {
        setBusyTemplate(null)
      }
    })
  }

  const savePack = async (values: PackFormValues) => {
    const description = values.description.trim() || null
    let createdId: string | null = null
    if (packModal?.mode === 'edit') {
      await api(`/api/packs/${packModal.pack.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          description,
          isPublic: values.isPublic,
          isActive: values.isActive,
          adult: values.adult,
        }),
      })
    } else {
      const data = await api('/api/packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          description,
          isPublic: values.isPublic,
          adult: values.adult,
        }),
      })
      if (typeof data?.pack?.id === 'string') createdId = data.pack.id
    }
    // Select the new pack only after the refreshed list contains it, otherwise
    // the "selection no longer exists" effect would immediately reset it.
    await load()
    if (createdId) setSelectedPackId(createdId)
  }

  const createTemplate = async (packId: string, name: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const uploaded = await api('/api/upload', { method: 'POST', body: form })
    await api('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId,
        name,
        imageKey: uploaded.key,
      }),
    })
    // A previous filter must not hide the card that was just created.
    setTemplateSearch('')
    await load()
  }

  if (packs === null || templates === null) {
    return (
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-night p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-xl uppercase tracking-wide">Meme Battle Admin</h1>
            <span className="min-w-0 truncate text-xs text-dim">{email}</span>
          </div>
          {error && (
            <div className="error-banner mb-0 mt-4 flex items-start justify-between gap-3" role="alert">
              <span className="min-w-0">{error}</span>
              <button className="ghost shrink-0" disabled={loading} onClick={() => load()}>
                {loading ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {loading ? (
            <p className="muted mt-3">Loading…</p>
          ) : (
            !error && <p className="muted mt-3">No data.</p>
          )}
        </div>
      </div>
    )
  }

  const packQuery = packSearch.trim().toLowerCase()
  const visiblePacks = packs.filter((p) => p.name.toLowerCase().includes(packQuery))

  const selectedPack = selectedPackId === 'all' ? null : packs.find((p) => p.id === selectedPackId) ?? null
  const scopeTemplates = selectedPackId === 'all' ? templates : templates.filter((t) => t.packId === selectedPackId)
  const templateQuery = templateSearch.trim().toLowerCase()
  const visibleTemplates = templateQuery
    ? scopeTemplates.filter((t) => t.name.toLowerCase().includes(templateQuery))
    : scopeTemplates
  const activeVisible = visibleTemplates.filter((t) => t.isActive).length
  const packNames = new Map(packs.map((p) => [p.id, p.name] as const))
  const defaultTemplatePackId = selectedPack?.id ?? packs[0]?.id ?? ''

  return (
    <div className="fixed inset-0 z-20 flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-night text-ink">
      {/* ------------------------------------------------------------- header */}
      <header className="flex flex-none items-center justify-between gap-3 border-b border-line/70 bg-night2/70 px-3 py-2 backdrop-blur-md sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="hidden h-8 w-8 flex-none items-center justify-center rounded-lg border border-line bg-card2 text-base sm:flex"
          >
            🎛️
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-base uppercase leading-tight tracking-wide sm:text-lg">
              Meme Battle Admin
            </h1>
            <p className="hidden text-[11px] text-dim sm:block">Packs &amp; templates workspace</p>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="hidden max-w-[240px] truncate text-xs text-dim md:inline">{email}</span>
          <button className="ghost px-2.5 py-1.5 text-xs sm:text-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {error && (
        <div
          className="error-banner mb-0 mx-2 mt-2 flex flex-none items-start justify-between gap-2 sm:mx-4"
          role="alert"
        >
          <span className="min-w-0">{error}</span>
          <button className="ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => setError(null)} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      {/* --------------------------------------------------------------- body */}
      <main className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5 sm:gap-3 sm:p-3 lg:flex-row lg:gap-4 lg:p-4">
        {/* Pack sidebar: fixed width on desktop, capped stack on mobile. */}
        <aside
          className="flex max-h-[42dvh] flex-none flex-col overflow-hidden rounded-xl border border-line bg-card/80 shadow-lg lg:max-h-none lg:min-h-0 lg:w-[300px] xl:w-[320px]"
          aria-label="Packs"
        >
          <div className="flex flex-none items-center justify-between gap-2 border-b border-line/70 px-3 py-2">
            <h2 className="text-sm font-bold">Packs</h2>
            <span className="badge">{packs.length}</span>
          </div>

          <div className="flex flex-none flex-col gap-2 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                className="primary px-2 py-1.5 text-xs"
                onClick={() => setPackModal({ mode: 'create' })}
                title="Create a new pack"
              >
                + New pack
              </button>
              <button
                className="ghost px-2 py-1.5 text-xs"
                onClick={() => setImportOpen(true)}
                title="Build a pack from a template catalog or local images"
              >
                Import memes
              </button>
            </div>
            <input
              type="search"
              value={packSearch}
              placeholder="Search packs…"
              aria-label="Search packs"
              onChange={(e) => setPackSearch(e.target.value)}
              className="w-full text-sm"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2.5">
            <button
              type="button"
              onClick={() => setSelectedPackId('all')}
              aria-current={selectedPackId === 'all' ? 'true' : undefined}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun ${
                selectedPackId === 'all'
                  ? 'border-punch bg-punch/10'
                  : 'border-transparent hover:border-line hover:bg-card2/60'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${selectedPackId === 'all' ? 'text-punch' : ''}`}>
                  All packs
                </span>
                <span className="badge px-1.5 py-0 text-[10px]">{templates.length} templates</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-dim">Show templates from every pack</span>
            </button>

            <div className="mt-1.5 space-y-1">
              {visiblePacks.map((p) => {
                const selected = p.id === selectedPackId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPackId(p.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun ${
                      selected
                        ? 'border-punch bg-punch/10'
                        : 'border-transparent hover:border-line hover:bg-card2/60'
                    }`}
                  >
                    <span className={`block truncate text-sm font-semibold ${selected ? 'text-punch' : ''}`} title={p.name}>
                      {p.name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <span className={`badge px-1.5 py-0 text-[10px] ${p.isPublic ? 'live' : ''}`}>
                        {p.isPublic ? 'public' : 'hidden'}
                      </span>
                      <span className={`badge px-1.5 py-0 text-[10px] ${p.isActive ? 'live' : ''}`}>
                        {p.isActive ? 'active' : 'off'}
                      </span>
                      {p.adult && (
                        <span className="badge px-1.5 py-0 text-[10px] text-rose" title="Adult (18+) pack">
                          +18
                        </span>
                      )}
                      <span className="badge px-1.5 py-0 text-[10px]">
                        {p.templateCount} {p.templateCount === 1 ? 'template' : 'templates'}
                      </span>
                    </span>
                  </button>
                )
              })}
              {visiblePacks.length === 0 && (
                <p className="px-2 py-3 text-xs text-dim">
                  {packQuery ? `No packs match "${packSearch.trim()}".` : 'No packs yet — create one or import from Imgflip.'}
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Template workspace: its own scroll area, never grows the page. */}
        <section
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-card/70 shadow-lg"
          aria-label="Templates"
        >
          <div className="flex-none border-b border-line/70 bg-card2/30 px-3 py-2.5 sm:px-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="truncate text-base font-bold sm:text-lg">
                    {selectedPack ? selectedPack.name : 'All templates'}
                  </h2>
                  {selectedPack ? (
                    <>
                      <span className={`badge ${selectedPack.isPublic ? 'live' : ''}`}>
                        {selectedPack.isPublic ? 'public' : 'hidden'}
                      </span>
                      <span className={`badge ${selectedPack.isActive ? 'live' : ''}`}>
                        {selectedPack.isActive ? 'active' : 'off'}
                      </span>
                      {selectedPack.adult && (
                        <span className="badge text-rose" title="Adult (18+) pack">
                          +18
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="badge">{packs.length} packs</span>
                  )}
                </div>
                {selectedPack?.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-dim">{selectedPack.description}</p>
                )}
                {!selectedPack && <p className="mt-0.5 text-xs text-dim">Templates from every pack, one scroll area.</p>}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  className="primary px-2.5 py-1.5 text-xs sm:text-sm"
                  disabled={packs.length === 0}
                  onClick={() => setNewTemplateOpen(true)}
                >
                  + New template
                </button>
                {selectedPack && (
                  <>
                    <button
                      className="ghost px-2 py-1.5 text-xs"
                      disabled={busyPackAction !== null}
                      onClick={() => setPackModal({ mode: 'edit', pack: selectedPack })}
                    >
                      Edit pack
                    </button>
                    <button
                      className="danger px-2 py-1.5 text-xs"
                      disabled={busyPackAction !== null}
                      onClick={() => deletePack(selectedPack)}
                    >
                      {busyPackAction === 'delete' ? 'Deleting…' : 'Delete pack'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {selectedPack && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-dim">Pack visibility:</span>
                <button
                  className="ghost px-2 py-1 text-[11px]"
                  disabled={busyPackAction !== null}
                  onClick={() => togglePackFlag(selectedPack, 'public')}
                >
                  {busyPackAction === 'public' ? 'Saving…' : selectedPack.isPublic ? 'Hide' : 'Make public'}
                </button>
                <button
                  className="ghost px-2 py-1 text-[11px]"
                  disabled={busyPackAction !== null}
                  onClick={() => togglePackFlag(selectedPack, 'active')}
                >
                  {busyPackAction === 'active' ? 'Saving…' : selectedPack.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={templateSearch}
                placeholder="Search templates by name…"
                aria-label="Search templates by name"
                onChange={(e) => setTemplateSearch(e.target.value)}
                className="min-w-0 flex-1 basis-[200px] text-sm"
              />
              <span className="text-[11px] text-dim" aria-live="polite">
                {templateQuery ? `${visibleTemplates.length} of ${scopeTemplates.length}` : visibleTemplates.length}{' '}
                {visibleTemplates.length === 1 ? 'template' : 'templates'} · {activeVisible} active
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 sm:p-3">
            {visibleTemplates.length > 0 ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleTemplates.map((t) => {
                  const selected = editing?.id === t.id
                  const busy = busyTemplate?.id === t.id
                  return (
                    <article
                      key={t.id}
                      aria-busy={busy}
                      onMouseEnter={(e) => scheduleHoverPreview(t, e.currentTarget)}
                      onMouseLeave={hideHoverPreview}
                      onClick={(e) => {
                        if (busyTemplate) return
                        const target = e.target
                        // Let the checkbox and the explicit action buttons handle their own clicks.
                        if (target instanceof Element && target.closest('button, a, input, label, select, textarea')) return
                        openTemplateEditor(t)
                      }}
                      className={`flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card2/40 transition-colors ${
                        selected ? 'border-punch' : 'border-line'
                      }`}
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail for arbitrary uploaded images */}
                        <img
                          src={imageUrl(t.imageKey, 320)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-x-1.5 top-1.5 flex flex-wrap gap-1">
                          <span className="badge border-black/30 bg-night/85 text-[10px] text-ink">
                            {t.isFreeform ? 'freeform' : `fixed · ${t.boxes.length} boxes`}
                          </span>
                          {selectedPackId === 'all' && (
                            <span className="badge max-w-full truncate border-black/30 bg-night/85 text-[10px] text-ink">
                              {packNames.get(t.packId) ?? 'Pack'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col gap-2 p-2.5">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-tight" title={t.name}>
                          {t.name}
                        </h3>

                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-dim">
                            <input
                              type="checkbox"
                              checked={t.isActive}
                              disabled={busyTemplate !== null}
                              onChange={() => toggleTemplateActive(t)}
                              className="h-3.5 w-3.5 accent-punch"
                            />
                            Active
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              className="ghost px-2 py-1 text-xs"
                              disabled={busyTemplate !== null}
                              onClick={() => openTemplateEditor(t)}
                            >
                              Edit
                            </button>
                            <button
                              className="danger px-2 py-1 text-xs"
                              disabled={busyTemplate !== null}
                              onClick={() => deleteTemplate(t)}
                              aria-label={`Delete template ${t.name}`}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {busy && (
                          <p className="text-[11px] text-punch">
                            {busyTemplate?.action === 'delete' ? 'Deleting…' : 'Saving…'}
                          </p>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line p-6 text-center">
                <p className="text-sm text-dim">
                  {templateQuery
                    ? `No templates match "${templateSearch.trim()}".`
                    : selectedPack
                      ? 'No templates in this pack yet.'
                      : 'No templates yet.'}
                </p>
                {!templateQuery && packs.length > 0 && (
                  <button className="primary px-3 py-1.5 text-sm" onClick={() => setNewTemplateOpen(true)}>
                    + New template
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Hover preview: fixed, outside the grid flow, purely visual. */}
      {hoverPreview && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-xl border border-line bg-black p-1.5 shadow-2xl"
          style={{ left: hoverPreview.left, top: hoverPreview.top, width: hoverPreview.width }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- enlarged hover preview for arbitrary uploaded images */}
          <img
            src={imageUrl(hoverPreview.template.imageKey, 1200)}
            alt=""
            decoding="async"
            className="mx-auto block max-h-[min(56vh,420px)] w-full rounded-lg object-contain"
          />
          <p className="mt-1.5 truncate px-1 text-center text-sm font-semibold text-ink">
            {hoverPreview.template.name}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------ dialogs */}
      {packModal && (
        <PackModal
          key={packModal.mode === 'edit' ? packModal.pack.id : 'new-pack'}
          pack={packModal.mode === 'edit' ? packModal.pack : null}
          onClose={() => setPackModal(null)}
          onSubmit={savePack}
        />
      )}

      {newTemplateOpen && (
        <NewTemplateModal
          packs={packs}
          defaultPackId={defaultTemplatePackId}
          lockPack={selectedPack !== null}
          onClose={() => setNewTemplateOpen(false)}
          onSubmit={createTemplate}
        />
      )}

      {editing && (
        <TemplateEditor
          key={editing.id}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
          onReload={reloadTemplate}
        />
      )}

      {importOpen && (
        <ImgflipPackCreator
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setSelectedPackId('all')
            load()
          }}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Modal shells                                                               */
/* -------------------------------------------------------------------------- */

/** Close a dialog with Escape (dialogs handle their own focusable controls). */
function useEscapeClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, enabled])
}

function PackModal({
  pack,
  onClose,
  onSubmit,
}: {
  pack: AdminPack | null
  onClose: () => void
  onSubmit: (values: PackFormValues) => Promise<void>
}) {
  const [name, setName] = useState(pack?.name ?? '')
  const [description, setDescription] = useState(pack?.description ?? '')
  const [isPublic, setIsPublic] = useState(pack?.isPublic ?? true)
  const [isActive, setIsActive] = useState(pack?.isActive ?? true)
  const [adult, setAdult] = useState(pack?.adult ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeClose(onClose, !busy)

  const submit = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name, description, isPublic, isActive, adult })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pack-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-card shadow-2xl sm:rounded-2xl"
      >
        <div className="flex flex-none items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="pack-modal-title" className="text-lg font-bold">
              {pack ? 'Edit pack' : 'New pack'}
            </h2>
            <p className="text-xs text-dim">
              {pack ? 'Rename this pack or change its visibility.' : 'Create a pack, then add templates to it.'}
            </p>
          </div>
          <button className="ghost px-2 py-1" onClick={onClose} disabled={busy} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {error && (
            <div className="error-banner mb-0 flex items-start justify-between gap-2" role="alert">
              <span className="min-w-0">{error}</span>
              <button type="button" className="ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}

          <div className="grid gap-3">
            <label className="block text-xs text-dim">
              Name
              <input
                autoFocus
                value={name}
                maxLength={60}
                required
                placeholder="Pack name"
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full"
              />
            </label>
            <label className="block text-xs text-dim">
              Description (optional)
              <textarea
                value={description}
                maxLength={140}
                rows={3}
                placeholder="Short description for players"
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full resize-y"
              />
            </label>
            <div>
              <label className="checkbox-row">
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                <span>Public (players can pick this pack)</span>
              </label>
              {pack && (
                <label className="checkbox-row">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>Active (available in the game)</span>
                </label>
              )}
              {!pack && <p className="mt-1 text-[11px] text-dim">New packs start active.</p>}
            </div>
            <div className="rounded-xl border border-rose/40 bg-rose/5 px-3 py-2.5">
              <label className="checkbox-row">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                <span className="font-semibold text-rose">+18 / adult content</span>
              </label>
              <p className="ml-6 mt-0.5 text-[11px] leading-snug text-dim">
                Marks the pack as 18+. Every player must confirm their age when a lobby uses
                it — and is removed if they decline. Keep the content yourself: the bundle
                ships no adult templates.
              </p>
            </div>
          </div>
        </form>

        <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line bg-card2/40 px-4 py-3">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            type="button"
            disabled={!name.trim() || busy}
            onClick={submit}
          >
            {busy ? 'Saving…' : pack ? 'Save pack' : 'Add pack'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NewTemplateModal({
  packs,
  defaultPackId,
  lockPack,
  onClose,
  onSubmit,
}: {
  packs: AdminPack[]
  defaultPackId: string
  lockPack: boolean
  onClose: () => void
  onSubmit: (packId: string, name: string, file: File) => Promise<void>
}) {
  const [packId, setPackId] = useState(defaultPackId)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeClose(onClose, !busy)

  const selectedPack = packs.find((p) => p.id === packId) ?? null
  const fileName = file?.name ?? ''

  const submit = async () => {
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed || !file || !packId) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(packId, trimmed, file)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-template-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-card shadow-2xl sm:rounded-2xl"
      >
        <div className="flex flex-none items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="new-template-title" className="text-lg font-bold">
              New template
            </h2>
            <p className="text-xs text-dim">
              {lockPack ? `Add to "${selectedPack?.name ?? 'pack'}".` : 'Upload an image and assign it to a pack.'}
            </p>
          </div>
          <button className="ghost px-2 py-1" onClick={onClose} disabled={busy} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {error && (
            <div className="error-banner mb-0 flex items-start justify-between gap-2" role="alert">
              <span className="min-w-0">{error}</span>
              <button type="button" className="ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}

          <div className="grid gap-3">
            {lockPack ? (
              <p className="text-xs text-dim">
                Pack: <span className="font-semibold text-ink">{selectedPack?.name ?? '—'}</span>
              </p>
            ) : (
              <label className="block text-xs text-dim">
                Pack
                <select
                  value={packId}
                  onChange={(e) => setPackId(e.target.value)}
                  className="mt-1 w-full"
                  required
                >
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-xs text-dim">
              Name
              <input
                autoFocus
                value={name}
                maxLength={60}
                required
                placeholder="Template name"
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full"
              />
            </label>

            <label className="block text-xs text-dim">
              Image
              <input
                type="file"
                accept={UPLOAD_ACCEPT}
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full"
              />
              {fileName && <span className="mt-1 block truncate text-[11px] text-dim">{fileName}</span>}
            </label>
          </div>
        </form>

        <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line bg-card2/40 px-4 py-3">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            type="button"
            disabled={!name.trim() || !file || !packId || busy}
            onClick={submit}
          >
            {busy ? 'Adding…' : 'Add template'}
          </button>
        </div>
      </div>
    </div>
  )
}
