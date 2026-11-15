'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }
      router.push('/admin')
    } catch {
      setError('Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container">
      <div className="panel" style={{ maxWidth: 380, margin: '80px auto' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Meme Battle Admin</h1>
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            <input
              type="email"
              value={email}
              placeholder="Email"
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <input
              type="password"
              value={password}
              placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="ghost" onClick={() => router.replace('/')}>
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
