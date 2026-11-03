# Phone App

MyAstroSky also runs on Android phones. The phone app is a companion to the desktop app: the same sky map, targets and plans, in your pocket at the telescope. It is a first version, so its screens may still change; this page describes what it can do, not where each button is.

---

## Getting the app

The phone app runs on **Android** only. It is not yet published as a download: for now it is built from the source code (see the `mobile:android:*` scripts in the repository).

---

## What it does

Everything is stored on the phone itself. No server or computer is needed, and the app works without a network connection except for the few features that need one (online plate solving, terrain horizon, identifying asteroids, comets and supernovae).

- **Sky map**: the same interactive map as on the desktop, with your placed photos, constellations, deep-sky objects, regions and the terrain horizon. Search finds objects and your own photos.
- **Targets**: recommendations for tonight from your location, your gear and the sky conditions, as on the desktop ([Targets tab](/user/user-guide.md#targets-tab)). Your own gear and filters, including smart telescopes and their mosaics, are available.
- **Observing plans**: create plans, add targets, reorder them, view them on the map and export them as a PDF ([Observing plans](/user/user-guide.md#observing-plans)).
- **Photos**: import photos from the phone, place them on the sky map, and browse them in a gallery. Supported formats: JPEG, PNG, WEBP, TIFF, FITS, XISF. Max size: 200 MB.
- **Settings**: location, language (French, English, Spanish, German), theme, display options and your astrometry.net key.

### Placing a photo

The phone cannot run a local plate solver (ASTAP or solve-field). To place a photo it offers:

- the **position stored in the file**, when the photo already carries one (WCS metadata);
- **online solving** with astrometry.net, which needs a network connection and your astrometry.net API key ([how to get one](/user/installing-solvers.md));
- **identifying two or three stars** yourself on the photo;
- **placing it by hand**.

A photo solved on the desktop keeps its placement when you move it to the phone.

### What the desktop has and the phone does not

The local plate solvers, the automatic star detection, random target suggestions, statistics, exporting the map as an image, deleting several photos at once, and deleting all data in one step. To remove all the phone's data, uninstall the app.

---

## Moving data between desktop and phone

The desktop and the phone do not synchronise. To move your photos, plans, gear and settings from one to the other, **export a backup** on one (Settings → export) and **import it** on the other. Both apps read the same backup files, so the backup also serves to move to a new phone.

Your astrometry.net key is never put in a backup: enter it again on the other device.
