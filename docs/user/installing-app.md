# Installing MyAstroSky

MyAstroSky runs three ways: as a **desktop app** you install like any other program, as a **link someone already set up for you**, or **self-hosted** so you can share it with your astronomy club or family. Pick the one that fits you.

---

## Desktop app (recommended)

No terminal, no Docker — download an installer and double-click it.

1. Go to the [GitHub Releases](https://github.com/gweybrec/my-astro-sky/releases) page.
2. Download the file for your operating system:

| OS | File | Notes |
|---|---|---|
| Windows | `MyAstroSkySetup.exe` | Installer — adds MyAstroSky to the Start Menu |
| macOS (Apple Silicon: M1/M2/M3+) | `MyAstroSky-arm64.dmg` | Drag-to-Applications disk image |
| macOS (Intel) | `MyAstroSky-x64.dmg` | Drag-to-Applications disk image |
| Linux (Debian/Ubuntu) | `my-astro-sky_<version>_amd64.deb` | Install with `sudo dpkg -i my-astro-sky_*.deb` |
| Any platform | the `.zip` for your OS | Portable — extract and run, no installation |

3. Run the installer (Windows: double-click the `.exe`; macOS: open the `.dmg` and drag MyAstroSky into Applications; Linux: install the `.deb` and launch **MyAstroSky** from your application menu).

> **macOS: "cannot be opened because the developer cannot be verified"** — this app isn't code-signed yet, so macOS blocks it on first launch. **Right-click** (or Control-click) `MyAstroSky.app` → **Open** → click **Open** in the dialog. macOS remembers your choice after that. This is expected, not a sign of a problem.

### Uninstalling

| OS | How |
|---|---|
| Windows | **Settings → Apps → MyAstroSky → Uninstall** |
| macOS | Drag `MyAstroSky.app` to the Trash |
| Linux (.deb) | `sudo apt remove my-astro-sky` |
| Portable `.zip` (any OS) | Delete the extracted folder |

Your photos, database, and settings live separately from the app and aren't removed automatically. To delete them too:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\MyAstroSky\` |
| macOS | `~/Library/Application Support/MyAstroSky/` |
| Linux | `~/.config/MyAstroSky/` |

---

## Using a link someone shared with you

If someone already runs MyAstroSky for you (a club instance, a friend's server), there's nothing to install — just open the URL they gave you in **Chrome**, **Firefox**, or **Edge**.

---

## Self-hosting for a group (Docker)

Want to run one shared instance for your astronomy club or family, reachable by URL? This needs [Docker](https://docs.docker.com/get-docker/) installed on a Linux server or VPS (1 GB RAM is enough) — no other technical setup required.

```bash
git clone https://github.com/gweybrec/my-astro-sky.git
cd my-astro-sky
docker compose up --build -d
```

The app listens on port `3001`. Send the URL to your group — they open it in a browser, nothing to install on their side. Photos and the database persist in Docker volumes across restarts and updates.

For a domain name and HTTPS, put it behind a reverse proxy (nginx, Caddy).

---

## Sharing on your local WiFi (LAN)

Already running MyAstroSky on your own computer and want to show it on another device on the same WiFi (a tablet, a second laptop in the observatory)?

1. Find your computer's LAN IP address (`ipconfig` on Windows, `ip a` on Linux/macOS).
2. On the other device, open `http://<your-lan-ip>:3001` in a browser.

No internet connection or extra server needed — this works entirely on your local network.

---

## Next step

Once the app is running, see [Installing Plate Solvers](/user/installing-solvers.md) if you want offline plate solving (ASTAP, solve-field), or jump straight into [Getting Started](/user/getting-started.md).
