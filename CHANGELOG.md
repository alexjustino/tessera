# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Tasks**: create, complete, rename, reorder and delete, stored in SQLite and
  still there after a restart. The first feature that crosses every layer.
- Item repository with transactional writes that keep the full-text index in step.
- `Input`, `Checkbox` and `EmptyState` design system primitives.
- Project foundation: Tauri 2 + React + TypeScript + Vite + Tailwind skeleton.
- Apache-2.0 licence, NOTICE with trademark statement, contributor documentation.
- Fluent design token layer, Mica window material, system accent colour, custom title bar.
- SQLite persistence with forward-only migrations (`001_init`).
- Windows toast notification path with action buttons, proven from an installed build.
- Validation gates (`npm run gates`) and CI running the same script.
- Full specification, data model, architecture decisions and design system contract.

[Unreleased]: https://github.com/alexjustino/tessera/compare/main...HEAD
