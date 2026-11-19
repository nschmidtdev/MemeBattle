'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UPLOAD_ACCEPT, imageUrl } from '@/lib/images'
import TemplateEditor, { type AdminTemplate } from './TemplateEditor'

interface AdminPack {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  isActive: boolean
  sortOrder: number
  templateCount: number
  activeTemplateCount: number
}

interface Props {
  email: string
}

export default function AdminPanel({ email }: Props) {
  const router = useRouter()
  const [packs, setPacks] = useState<AdminPack[] | null>(null)
  const [templates, setTemplates] = useState<AdminTemplate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminTemplate | null>(null)
  const [addingPack, setAddingPack] = useState(false)
  const [addingTemplate, setAddingTemplate] = useState<string | null>(null)

  // new pack form
  const [newPackName, setNewPackName] = useState('')
  const [newPackDesc, setNewPackDesc] = useState('')
  // per-pack new template form
  const [newTpl, setNewTpl] = useState<Record<string, { name: string; file: File | null }>>({})

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

  if (packs === null || templates === null) {
    return (
      <div className="container">
        <h1>Admin</h1>
        {error && (
          <div className="error-banner row spread">
            <span>{error}</span>
            <button className="ghost" disabled={loading} onClick={() => load()}>
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          !error && <p className="muted">No data.</p>
        )}
      </div>
    )
  }

  const templatesFor = (packId: string) => templates.filter((t) => t.packId === packId)

  return (
    <div>
      <div className="row spread" style={{ margin: '12px 0' }}>
        <h1 style={{ margin: 0 }}>Meme Battle Admin</h1>
        <div className="row" style={{ gap: 10 }}>
          <span className="muted">{email}</span>
          <button className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner row spread">
          <span>{error}</span>
          <button className="ghost" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="panel">
        <h2>New pack</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            value={newPackName}
            maxLength={60}
            placeholder="Pack name"
            onChange={(e) => setNewPackName(e.target.value)}
            style={{ width: 200 }}
          />
          <input
            value={newPackDesc}
            maxLength={140}
            placeholder="Description (optional)"
            onChange={(e) => setNewPackDesc(e.target.value)}
            style={{ width: 260 }}
          />
          <button
            className="primary"
            disabled={!newPackName.trim() || addingPack}
            onClick={() => {
              if (addingPack) return
              run(async () => {
                setAddingPack(true)
                try {
                  await api('/api/packs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: newPackName.trim(),
                      description: newPackDesc.trim() || null,
                    }),
                  })
                  setNewPackName('')
                  setNewPackDesc('')
                  await load()
                } finally {
                  setAddingPack(false)
                }
              })
            }}
          >
            {addingPack ? 'Adding…' : 'Add pack'}
          </button>
        </div>
      </div>

      {packs.map((p) => (
        <div key={p.id} className="panel" style={{ marginTop: 14 }}>
          <div className="row spread">
            <div>
              <h2 style={{ margin: 0 }}>
                {p.name}{' '}
                <span className={`badge${p.isPublic ? ' live' : ''}`}>{p.isPublic ? 'public' : 'hidden'}</span>{' '}
                <span className={`badge${p.isActive ? ' live' : ''}`}>{p.isActive ? 'active' : 'off'}</span>{' '}
                <span className="badge">
                  {p.activeTemplateCount}/{p.templateCount} templates
                </span>
              </h2>
              {p.description && <p className="muted">{p.description}</p>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button
                className="ghost"
                onClick={() =>
                  run(async () => {
                    await api(`/api/packs/${p.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ isPublic: !p.isPublic }),
                    })
                    await load()
                  })
                }
              >
                {p.isPublic ? 'Hide' : 'Make public'}
              </button>
              <button
                className="ghost"
                onClick={() =>
                  run(async () => {
                    await api(`/api/packs/${p.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ isActive: !p.isActive }),
                    })
                    await load()
                  })
                }
              >
                {p.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (!confirm(`Delete pack "${p.name}" and all its templates?`)) return
                  run(async () => {
                    await api(`/api/packs/${p.id}`, { method: 'DELETE' })
                    await load()
                  })
                }}
              >
                Delete
              </button>
            </div>
          </div>

          <table className="admin-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Image</th>
                <th>Name</th>
                <th>Type</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templatesFor(p.id).map((t) => (
                <tr key={t.id}>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail for arbitrary uploaded images */}
                    <img
                      className="thumb"
                      src={imageUrl(t.imageKey)}
                      alt=""
                      width={56}
                      height={56}
                      style={{ objectFit: 'cover' }}
                    />
                  </td>
                  <td>{t.name}</td>
                  <td>
                    <span className="badge">{t.isFreeform ? 'freeform' : `fixed (${t.boxes.length} boxes)`}</span>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.isActive}
                      onChange={() =>
                        run(async () => {
                          await api(`/api/templates/${t.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: !t.isActive }),
                          })
                          await load()
                        })
                      }
                    />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="ghost" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          if (!confirm(`Delete template "${t.name}"?`)) return
                          run(async () => {
                            await api(`/api/templates/${t.id}`, { method: 'DELETE' })
                            if (editing?.id === t.id) setEditing(null)
                            await load()
                          })
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {templatesFor(p.id).length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No templates yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {editing?.packId === p.id && (
            <TemplateEditor
              key={editing.id}
              template={editing}
              onClose={() => setEditing(null)}
              onSaved={() => load()}
              onReload={reloadTemplate}
            />
          )}

          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted">New template:</span>
            <input
              value={newTpl[p.id]?.name ?? ''}
              maxLength={60}
              placeholder="Template name"
              onChange={(e) =>
                setNewTpl((prev) => ({
                  ...prev,
                  [p.id]: { name: e.target.value, file: prev[p.id]?.file ?? null },
                }))
              }
              style={{ width: 180 }}
            />
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              onChange={(e) =>
                setNewTpl((prev) => ({
                  ...prev,
                  [p.id]: { name: prev[p.id]?.name ?? '', file: e.target.files?.[0] ?? null },
                }))
              }
            />
            <button
              className="primary"
              disabled={!newTpl[p.id]?.name?.trim() || !newTpl[p.id]?.file || addingTemplate !== null}
              onClick={() => {
                if (addingTemplate) return
                const name = newTpl[p.id]?.name.trim() ?? ''
                const file = newTpl[p.id]?.file
                if (!name || !file) return
                run(async () => {
                  setAddingTemplate(p.id)
                  try {
                    const form = new FormData()
                    form.append('file', file)
                    const up = await api('/api/upload', { method: 'POST', body: form })
                    await api('/api/templates', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        packId: p.id,
                        name,
                        imageKey: up.key,
                      }),
                    })
                    setNewTpl((prev) => ({ ...prev, [p.id]: { name: '', file: null } }))
                    await load()
                  } finally {
                    setAddingTemplate(null)
                  }
                })
              }}
            >
              {addingTemplate === p.id ? 'Adding…' : 'Add template'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
