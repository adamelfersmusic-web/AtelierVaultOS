import { useState } from 'react'
import { connect } from '../lib/store'
import { navigate } from '../lib/router'

export function ConnectView() {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const u = url.trim()
    if (!/^https?:\/\//.test(u)) {
      setError('The vault URL should start with https://')
      return
    }
    if (!token.trim()) {
      setError('Paste a vault:write token from your hub')
      return
    }
    setBusy(true)
    try {
      await connect(u, token)
      navigate({ kind: 'scripts' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connect">
      <div className="connect-glow" aria-hidden="true" />
      <form className="connect-card" onSubmit={submit}>
        <div className="connect-brand">
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M16 4.5 27.5 16 16 27.5 4.5 16Z"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="2"
            />
            <circle cx="16" cy="16" r="2.8" fill="var(--gold)" />
          </svg>
          <h1 className="connect-title">Atelier</h1>
          <p className="connect-sub">a studio for your vault</p>
        </div>

        <label className="field">
          <span className="field-label">Vault URL</span>
          <input
            className="field-input"
            type="url"
            placeholder="https://your-hub/vault/your-name"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            name="vault-url"
          />
        </label>

        <label className="field">
          <span className="field-label">
            Access token
            <button
              type="button"
              className="field-toggle"
              onClick={() => setShowToken((s) => !s)}
            >
              {showToken ? 'hide' : 'show'}
            </button>
          </span>
          <textarea
            className={`field-input field-token${showToken ? '' : ' is-masked'}`}
            placeholder="paste a vault:write hub JWT"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            spellCheck={false}
            name="vault-token"
          />
        </label>

        {error && <div className="connect-error">{error}</div>}

        <button className="btn btn-gold connect-btn" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>

        <p className="connect-note">
          Stored only in this browser’s localStorage and sent as{' '}
          <code>Authorization: Bearer</code> on every request. Disconnect wipes
          both.
        </p>
      </form>
    </div>
  )
}
