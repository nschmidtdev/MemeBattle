'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { imageUrl } from '@/lib/images'
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

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data
}

export default function AdminPanel({ email }: Props) {
  const router = useRouter()
  const [packs, setPacks] = useState<AdminPack[] | null>(null)
  const [templates, setTemplates] = useState<AdminTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminTemplate | null>(null)

  // new pack form
  const [newPackName, setNewPackName] = useState('')
  const [newPackDesc, setNewPackDesc] = useState('')
  // per-pack new template form
  const [newTpl, setNewTpl] = useState<Record<string, { name: string; file: File | null }>>({})

  const load = useCallback(async () => {
    try {
      const [packData, tplData] = await Promise.all([
        api('/api/packs'),
        api('/api/templates'),
      ])
      setPacks(packData.packs)
      setTemplates(tplData.templates)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
        <p className="muted">Loading…</p>
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
            disabled={!newPackName.trim()}
            onClick={() =>
              run(async () => {
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
              })
            }
          >
            Add pack
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
            <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => load()} />
          )}

          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted">New template:</span>
            <input
              value={newTpl[p.id]?.name ?? ''}
              maxLength={60}
              placeholder="Template name"
              onChange={(e) => setNewTpl({ ...newTpl, [p.id]: { name: e.target.value, file: newTpl[p.id]?.file ?? null } })}
              style={{ width: 180 }}
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setNewTpl({ ...newTpl, [p.id]: { name: newTpl[p.id]?.name ?? '', file: e.target.files?.[0] ?? null } })}
            />
            <button
              className="primary"
              disabled={!newTpl[p.id]?.name?.trim() || !newTpl[p.id]?.file}
              onClick={() =>
                run(async () => {
                  const form = new FormData()
                  form.append('file', newTpl[p.id]!.file!)
                  const up = await api('/api/upload', { method: 'POST', body: form })
                  await api('/api/templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      packId: p.id,
                      name: newTpl[p.id]!.name.trim(),
                      imageKey: up.key,
                    }),
                  })
                  setNewTpl({ ...newTpl, [p.id]: { name: '', file: null } })
                  await load()
                })
              }
            >
              Add template
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
