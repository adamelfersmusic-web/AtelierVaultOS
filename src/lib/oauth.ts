// OAuth 2.1 + PKCE (S256) + RFC 8414 discovery + RFC 7591 dynamic client
// registration against a Parachute hub/vault. Ported from the proven
// JonathanParachuteSurface implementation against this same hub.
//
// Flow:
//   1. beginOAuth(vaultUrl): discover AS metadata at
//      {vaultUrl}/.well-known/oauth-authorization-server, DCR a public client
//      (cached per issuer+redirect), generate PKCE, stash pending state, and
//      return the authorize URL to redirect the browser to.
//   2. The hub redirects back to our redirect_uri (the app's own index URL)
//      with ?code&state.
//   3. completeOAuth(code, state): POST the code + PKCE verifier to the token
//      endpoint, returning the token response + the pending state.
//   4. refreshAccessToken(): refresh_token grant with rotation.

const CLIENT_NAME = 'Atelier Vault OS'
const PENDING_KEY = 'atelier.oauth.pending'
const CLIENTS_KEY = 'atelier.oauth.clients' // { [issuer|redirectUri]: client_id }

export type TokenScope = string
export const DEFAULT_SCOPE: TokenScope = 'vault:read vault:write'

/** Persisted token envelope. */
export interface StoredToken {
  accessToken: string
  refreshToken?: string
  /** Epoch ms; absent for pasted tokens (never proactively refreshed). */
  expiresAt?: number
  scope?: TokenScope
  vault?: string
}

/** RFC 8414 Authorization Server metadata (the subset we use). */
export interface AuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  code_challenge_methods_supported?: string[]
}

/** Token-endpoint response (RFC 6749 §4.1.4 + hub `services`/`vault` extensions). */
export interface TokenResponse {
  access_token: string
  token_type: string
  scope?: TokenScope
  vault?: string
  refresh_token?: string
  expires_in?: number
  services?: Record<string, { url?: string } | undefined>
}

/** PKCE + flow state stashed in sessionStorage between redirect and callback. */
export interface PendingOAuth {
  issuerUrl: string
  issuer: string
  tokenEndpoint: string
  clientId: string
  codeVerifier: string
  state: string
  redirectUri: string
  scope: TokenScope
  startedAt: string
}

// --- secure-context guard (Web Crypto needs HTTPS or localhost) --------------
export class InsecureContextError extends Error {
  constructor() {
    super(
      'OAuth needs a secure context (HTTPS or http://localhost). Web Crypto ' +
        'isn’t available here — load the app over HTTPS, or use Advanced → paste token.',
    )
    this.name = 'InsecureContextError'
  }
}

// Thrown when the hub requires admin approval of this client before sign-in
// can complete. Carries the approval URL the operator must visit.
export class PendingApprovalError extends Error {
  approveUrl: string
  constructor(approveUrl: string) {
    super('This app needs hub approval before sign-in can complete.')
    this.name = 'PendingApprovalError'
    this.approveUrl = approveUrl
  }
}

function assertCrypto() {
  if (
    typeof crypto === 'undefined' ||
    !crypto.subtle?.digest ||
    typeof crypto.getRandomValues !== 'function'
  ) {
    throw new InsecureContextError()
  }
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase64Url(byteLen: number): string {
  assertCrypto()
  const buf = new Uint8Array(byteLen)
  crypto.getRandomValues(buf)
  return base64Url(buf)
}

async function deriveChallenge(verifier: string): Promise<string> {
  assertCrypto()
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(hash))
}

// --- URL normalization --------------------------------------------------------
export function normalizeVaultUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Vault URL is required')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('Not a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Vault URL must use http or https')
  }
  parsed.hash = ''
  parsed.search = ''
  parsed.host = parsed.host.toLowerCase()
  let path = parsed.pathname.replace(/\/+$/, '')
  for (const suffix of [
    '/api',
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/oauth/authorize',
    '/oauth/token',
    '/oauth/register',
  ]) {
    if (path.toLowerCase().endsWith(suffix)) {
      path = path.slice(0, -suffix.length)
      break
    }
  }
  parsed.pathname = path || ''
  return parsed.toString().replace(/\/$/, '')
}

// The redirect URI is the app's own served index URL, computed at runtime so it
// works at any GitHub Pages subpath without hardcoding the repo name. The hub
// redirects back here with ?code&state; index.html is served and the app
// detects it on load.
export function redirectUri(): string {
  const { origin, pathname } = window.location
  const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '')
  return `${origin}${dir}`
}

// --- discovery + DCR -----------------------------------------------------------
async function discoverAuthServer(issuerUrl: string): Promise<AuthServerMetadata> {
  const url = `${issuerUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (err) {
    throw new Error(`Could not reach the hub at ${issuerUrl}: ${(err as Error).message}`)
  }
  if (!res.ok) {
    throw new Error(`Discovery failed (${res.status}). Is this a Parachute vault URL? Tried ${url}`)
  }
  const data = (await res.json()) as AuthServerMetadata
  for (const field of [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'registration_endpoint',
  ] as const) {
    if (typeof data[field] !== 'string' || !data[field]) {
      throw new Error(`Discovery response missing ${field}`)
    }
  }
  if (!data.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('Hub does not advertise S256 PKCE — cannot complete OAuth safely.')
  }
  return data
}

async function registerClient(registrationEndpoint: string, redirect: string): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // Sends the hub session cookie when same-origin so the hub can auto-approve.
    credentials: 'include',
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!res.ok) {
    throw new Error(`Client registration failed (${res.status}): ${await res.text()}`)
  }
  const data = (await res.json()) as { client_id?: string }
  if (!data.client_id) throw new Error('Registration response missing client_id')
  return data.client_id
}

// --- pending + client-id storage ------------------------------------------------
function savePending(p: PendingOAuth) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
}
export function loadPending(): PendingOAuth | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as PendingOAuth) : null
  } catch {
    return null
  }
}
export function clearPending() {
  sessionStorage.removeItem(PENDING_KEY)
}

function clientCacheKey(issuer: string, redirect: string) {
  return `${issuer}|${redirect}`
}
function loadCachedClientId(issuer: string, redirect: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(CLIENTS_KEY) || '{}')
    return map[clientCacheKey(issuer, redirect)] ?? null
  } catch {
    return null
  }
}
function saveCachedClientId(issuer: string, redirect: string, clientId: string) {
  let map: Record<string, string> = {}
  try {
    map = JSON.parse(localStorage.getItem(CLIENTS_KEY) || '{}')
  } catch {
    /* ignore */
  }
  map[clientCacheKey(issuer, redirect)] = clientId
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(map))
}
export function clearCachedClients() {
  localStorage.removeItem(CLIENTS_KEY)
}

// --- the flow --------------------------------------------------------------------
export async function beginOAuth(
  vaultInput: string,
  scope: TokenScope = DEFAULT_SCOPE,
): Promise<string> {
  const issuerUrl = normalizeVaultUrl(vaultInput)
  const redirect = redirectUri()
  const metadata = await discoverAuthServer(issuerUrl)

  let clientId = loadCachedClientId(metadata.issuer, redirect)
  if (!clientId) {
    clientId = await registerClient(metadata.registration_endpoint, redirect)
    saveCachedClientId(metadata.issuer, redirect, clientId)
  }

  const codeVerifier = randomBase64Url(32)
  const codeChallenge = await deriveChallenge(codeVerifier)
  const state = randomBase64Url(16)

  savePending({
    issuerUrl,
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    codeVerifier,
    state,
    redirectUri: redirect,
    scope,
    startedAt: new Date().toISOString(),
  })

  const authorize = new URL(metadata.authorization_endpoint)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', redirect)
  authorize.searchParams.set('code_challenge', codeChallenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('scope', scope)
  return authorize.toString()
}

function parsePendingApproval(text: string): string | null {
  try {
    const body = JSON.parse(text)
    if (body?.error === 'invalid_client' && typeof body.approve_url === 'string') {
      const u = new URL(body.approve_url)
      if (u.protocol === 'http:' || u.protocol === 'https:') return body.approve_url
    }
  } catch {
    /* not JSON */
  }
  return null
}

export async function completeOAuth(
  code: string,
  state: string,
): Promise<{ pending: PendingOAuth; token: TokenResponse }> {
  const pending = loadPending()
  if (!pending) {
    throw new Error('No pending sign-in flow. Start again from the connect screen.')
  }
  if (pending.state !== state) {
    clearPending()
    throw new Error('Sign-in state mismatch. The flow was interrupted; please try again.')
  }

  const res = await fetch(pending.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.codeVerifier,
      client_id: pending.clientId,
      redirect_uri: pending.redirectUri,
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    clearPending()
    const approveUrl = parsePendingApproval(text)
    if (approveUrl) throw new PendingApprovalError(approveUrl)
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const token = (await res.json()) as TokenResponse
  if (!token.access_token) {
    clearPending()
    throw new Error('Token response missing access_token')
  }
  clearPending()
  return { pending, token }
}

// Refresh-token grant (RFC 6749 §6) with rotation: the response carries a new
// refresh_token that supersedes the old one — the caller must persist it.
export async function refreshAccessToken(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`)
  const token = (await res.json()) as TokenResponse
  if (!token.access_token) throw new Error('Refresh response missing access_token')
  return token
}

export function storedFromTokenResponse(token: TokenResponse, now = Date.now()): StoredToken {
  const stored: StoredToken = { accessToken: token.access_token }
  if (token.scope !== undefined) stored.scope = token.scope
  if (token.vault !== undefined) stored.vault = token.vault
  if (token.refresh_token) stored.refreshToken = token.refresh_token
  if (typeof token.expires_in === 'number') stored.expiresAt = now + token.expires_in * 1000
  return stored
}

// Resolve the vault's API base from a token response. Hub-issued tokens carry a
// `services` catalog (trust the hub's URL over what the user typed, and prefer
// the per-vault key); standalone-vault tokens fall back to the issuer URL.
export function resolveVaultUrl(token: TokenResponse, fallbackIssuerUrl: string): string {
  const perVaultKey = token.vault ? `vault:${token.vault}` : undefined
  return (
    (perVaultKey ? token.services?.[perVaultKey]?.url : undefined) ??
    token.services?.['vault']?.url ??
    fallbackIssuerUrl
  )
}
