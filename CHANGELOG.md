# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Continuous deployment: automatic `npm publish` from the `main` branch
  (see `.github/workflows/publish.yml`).

## [0.1.0] - 2026-08-17

### Added

- Floating translucent-white launcher button; draggable anywhere, click to open.
- Resizable reader panel: drag any edge/corner to resize, drag header to move;
  position and size are remembered across sessions.
- Esc closes the panel.
- Chapter reader with clean typography, multi-page chapter merging, and
  prev/next chapter navigation with background prefetch.
- Reading progress persistence (chapter URL + in-chapter scroll position).
- Bookshelf (收藏书架) with continue-reading and recent-history lists.
- Paginated table of contents (20 chapters/page), auto-located to the current
  chapter's page, with direct page-number jumps.
- Book search to switch novels by title.
- Host half `/novel/*` same-origin API (TOC / chapter / search) with SSRF
  allowlist restricted to the upstream host.
- UI styled with DSH design tokens (light/dark adaptive).

### Security

- Proxy routes allow only the configured upstream host, preventing SSRF.
