# WP3.6 — The phone's adapters

Model: sonnet · Depends on: WP3.5 · Needs device: no · Needs browser: no

## Goal

The local backend needs, on the phone, what the server gets from Node: a place for picture files, a way to read and resize pictures, a way to reach the network, protection for the astrometry key, the catalogues, ZIP, and a way to hand a file to the user. Write these adapters in `packages/backend-local/src/`, each with a suite of checks that can run on the phone (the next card runs them on the real device). Write one function that assembles the whole phone backend.

## Rules for every adapter

- **No import of `@capacitor/*` in `packages/backend-local`.** Each adapter receives the plugin object it needs as a parameter, typed by a small interface declared in the adapter's file with only the methods used (as `capacitor-sqlite-db.ts` does with its connection). The phone's shell passes the real plugin.
- The package's `tsconfig.json` has the DOM library: `fetch`, `Blob`, `createImageBitmap`, `OffscreenCanvas`, `crypto.subtle` and `indexedDB` may be used.
- Each adapter reproduces the behaviour of the server's adapter listed below; read the server's file and its tests first (`server/blob-store.ts`, `server/image-codec.ts`, `server/http-client.ts`, `server/secret-codec.ts`, `tests/unit/image-adapters.test.ts`, `tests/unit/http-client.test.ts`).
- **Conformance suites** go in `packages/core/src/testing/`, written like `sql-db-conformance.ts` (named cases, own small assertions, no test framework), with a Vitest wrapper in `tests/helpers/`. Each suite runs in Node against the **server's** adapter in this card (which proves the suite), and on the phone against the phone's adapter in the next card. Fixtures (picture bytes) are passed in by the caller.

## Adapters

1. **Picture files** — `capacitor-blob-store.ts`: `createCapacitorBlobStore({ filesystem, convertFileSrc, fetch, directory, folder })` implementing `BlobStore`, plus `url(name): string`.
   - Files are stored flat (`<folder>/<name>`) in the app's private data directory, through the Filesystem plugin (`writeFile`, `appendFile`, `stat`, `deleteFile`, `mkdir`, `getUri`).
   - `put`: the plugin takes text in base64, so write in pieces of at most 1 MB of bytes (first piece `writeFile`, the next ones `appendFile`), encoding each piece on its own; never build one base64 text of the whole file. Create the folder on first use. A failed write removes the partial file and rejects.
   - `get`: read through `fetch(convertFileSrc(uri))` and `arrayBuffer()` (no base64). **Trap:** the phone's local server answers the app's `index.html` with status 200 for a path it does not know, so check existence with `stat` first and return `null` when the file is missing; never trust the status alone.
   - `size`: from `stat`, `null` when missing. `remove`: a missing file is not an error.
   - `url(name)`: synchronous. The adapter resolves the folder's address once (`init()` awaited by the assembler: `getUri` then `convertFileSrc`), then `url` is a text concatenation.
   - Suite `blob-store-conformance.ts`: put/get/size/remove, missing blob, overwrite, a 3 MB blob byte for byte (crosses the piece limit), an empty blob, names with the two forms the services use (`<id>.jpg`, `<id>_thumb.jpg`).
2. **Pictures** — `browser-image-codec.ts`: `createBrowserImageCodec()` implementing `ImageCodec` with `createImageBitmap` and `OffscreenCanvas`.
   - `probe`: the stored width and height (before any rotation) and the EXIF orientation. Read them from the file's header with a pure parser in core, `packages/core/src/image-header.ts` (JPEG: the SOF segment and the EXIF orientation tag; PNG: IHDR; WebP: the VP8/VP8L/VP8X header), unit-tested in Node with files made by `sharp`. Do not decode the picture for `probe`. Reject what is not one of these formats.
   - `bakeOrientation(bytes, ext)`: same accepted extensions as the server and the same error for the others. **When the orientation is absent or 1, return the bytes unchanged** (the phone keeps the original file; the server re-encodes, this difference is accepted). Otherwise draw with the orientation applied and encode in the same format (JPEG quality 0.9).
   - `thumbnail`: same size rule as the server (longer side at most `maxSize`, never enlarged, rounded, at least 1 px), JPEG at the given quality; decode directly at the reduced size (`createImageBitmap` with `resizeWidth`/`resizeHeight`) so a large picture is never held at full size.
   - `encode`: raw 1, 3 or 4 channels to JPEG or PNG. `decode`: to raw pixels; a canvas always gives 4 channels, which the port allows (`channels: 4`); check that the horizon service reads the channel count it is given and say so in the report.
   - Release every `ImageBitmap` (`close()`) and canvas as soon as it is used.
   - Suite `image-codec-conformance.ts`: compares sizes, format (by the file's first bytes), orientation applied (a picture with one coloured corner, checked within a tolerance after decoding) and never byte equality. The case "bytes unchanged without orientation" is optional per adapter (a flag of the suite), since the server re-encodes.
3. **Network** — `fetch-http-client.ts`: `createFetchHttpClient({ fetch })` implementing `HttpClient` exactly like `server/http-client.ts` (forms built with `FormData` and `Blob`: `docs/dev/mobile/spike-results.md`, decision 7, proved that this form is the one astrometry.net accepts from the phone; lower-case response headers; no rejection on a 4xx or 5xx status). The phone's `fetch` is the one Capacitor patches to go through the native layer; it may ignore an abort, so the timeout is a race between the request and a timer that rejects.
   - Suite `http-client-conformance.ts`, against an address given by the caller that answers like `spikes/mobile/scripts/echo-server.mjs` (write this small Node server: it returns as JSON the method, the headers, the text body, and for a form each part's name, file name, type, size and a checksum; `/status/503`; `/slow?ms=`; `/bytes?n=`). In Node the wrapper starts that server on port 0 of 127.0.0.1 and runs the suite on the server's adapter.
4. **The astrometry key** — `webcrypto-secret-codec.ts`: `createWebCryptoSecretCodec({ crypto, indexedDB })` implementing `SecretCodec`: an AES-GCM 256 key created once as **non-extractable** and kept in IndexedDB; stored form `enc:v2:webcrypto:<iv base64>:<ciphertext base64>`; `decrypt` returns a value without that prefix unchanged, and `null` when it cannot decrypt (including a value with the server's `enc:v1:aesgcm:` prefix). The key never leaves the phone and a backup does not carry the astrometry key (confirm by reading `packages/core/src/services/backup.ts` and `domain/backup.ts`; if a backup does carry it, stop and report). Tested in Node with Node's `crypto.webcrypto` and the `fake-indexeddb` package if it is already a dependency; otherwise the key store is a two-method interface (`load`, `save`) with an IndexedDB implementation, tested with an in-memory one.
5. **Catalogues.** The code that turns the catalogue files into the two star lists is in `server/star-search.ts:16-80` and `server/wcs-reader.ts:17-70`, mixed with file reading. Move the pure part to core (`packages/core/src/catalog/star-lists.ts`: `buildDeepStars(starsJson, namesJson, multiplesJson?)` and `buildCatalogStars(starsJson, namesJson?)`); the server keeps the file reading and calls them (its tests unchanged). In `packages/backend-local/src/bundled-catalogs.ts`: `createBundledCatalogs({ fetch, baseUrl })` loads `/data/stars.14.json`, `/data/starnames.json`, `/data/star-multiples.json` once (one parse shared by the two lists, loaded lazily on first use and kept) and the four gear files (`gear/telescopes.json`…), and returns `{ stars, catalogStars, gearCatalog() }`.
6. **ZIP size.** `bundle-fflate.ts` has no limit: a backup is read in memory on the phone. Add `maxArchiveBytes` (the assembler sets 300 MB) checked before opening, rejecting with a `DomainError` of kind `invalid`, code `BACKUP_TOO_LARGE` (add the code and its message in the four languages: "Cette sauvegarde est trop volumineuse pour être restaurée sur cet appareil." and its translations).
7. **The assembler** — `phone-backend.ts`: `createPhoneBackend(platform): Promise<Backend>` where `platform` holds the plugin objects and functions the adapters need (`sqliteConnection`, `filesystem`, `convertFileSrc`, `share`, `fetch`, `crypto`, `indexedDB`, `newId`, `now`). It creates the adapters, runs `initSchema` and the default categories as `server/app.ts` does at start-up, calls `createServices` (`env: () => undefined`, `platform: { isWindows: false }`) and `createLocalBackend`. `saveFile` writes the file in the cache directory and opens the share sheet. Tested in Node with fakes of the plugin objects (the SQLite fake of `tests/unit/capacitor-sqlite-db.test.ts`, an in-memory filesystem fake that reproduces the base64 interface, the server's `sharp` codec injected through an optional `images` override): the backend contract suite passes on it.

## Must NOT

- Add a dependency on a Capacitor package anywhere outside `spikes/mobile/`.
- Touch `src/`, the routes' behaviour, or `spikes/` other than adding `spikes/mobile/scripts/echo-server.mjs` (the `spikes/` folder is untracked and stays so: do not stage it; say in the report that this file exists).
- Run any device, adb or Gradle command.

## Docs

`docs/dev/mobile-architecture.md`: the ports table (phone column filled in for each port, with the file name), and one paragraph per decision above that differs from the server (original bytes kept without orientation; the key protected by a non-extractable key rather than the Android Keystore, and why: no extra plugin, same code on iOS, the key is not in backups; the archive size limit).

## Commit

`internal(mobile): add the phone's storage, picture, network and secret adapters`

## Report, in addition to the common items

Each adapter: its file, its plugin interface, where it differs from the server's and why · the cases of each conformance suite · what could not be tested in Node and waits for the device.
