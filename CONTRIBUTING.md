# Contributing

Thanks for your interest in `dsh-novel-reader`!

## Development setup

This plugin is **pure JavaScript** — no TypeScript, no build step.

```bash
# 1. Point your DSH web profile at the local checkout (or symlink it)
cd <dsh-home>/profiles/web
pnpm add file:<this-repo-path>

# 2. Add the bundle to the profile
#    append "dsh-novel-reader" to dsh.profile.bundles in package.json

# 3. Restart DSH-Web. Client-half changes hot-reload via client-hmr;
#    host-half (lib/) changes need a backend restart.
```

## Project layout

| Path | Responsibility |
| --- | --- |
| `lib/index.js` | Host half: `/novel/*` same-origin API (TOC / chapter / search) |
| `client/client.js` | Client half: floating reader UI (`window.__ModuleLoader__` bundle) |
| `cordis.patch.yml` | Bundle mount patch (loader entry insert) |
| `lib/types/index.d.ts` | Public type declarations for consumers |

## Conventions

- Keep the client bundle dependency-light: it may only `require` modules that
  DSH's web loader provides (`react`, `react-dom`, `react/jsx-runtime`).
- Style the UI with DSH design tokens (`--dsw-alias-*`) so light/dark themes
  keep working; no hard-coded palette.
- Host routes must stay SSRF-safe: only the configured upstream host is
  proxiable.

## Release

```bash
npm run publish:patch   # bumps version and publishes to npm
```
