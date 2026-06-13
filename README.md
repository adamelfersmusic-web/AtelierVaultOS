# Atelier · Vault OS

A dark-mode studio for a [Parachute](https://parachute.computer) vault — built
around the **Scripts** database (`content/scripts/…`) with three lenses over
one dataset: **Table · Board · Gallery**. Every row opens a full page:
properties on top, the editable markdown body below. Full read/write — cell
edits, body edits, tag edits, and capture all land in the vault over its REST
API.

**Live app:** deployed to this repo's GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push
to `main`.

## Connecting

The app talks to the vault's HTTP API (`<vault-url>/api/...`) directly from
the browser — no server in between, no MCP.

**Connect with OAuth (default).** Enter your vault URL and click *Connect
with OAuth*: the app discovers the hub's authorization server (RFC 8414 at
`{vault}/.well-known/oauth-authorization-server`), dynamically registers
itself as a public client (RFC 7591, `token_endpoint_auth_method: none`,
cached per issuer+redirect), and sends you to the hub with PKCE (S256). You
sign in on the hub — the app never sees your password — approve, and land
back signed in. Sessions persist: the access token refreshes itself ~30s
before expiry (and reactively on a 401, with a silent replay), and every
refresh-token rotation is persisted, so you stay signed in as long as the
hub's refresh tokens live. If the hub wants the app approved first, the
approval link is surfaced in the UI — approve, then sign in again.

OAuth needs a secure context (the deployed HTTPS URL or `http://localhost`
in dev). The redirect URI is the app's own index URL, computed at runtime,
so it works at the GitHub Pages project subpath with nothing hardcoded.

**Advanced → paste token (fallback).** The v1 flow: paste a hub JWT with
`vault:write` scope (`parachute auth mint-token --scope vault:<name>:write`).
Pasted tokens are used as-is and never refreshed.

Everything auth lives only in this browser's localStorage and rides along as
`Authorization: Bearer …`. **Disconnect** (bottom of the sidebar) wipes the
session, refresh material, and cached client registrations. Existing v1
token-paste configs migrate automatically on first load.

## The Graph

`#/graph` renders the whole vault as a full-screen constellation —
**verification as light**. VERIFIED-CANON notes bloom gold; VERIFIED is
clear warm ivory; ANALYSIS-VERIFIED dims cooler; unverified matter is
faint, not yet condensed. Node size follows real link degree (3–14px), hub
labels appear from degree ≥ 8, provenance edges (`source_of` /
`derived_from` family) run faint gold and `supersedes` faint red. A pill
switcher remaps color across four axes — Verification · Domain · Type ·
Lifecycle — without moving a single node (a thin verification ring keeps
the light dimension present on every axis). D3-force layout is pre-run to
rest, the galaxy forms from center on load, and a ±0.3px sine drift keeps
it breathing. Hover for a tooltip, click to open the full note view in a
slide-in drawer, drag to pan, scroll to zoom, double-click to re-fit.

## How writes work

- Every mutation is a `PATCH` with optimistic concurrency: the note's
  last-known `updatedAt` is sent as `if_updated_at`. On a 409 the app
  reloads the note, re-applies your intent to the live version, and retries —
  it never clobbers.
- Body saves where the *content itself* diverged stop and ask: load theirs,
  or overwrite with yours.
- Metadata cell edits send only the changed keys (merged server-side) and
  never touch the note body. Script bodies may contain a stale `**Status:**`
  header line — the app ignores it entirely; metadata is the source of truth.
- Tag edits are full-replace from the UI's point of view, expressed to the
  vault as an `{add, remove}` diff.

### The Raw Layer Principle

Founder canon — `do-not-alter`, `transcript`, `brand-brain` tags, or
`voice: canon` — is never silently auto-written. The app has **no** automatic
writes anywhere (no autosave, no background reconciliation of content); and on
top of that, saving a body edit to a canon note requires an explicit
confirmation. Everything else is freely human-editable.

## Development

```bash
npm install
npm run mock     # local stand-in vault on http://127.0.0.1:8787 (token: atelier-test-token)
npm run dev      # the app
```

Connect the dev app to the mock with URL `http://127.0.0.1:8787` and the
token above — or to a real vault.

```bash
npm run build      # typecheck (tsc -b) + production build
npm run test:e2e   # full browser drive against the mock (run build first)
```

The same 14-scenario drive can run against a **genuine** parachute-vault
server (e.g. a local checkout booted with `VAULT_AUTH_TOKEN`, or a
hub-managed vault with a hub-minted JWT):

```bash
REAL_VAULT=http://127.0.0.1:8790/vault/<name> REAL_TOKEN=<bearer> npm run test:e2e
```

And the OAuth sign-in can be driven against a **genuine** Parachute hub +
vault stack running locally (real login form, consent screen, DCR, PKCE,
hub-signed JWTs):

```bash
REAL_HUB=1 npx playwright test e2e/real-hub.spec.ts
```

## Architecture

```
src/
  lib/        api.ts (REST client + OC retry) · store.ts (cache, write queue)
              router.ts (hash routes) · markdown, fuzzy, format
  domain/     scripts.ts — the Scripts DatabaseDef: fields, enum colors,
              lane order, defaults, canon rules. Add another def (e.g.
              people/lead) and render <DatabaseView def={…}/> to reuse the
              whole table/board/gallery stack on a different dataset.
  components/ chips, menus, popover, palette, toasts, tags, modal
  views/      DatabaseView (+ Table/Board/Gallery lenses), NotePage,
              LibraryView, ConnectView, NewScriptModal, Shell
e2e/          mock-vault.mjs (faithful REST stand-in) + drive.spec.ts
```

Indexed metadata fields (`status`, `conviction`, `recorded`, `published`,
`source`, `declined`, `approval_required`, `voice`, `verification`) are safe
to query server-side. `pillar` and `cta_level` are **not** indexed — the app
sorts and filters them in memory only and never issues a server-side
`order_by` or operator query on them.
