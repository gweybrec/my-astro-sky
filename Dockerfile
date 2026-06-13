# --- Build stage ---
# Produces the static frontend in /app/dist (includes public/data/* copied by Vite).
# Type-checking is the CI's job (ci.yml); the image only needs the build artifacts,
# so we run `vite build` directly instead of `npm run build` (which also type-checks
# the server and would require the full server toolchain here).
FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Everything Vite needs to build the frontend bundle.
COPY index.html vite.config.ts uno.config.ts tsconfig.json ./
COPY src/ src/
COPY public/ public/

RUN npx vite build

# --- Production stage ---
FROM node:24-slim AS production

# better-sqlite3 and sharp may need build tools for native compilation when no
# prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

# Install runtime deps only. --ignore-scripts skips the root `postinstall`
# (patch-package, a devDependency that is absent here); the native modules are
# then built explicitly with `npm rebuild`.
RUN npm ci --omit=dev --ignore-scripts \
  && npm rebuild better-sqlite3 sharp

# The server runs as TypeScript via tsx (no transpile step). tsx is declared as a
# runtime dependency so it is present after `npm ci --omit=dev`.
COPY server/ server/
COPY resources/ resources/
COPY tsconfig.json tsconfig.server.json ./
COPY --from=build /app/dist dist/

RUN mkdir -p /data uploads

ENV PORT=3001
ENV DB_PATH=/data/data.db
# Catalog assets live under dist/data (Vite copied public/data there at build time).
# The server resolves catalogs relative to public/data by default, which does not
# exist in this image, so point it at dist/data explicitly.
ENV PUBLIC_DATA_DIR=/app/dist/data
ENV STAR_CATALOG_PATH=/app/dist/data/stars.14.json

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
