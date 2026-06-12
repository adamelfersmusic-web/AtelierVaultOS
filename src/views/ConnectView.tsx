import { useState } from 'react'
import {
  connectWithToken,
  dismissOAuthNotices,
  lastVaultUrl,
  startOAuth,
  useStore,
} from '../lib/store'
import { navigate } from '../lib/router'

// The vault this app is built for — editable, and the last-used URL wins.
const DEFAULT_VAULT_URL = 'https://friends.parachute.computer/vault/jonathan'

export function ConnectView() {
  const { oauthError, approveUrl } = useStore()
  const [url, setUrl] = useState(() => lastVaultUrl() ?? DEFAULT_VAULT_URL)
  const [advanced, setAdvanced] = useState(false)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState<'oauth' | 'token' | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const error = localError ?? oauthError

  const validateUrl = (): string | null => {
    const u = url.trim()
    if (!u) {
      setLocalError('Enter your vault URL')
      return null
    }
    return u
  }

  const oauth = async () => {
    setLocalError(null)
    dismissOAuthNotices()
    const u = validateUrl()
    if (!u) return
    setBusy('oauth')
    try {
      await startOAuth(u) // navigates away to the hub on success
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const tokenConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    dismissOAuthNotices()
    const u = validateUrl()
    if (!u) return
    if (!token.trim()) {
      setLocalError('Paste a vault:write token from your hub')
      return
    }
    setBusy('token')
    try {
      await connectWithToken(u, token)
      navigate({ kind: 'scripts' })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="connect">
      <div className="connect-glow" aria-hidden="true" />
      <form className="connect-card" onSubmit={tokenConnect}>
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
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            name="vault-url"
          />
        </label>

        {approveUrl ? (
          <div className="approve-box" data-testid="approve-box">
            <p className="approve-title">One more step — approve this app</p>
            <p className="approve-text">
              Your hub hasn’t seen Atelier before. Open the approval page,
              approve it, then sign in again.
            </p>
            <a
              className="btn btn-gold approve-link"
              href={approveUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="approve-link"
            >
              Open approval page ↗
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void oauth()}
              data-testid="approve-retry"
            >
              I’ve approved — sign in again
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-gold connect-btn"
            disabled={busy !== null}
            onClick={() => void oauth()}
            data-testid="connect-oauth"
          >
            {busy === 'oauth' ? 'Heading to your hub…' : 'Connect with OAuth'}
          </button>
        )}

        {error && <div className="connect-error">{error}</div>}

        <div className="connect-divider">
          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setAdvanced((a) => !a)}
            data-testid="advanced-toggle"
          >
            Advanced {advanced ? '▴' : '▾'}
          </button>
        </div>

        {advanced && (
          <div className="advanced-pane">
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
            <button
              className="btn btn-ghost connect-btn"
              disabled={busy !== null}
              data-testid="connect-token"
            >
              {busy === 'token' ? 'Connecting…' : 'Connect with token'}
            </button>
          </div>
        )}

        <p className="connect-note">
          Sign-in happens on your hub — Atelier never sees your password. The
          session (and any pasted token) lives only in this browser’s
          localStorage; Disconnect wipes it.
        </p>
      </form>
    </div>
  )
}
