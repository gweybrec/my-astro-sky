# Installing Plate Solvers

MyAstroSky supports two local plate solvers (ASTAP and solve-field) plus the online astrometry.net service. This page explains how to install each one and configure the app to find it.

---

## Astrometry.net (online) — API key setup

The online solver sends your image to [nova.astrometry.net](https://nova.astrometry.net) for analysis. It requires a free API key.

1. Create a free account at [nova.astrometry.net](https://nova.astrometry.net/signup).
2. Go to your [profile page](https://nova.astrometry.net/profile) and copy the **API key**.
3. In MyAstroSky, open **Settings** (gear icon in the side panel footer).
4. Paste the key into the **Astrometry.net API key** field and save.

The online solver then becomes available as an option in the upload modal.

---

## ASTAP — fastest local solver

ASTAP is a professional standalone plate solver that works on **Windows, macOS, and Linux**. It typically solves in 3–5 seconds.

### Linux / macOS

```bash
sudo bash scripts/install-astap.sh
```

This installs `astap_cli` and the D50 star catalog (~900 MB) to `/opt/astap/`. No Settings change is needed — this is the default path.

If you install to a custom location, open **Settings** in the app and update the **ASTAP executable path**.

### Windows (native — recommended)

Open PowerShell in the project folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-astap.ps1
```

The script will prompt for an install directory, then download `astap_cli.exe` and the D50 star catalog (~900 MB).

After installation:
1. Open the app **Settings**.
2. Set the **ASTAP executable path** to the full path of `astap_cli.exe` you chose (e.g. `C:\astap\astap_cli.exe`).

### Windows via WSL2 (alternative)

If you already use WSL2 and prefer to run ASTAP inside Linux:

1. Install WSL2 with Ubuntu ([Microsoft guide](https://learn.microsoft.com/windows/wsl/install)).
2. Inside Ubuntu, run the Linux install script above.
3. In app Settings, enable **Use WSL2 for ASTAP (Windows only)**.
4. Set the ASTAP path to the Linux path inside WSL (e.g. `/opt/astap/astap_cli`).

---

## solve-field (astrometry.net local) — most accurate

solve-field is the reference implementation of the astrometry.net algorithm. It gives the best accuracy for heavily processed or stretched images. **Linux only** — on Windows, use ASTAP or the online solver instead.

### Linux (Ubuntu / Debian)

```bash
# Install the binary
sudo apt-get install astrometry.net

# Download index files (~350 MB, covers 0.4°–30° FOV)
sudo bash scripts/install-solve-field.sh
```

Index files are installed to `/usr/local/astrometry/data/`. No Settings change is needed.

If you use a custom location, open **Settings** and update the **solve-field path** and **Astrometry.net data directory**.

### Windows via WSL2

There is no native Windows build of solve-field. On Windows, use WSL2:

1. Install WSL2 with Ubuntu ([Microsoft guide](https://learn.microsoft.com/windows/wsl/install)).
2. Inside Ubuntu, install solve-field and indexes (same commands as Linux above).
3. In app Settings, enable **Use WSL2 for solve-field (Windows only)**.
4. Set the **solve-field path** and **Astrometry.net data directory** to the Linux paths inside WSL.

---

## Verifying your setup

After installing a solver, upload a test image and select that solver in the upload modal. If it finds a solution, the photo will snap into place on the sky map.

If it fails, see [Troubleshooting](/user/troubleshooting.md) for common issues.
