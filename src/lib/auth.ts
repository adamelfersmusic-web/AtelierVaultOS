// Holds the live session and owns the token lifecycle: hands the API a valid
// access token (refreshing proactively when one is near expiry), refreshes
// reactively on a 401, and persists every rotation. Ported from the proven
// JonathanParachuteSurface AuthManager.

import {
  refreshAccessToken,
  storedFromTokenResponse,
  type StoredToken,
} from './oauth'

export interface AuthSession {
  /** Base for /api calls, e.g. https://hub/vault/jonathan */
  vaultUrl: string
  /** 'oauth' sessions carry refresh material; 'token' = pasted bearer. */
  mode: 'oauth' | 'token'
  issuer?: string
  tokenEndpoint?: string
  clientId?: string
  token: StoredToken
}

export class AuthManager {
  private session: AuthSession
  private onRotate: (session: AuthSession) => void
  private refreshing: Promise<boolean> | null = null

  constructor(session: AuthSession, onRotate: (s: AuthSession) => void) {
    this.session = session
    this.onRotate = onRotate
  }

  get current(): AuthSession {
    return this.session
  }

  get vaultBase(): string {
    return this.session.vaultUrl
  }

  private canRefresh(): boolean {
    const t = this.session.token
    return Boolean(t.refreshToken && this.session.tokenEndpoint && this.session.clientId)
  }

  private nearExpiry(): boolean {
    const exp = this.session.token.expiresAt
    // 30s skew. No expiry recorded (e.g. a pasted token) → never proactively refresh.
    return typeof exp === 'number' && Date.now() > exp - 30_000
  }

  /** Returns a usable access token, refreshing first if it's about to expire. */
  async getAccessToken(): Promise<string> {
    if (this.canRefresh() && this.nearExpiry()) await this.tryRefresh()
    return this.session.token.accessToken
  }

  /** Attempt a single refresh; concurrent callers share one in-flight refresh. */
  async tryRefresh(): Promise<boolean> {
    if (!this.canRefresh()) return false
    if (this.refreshing) return this.refreshing

    this.refreshing = (async () => {
      try {
        const res = await refreshAccessToken(
          this.session.tokenEndpoint!,
          this.session.clientId!,
          this.session.token.refreshToken!,
        )
        const stored = storedFromTokenResponse(res)
        // Rotation: keep the prior refresh token if the response omits one.
        if (!stored.refreshToken) stored.refreshToken = this.session.token.refreshToken
        this.session = { ...this.session, token: stored }
        this.onRotate(this.session)
        return true
      } catch {
        return false
      } finally {
        this.refreshing = null
      }
    })()

    return this.refreshing
  }
}
