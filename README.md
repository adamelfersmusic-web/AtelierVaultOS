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

1. Open the app. You land on the connect screen.
2. Paste your vault URL (e.g. `https://<hub>/vault/<name>`).
3. Paste a hub JWT with `vault:write` scope, e.g.
   `parachute auth mint-token --scope vault:<name>:write`.
4. Connect. Both values live only in your browser's localStorage and ride
   along as `Authorization: Bearer …`. **Disconnect** (bottom of the sidebar)
   wipes them.

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
