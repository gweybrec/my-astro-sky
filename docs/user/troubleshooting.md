# Troubleshooting

---

## Plate solving

### Solving fails immediately with no result

- **For ASTAP:** Make sure you filled in the **Target object** field (e.g. `M31`, `NGC 7000`) before clicking Solve. ASTAP is much more reliable with a position hint.
- **For online (astrometry.net):** Check that you have entered a valid API key in Settings. See [Installing Plate Solvers](installing-solvers.md#astrometrynet-online--api-key-setup).
- **Try a different solver:** If one method fails, try another. Each solver has different strengths — a highly-stretched image that stumps ASTAP may solve fine via astrometry.net.
- **Fall back to manual placement:** If all solvers fail, use [Manual placement](user-guide.md#manual-placement) — it always works.

### "solve-field" option is greyed out on Windows

This is expected. solve-field has no native Windows build. Use ASTAP (native) or the online solver instead. If you have WSL2, you can enable solve-field through WSL — see [Installing Plate Solvers](installing-solvers.md#solve-field-astrometrynet-local--most-accurate).

### ASTAP says "executable not found"

1. Open **Settings** (gear icon in the side panel footer).
2. Check the **ASTAP executable path** — it must point to the actual `astap_cli` (Linux/macOS) or `astap_cli.exe` (Windows) binary.
3. If you used the install script, the default path is `/opt/astap/astap_cli` (Linux/macOS) or the directory you chose on Windows.
4. Re-run the install script if you're not sure where the binary ended up.

### Astrometry.net returns "no API key" or "invalid key"

1. Verify your key at [nova.astrometry.net/profile](https://nova.astrometry.net/profile).
2. Open app **Settings** and paste the key into the **Astrometry.net API key** field.
3. Save and try again.

---

## Photo placement

### Photo appears mirrored or rotated incorrectly

- In the placement controls, toggle the **Horizontal mirror** or **Vertical mirror** switch.
- If you used manual drag-and-drop, adjust the **Rotation** slider.
- If the photo was plate-solved but still looks wrong, there may be an EXIF orientation issue — try re-exporting the image from your processing software with EXIF rotation applied.

### Photo is placed wildly in the wrong part of the sky

- For ASTAP: double-check the **Target object** field — it must contain the correct object name. An empty field or wrong object causes ASTAP to search the entire sky and may produce an incorrect match.
- Try the online solver, which does not require a position hint.
- If the coordinates look completely wrong, try **Reposition** (gear icon on the photo in the side panel) and manually correct it.

### Photo looks correct but is slightly off / rotated a little

- Use **Reposition** (gear icon → Reposition) to re-enter the placement modal with the current transform pre-loaded.
- Adjust the rotation, scale, or position sliders.
- For a precise fix, switch to **3-point registration** and align on known stars.

---

## App / UI

### The sky map is blank or completely dark

1. Hard-refresh the page: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (macOS).
2. Open browser developer tools (**F12**) → **Console** tab — look for red error messages.
3. Clear your browser cache and reload.
4. If using a hosted or Docker instance, check with the person who set it up that the server is running.

### Custom gear I added is not appearing

- Make sure you clicked **Save** in the custom gear modal — the form requires all required fields (marked `*`) to be filled before saving.
- If the field highlighted red when you tried to save, fill in the missing value.

### Settings I changed were lost after reload

Display settings and theme preference are stored in your browser's local storage. They will be lost if you:
- Clear browser data / cache
- Use a private/incognito window
- Switch to a different browser or device

---

## Desktop app (Electron)

### Logs folder button is greyed out in browser mode

This is expected behavior. The **Open logs folder** button only works in the Electron desktop app. In browser mode (hosted URL, Docker, Node.js), use the browser developer console (**F12**) for diagnostics instead.

### Finding Electron error logs

If the desktop app shows an error toast, MyAstroSky writes a diagnostics file automatically:

- **Linux:** `~/.config/MyAstroSky/logs/`
- **Windows:** `%APPDATA%\MyAstroSky\logs\`

Each file is named `my-astro-sky-error-<timestamp>.json`. Attach the most recent file when reporting a bug.

---

## Reporting a bug

Open an issue on [GitHub](https://github.com/gweybrec/my-astro-sky/issues) and include:
- What you were doing when the problem occurred
- The browser and OS you are using
- Any error messages from the browser console (F12 → Console)
- For desktop app errors: the latest `my-astro-sky-error-*.json` log file
