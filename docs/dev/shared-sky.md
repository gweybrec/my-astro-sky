# Shared skies

A user shares their sky as one file; another user opens that file and keeps it as a **visit**: someone
else's photos, shown on the map and in the gallery, read-only, and never mixed with their own.
Nothing goes through a server of the project: the file travels however the two people choose.

## The package

A package is a ZIP named `<display name>.myastrosky` (`shareFileName`). What decides that a file is a
package is its content, never its name: a `.zip` holding the same entries opens too.

| Entry           | Content                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `images/<file>` | The full-size stored pictures, stored without compression               |
| `share.json`    | The manifest, written last: it holds the size of each picture as stored |

The manifest (`ShareManifest` in `packages/core/src/domain/shared-sky.ts`):

| Field           | Content                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`          | `"shared-sky"`: what tells a package from a backup                                                                                                                                                           |
| `formatVersion` | `2`. A package of a later version is refused (`SHARED_SKY_UNSUPPORTED`)                                                                                                                                      |
| `skyId`         | Made once on the sender's device (the `SHARE_SKY_ID` setting) and written in every package. It is how a visitor's app recognises the same sky, since display names can collide                               |
| `senderName`    | The display name the sender typed (remembered in the `SHARE_SENDER_NAME` setting)                                                                                                                            |
| `sharedAt`      | When the package was written. A later package of the same sky is an update                                                                                                                                   |
| `photos[]`      | Per photo: the sender's id, the picture's file name and size, width and height, quarter turns, correspondences, manual placement, DSO ids, labels, notes, points of interest, observation date, integrations |
| `poiCategories` | Name and colour of the categories the shared photos' points of interest use                                                                                                                                  |

With "Include gear and capture details" ticked, a photo also carries `captureDetails` and `gear`: the
names of its setup, telescope, camera and accessory **as text**. An id of the sender's gear lists means
nothing on another device, so none is written.

**Never in a package:** the observing site, the horizon profile, settings, API keys, plans, sky
regions, thumbnails and medium-sized copies, and any id that points at another table.

**Position tags.** `stripGps` (`packages/core/src/strip-gps.ts`) takes the position out of each picture
before it is written: the GPS directory of the EXIF data and the GPS values of the XMP text, in JPEG,
PNG and WebP. The picture is not decoded nor re-encoded and the file keeps its length; only those
bytes change.

## A visit

A visit lives in two tables of its own (migrations 19 and 20):

- `shared_skies`: one row per `skyId`: sender name, package date, received date, photo count, size on
  disk, the sender's point-of-interest categories. Its `display_name` column is no longer read: a visit
  shows its sender's name and is never renamed.
- `shared_sky_photos`: the photos, with their correspondences as JSON in the row. `source_id` is the
  photo's id on the sender's device; `id` and the file names are **made on the visitor's device**.
  `author` is the name the photo was shared under (each photo of a package carries it); an empty one, from
  a visit kept before the column existed, reads as the sky's sender.

### The isolation rule

**Nothing that reads or changes the user's photos can reach a visit.** It holds by construction, not
by a filter someone could forget:

- the photo service, the backup, the plans and every photo route work on the `photos` table, where a
  visit photo does not exist: changing or deleting one answers `PHOTO_NOT_FOUND`;
- a visit's files have names made at import, so they never take the file of a user's photo, even when
  the visitor opens their own sky or a sky restored from the same backup;
- on the map, `PhotoLayer.getPlacedPhotos()` returns the user's photos only. A visit's photos are given
  with `setVisitPhotos` and read with `getVisitPhotos`; the draw order, the statistics, the target
  recommender's "already photographed" and the export picker read the first list. "Delete all data"
  removes the visits only when its own "visited skies" box is ticked, one visit at a time through
  `remove`.

A change that adds a way to read photos keeps this rule, and `tests/unit/shared-sky-service.test.ts`
holds the checks ("never shows a visit among the visitor own photos").

### Opening a package

`SharedSkyService` (`packages/core/src/services/shared-skies.ts`):

1. `inspect` reads the manifest and answers what the package holds, how it stands against the visit
   kept of the same sky (`new`, `update`, `same`, `older`) and the room left. It writes nothing.
2. `open` writes each picture under a new name with its thumbnail, then swaps the rows in one atomic
   batch (the previous rows of that `skyId` out, the new ones in), then removes the previous files.
   When it fails or is cancelled, what it wrote is removed and the earlier visit is as it was.

An update **replaces** the visit: photos no longer in the package disappear, and the visit takes the
sender's name of the newer package.

### The author

A photo's author (`Photo.author`, set on visit photos only) is the sender's name, written into each
photo of the manifest when the package is made; a manifest photo without one takes the manifest's
`senderName`. Nothing on the visitor's device can change it. The screens show it first, on a line of its
own, cut with "…" when too long.

Everything in a manifest comes from someone else's file: `parseShareManifest` cleans it, a picture's
name must be a plain file name of an allowed extension, the archive's entries pass the same checks as
a backup's (no path leaving its folder, no name twice, size limits), and a file that is not a readable
picture is left out.

## Through the backends

`Backend.sharedSkies` (`packages/core/src/backend.ts`) is the same on both backends, and the backend
contract (`packages/core/src/testing/backend-contract.ts`) runs a share, a visit, an update and a
deletion on each.

- `exportToUser(request)` builds the package and hands it over.
- `inspect(file)` returns the preview and a **ticket** under which the package is held;
  `open(ticket)` keeps it as a visit and `discard(ticket)` lets go of it.

**Desktop.** The package is uploaded once (`POST /api/shared-skies/inspect`) to a file in
`INCOMING_DIR` and read from there by pieces. `server/shared-sky-imports.ts` holds the tickets: the
import runs on the server, the client starts it, polls its progress and deletes the ticket, which also
cancels a running import. The file is removed as soon as it is no longer needed, and a ticket nobody
came back for is dropped after 30 minutes. A share is prepared by `POST /api/shared-skies/export`
(which checks it and returns a one-use token) and downloaded by the browser itself from
`GET /api/shared-skies/export/:token`, straight to disk: the page never holds the package.

**Phone backend.** The package is read where it is, by pieces, and written to a file in the cache
directory as its entries are added (`shareArchive`, over `core/zip-writer`), then handed to the share
sheet. No archive is held in memory in either direction.

## On the desktop screens

- `useSharedSkiesStore` (`packages/app-state/src/stores/shared-skies.ts`) holds the visits and the
  skies shown (`shown`: `MY_SKY` and visited skies' ids, ticked in any number; none shows no photo). The
  choice is remembered; a visit deleted, or whose photos cannot be read, is no longer shown, and when no
  sky is left the user's own is shown again. The photos of every visited sky shown are merged into
  `visitPhotos`; each sky's point-of-interest category ids are prefixed with its `skyId`, since two
  senders may use the same id.
- `src/main.ts` watches it and gives the visits' photos to the map layer and to the gallery; a visit's
  outlines are drawn in their own colour (`VISIT_OUTLINE`).
- A visited photo opens in the photo view without the editor: `src/visit-photo-info.ts` writes the
  same information as text.
- A `.myastrosky` file dropped on the window opens the shared skies window, which reads it.

## On the phone

- Réglages has a "Ciels partagés" section, which opens `SharedSkiesPage` (share, open, the visits deleted);
  "Partager mon ciel" is `ShareSkyPage`, and the package goes to the share sheet.
- `useSharedSkyOpen` (`apps/mobile/src/composables/`) picks the file (`SHARED_SKY_FILE_TYPES`: every file, since
  the extension has no MIME type), reads it, asks with the desktop's texts, then keeps it with its progress and a
  cancel.
- "Ciels affichés" (`SkyViewField`) is its own section, first in the Affichage sheets of the map and the
  gallery: a count field that opens tick boxes (`SkyCheckSheet`), like the Catalogues. On desktop it is a
  side-panel section (`SkyViewSection`) above Affichage, and the first control of the gallery bar: a
  drop-down of tick boxes (`SkyViewSelect`), like the Catalogs.
  `sky-map-setup.ts` gives the visit to the map layer as `src/main.ts` does on the desktop; the gallery and the photo
  page add the visit's photos to the user's own (or show them alone).
- A visited photo is read-only on every screen: no reposition, display order, edit, delete, WCS file or quarter
  turn; its gear is listed as the sender named it (`photoFacts`).
