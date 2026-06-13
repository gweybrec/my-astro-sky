[English version](README.md)

# MyAstroSky

[![CI](https://github.com/gweybrec/my-astro-sky/actions/workflows/ci.yml/badge.svg)](https://github.com/gweybrec/my-astro-sky/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Application web pour superposer des astrophotographies sur une carte du ciel interactive avec résolution de plaque automatique.

→ [Guide utilisateur](docs/user/user-guide.md) · [Architecture](docs/dev/architecture.md) · [Distribution](docs/dev/distribution.md)

---

## Prérequis

- Node.js 24+ et npm 10+
- **Solveur de plaque (optionnel)** : ASTAP et la résolution en ligne (nova.astrometry.net) fonctionnent sur Linux, macOS et Windows. `solve-field` est réservé à Linux — sur Windows, l'option est automatiquement masquée dans l'interface.

## Installation

```bash
git clone https://github.com/gweybrec/my-astro-sky.git
cd my-astro-sky
npm install
```

## Catalogue d'étoiles

Le dépôt inclut `public/data/stars.14.json` (~118 k étoiles, mag ≤ 14). Le serveur l'utilise automatiquement — aucun téléchargement ni configuration nécessaire.

## Démarrer

```bash
# Développement (Vite sur :5173 + Express sur :3001, rechargement automatique)
npm run dev

# Build de production
npm run build
npx tsx server/index.ts   # accessible sur :3001
```

## Docker

```bash
docker compose up --build
# Ouvrir http://localhost:3001
```

## Tests

```bash
npm test
```

---

Voir le [guide utilisateur](docs/user/user-guide.md) pour l'installation des solveurs de plaque (ASTAP, solve-field), la documentation des fonctionnalités et les détails de déploiement.
