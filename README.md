[Version française](README.fr.md)

# MyAstroSky

[![CI](https://github.com/gweybrec/my-astro-sky/actions/workflows/ci.yml/badge.svg)](https://github.com/gweybrec/my-astro-sky/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Web application for overlaying astrophotographs onto an interactive sky map with automatic plate solving.

→ [User guide](docs/user/user-guide.md) · [Architecture](docs/dev/architecture.md) · [Distribution](docs/dev/distribution.md)

---

## Prerequisites

- Node.js 24+ and npm 10+
- **Plate solver (optional)**: ASTAP and online solving (nova.astrometry.net) work on Linux, macOS, and Windows. `solve-field` is Linux-only — on Windows it is automatically hidden in the UI.

## Installation

```bash
git clone https://github.com/gweybrec/my-astro-sky.git
cd my-astro-sky
npm install
```

## Star catalog

The repository ships with `public/data/stars.14.json` (~118k stars, mag ≤ 14). The server uses it automatically — no download or configuration needed.

## Run

```bash
# Development (Vite on :5173 + Express on :3001, hot reload)
npm run dev

# Production build
npm run build
npx tsx server/index.ts   # serves on :3001
```

## Docker

```bash
docker compose up --build
# Open http://localhost:3001
```

## Tests

```bash
npm test
```

---

See the [user guide](docs/user/user-guide.md) for plate solver installation (ASTAP, solve-field), feature documentation, and deployment details.
