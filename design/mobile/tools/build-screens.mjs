// Generates plain/<Name>.html (plain, rendered and measured) and boards/<Name>.dc.html (artboard wrap) from ONE markup string per
// screen, so the artboard is a mechanical wrap of the verified markup. Run build-landscape.mjs afterwards.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, "../plain"), { recursive: true });
const ICONS = path.join(here, "../../../src/icons");
const FONTS =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Outfit:wght@300;400;500;600&display=swap";

// Inline an app icon: strip the XML declaration, add aria-hidden, and close every element explicitly (dc format).
function closeTags(s) {
  return s.replace(/<([a-zA-Z]+)([^<>]*?)\s*\/>/g, "<$1$2></$1>");
}
function icon(name) {
  let s = fs.readFileSync(path.join(ICONS, name + ".svg"), "utf8");
  s = s
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
  return closeTags(s);
}
// New icons, same single-ink style as src/icons (24 grid, 2px round stroke, currentColor). Listed in the report.
const NEW = {
  filter: '<path d="M3 3.5h18l-7 9v6l-4 2v-8z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  // Gear: the Lucide "settings" glyph, the family most of src/icons comes from (image.svg, plan-list.svg).
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  recenter:
    '<circle cx="12" cy="12" r="3"/><path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/>',
  // Batch 2a. Lucide "folder", "info" and "rotate-ccw" (the reset-zoom arrow), same 24 grid and 2px round stroke.
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  // Batch 2b. Lucide "minus" (the "plus" glyph already exists in src/icons), "qr-code" and "unplug".
  minus: '<path d="M5 12h14"/>',
  "qr-code":
    '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  unplug:
    '<path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/>',
  "reset-zoom":
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  // Batch 2c. Drawn diamond (difficulty mark), replaces the "◆" glyph.
  diamond: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
  // Revision 5. Drawn marks that replace the text glyphs ▶ ▾ ⠿ ↑ ↓ → ← (arrow-left exists since batch 1).
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  grip: '<path d="M7.5 4.5h.01"/><path d="M16.5 4.5h.01"/><path d="M7.5 12h.01"/><path d="M16.5 12h.01"/><path d="M7.5 19.5h.01"/><path d="M16.5 19.5h.01"/>',
  "arrow-up": '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  // Revision 8a. Lucide "ellipsis-vertical" (the "more" button: three dots) and "arrow-up-down" (the sort order of a plan).
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  // Revision 8b. Lucide "layers" (the map's display ribbon button) and "sliders-horizontal" (the display settings sheet).
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sliders:
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  // Revision 8b, photo actions. Lucide "move" (four arrows: reposition) and a drawn "stack-order" (a square in front of another: the draw order of the photos).
  move: '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/>',
  "stack-order":
    '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M8 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/>',
  // Revision 9. Lucide "map" (a folded map: the desktop's "Carte" pick button, modal.mapPick).
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  // Batch 2d. Lucide "search" (the magnifier of the search buttons).
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
};
function newIcon(name) {
  return closeTags(
    '<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      NEW[name] +
      "</svg>",
  );
}
const I = (n) => (NEW[n] ? newIcon(n) : icon(n));

const TABS = [
  ["Ciel", "local-sky"],
  ["Galerie", "image"],
  ["Cibles", "target"],
  ["Plans", "plan-list"],
  ["Réglages", "gear"],
];
function tabbar(sel) {
  return (
    '<nav class="mob-tabbar" role="tablist" aria-label="Navigation" style="flex:none">' +
    TABS.map(([label, ic]) => {
      const pill = '<span class="mob-tab-pill">' + I(ic) + "</span>";
      return (
        '<button class="mob-tab" role="tab" aria-selected="' +
        (label === sel ? "true" : "false") +
        '">' +
        pill +
        '<span class="m-caption">' +
        label +
        "</span></button>"
      );
    }).join("") +
    "</nav>"
  );
}
const ROOT =
  '<div id="root" style="position:relative;overflow:hidden;display:flex;flex-direction:column;background:var(--bg-app);width:412px;height:915px">' +
  '<div class="mob-statusbar" aria-hidden="true"><span class="m-mono">22:15</span><span class="mob-statusbar-icons"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 14h2V10H1zM5 14h2V7H5zM9 14h2V4H9zM13 14h2V1h-2z"></path></svg><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 6a9.5 9.5 0 0 1 13 0M4 9a6 6 0 0 1 8 0"></path><circle cx="8" cy="12" r="1" fill="currentColor"></circle></svg><svg viewBox="0 0 20 12"><rect x=".75" y=".75" width="16" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect><rect x="2.5" y="2.5" width="10" height="7" rx="1" fill="currentColor"></rect><rect x="17.5" y="4" width="2" height="4" rx="1" fill="currentColor"></rect></svg></span></div><div class="mob-gesturebar" aria-hidden="true"></div>';
// The row-end chevron is the chevron-right icon cropped to the 10.34 x 20 px footprint of the "▶" glyph (viewBox 12.9 x 25 around the
// icon centre: 0.8 scale, ink 6.4 x 11.2 px); the crop keeps the span free of overflow.
const chevron =
  '<span class="mob-row-chevron" aria-hidden="true">' +
  I("chevron-right").replace(
    'viewBox="0 0 24 24"',
    'viewBox="5.55 -0.5 12.9 25"',
  ) +
  "</span>";
const CARET = I("chevron-down");
const GRIP = I("grip");
const dirIcon = (n) =>
  I(n).replace("<svg ", '<svg class="mob-icon--sm mob-icon--dir" ');
const searchTop = (title, placeholder, label) =>
  (title ? '<h1 class="mob-topbar-title m-title">' + title + "</h1>" : "") +
  '<input class="mob-search m-body" type="search" placeholder="' +
  placeholder +
  '" aria-label="' +
  label +
  '">';
const topbar = (inner) =>
  '<header class="mob-topbar" style="flex:none">' + inner + "</header>";
const iconBtn = (label, ic, extra = "") =>
  '<button class="mob-icon-btn' +
  extra +
  '" aria-label="' +
  label +
  '">' +
  I(ic) +
  "</button>";

// ── 1. Main ─────────────────────────────────────────────────────────────────────────────────
// The map's top-right controls (revision 8b). One 48px layers button right of the search field opens a vertical ribbon of the desktop's seven
// map toggles (SkyTimeControl.vue: local sky, azimuth grid, trajectory, terrain horizon, Moon, Sun, planets; same icons, same strings, same order
// as its row read left to right) and, last, the button of the display settings sheet. `ribbon` is null (closed) or { on: [icon names], off: [disabled icon names] }.
const RIBBON = [
  ["local-sky", "Ciel local (vue horizon)"],
  ["azimuth-grid", "Grille azimutale (alt-az)"],
  ["sky-trajectory", "Trajectoire de l\x27objet sélectionné"],
  ["mountain", "Afficher/masquer l\x27horizon du relief"],
  ["moon", "Afficher/masquer la Lune"],
  ["sun", "Afficher/masquer le Soleil"],
  ["planets", "Afficher/masquer les planètes"],
];
function mapControls(ribbon = null) {
  return (
    '<div class="mob-map-top"><input class="mob-search m-body" type="search" placeholder="Rechercher étoile ou DSO…" aria-label="Rechercher étoile ou DSO">' +
    '<button class="mob-icon-btn mob-icon-btn--float" aria-label="Calques de la carte" aria-haspopup="true" aria-expanded="' +
    (ribbon ? "true" : "false") +
    '">' +
    I("layers") +
    "</button></div>" +
    (ribbon
      ? '<div class="mob-map-ribbon" role="group" aria-label="Calques de la carte">' +
        RIBBON.map(
          ([ic, label]) =>
            '<button class="mob-icon-btn mob-icon-btn--float' +
            (ribbon.held === ic ? " mob-icon-btn--held" : "") +
            '" aria-pressed="' +
            (ribbon.on.includes(ic) ? "true" : "false") +
            '" aria-label="' +
            label +
            '"' +
            (ribbon.off.includes(ic) ? " disabled" : "") +
            ">" +
            I(ic) +
            "</button>",
        ).join("") +
        '<button class="mob-icon-btn mob-icon-btn--float mob-map-ribbon-more" aria-label="Affichage">' +
        I("sliders") +
        "</button></div>"
      : '<div class="mob-map-cluster">' +
        iconBtn("Recentrer la carte", "recenter", " mob-icon-btn--float") +
        "</div>")
  );
}
const mainScreen = (ribbon) =>
  ROOT +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;inset:0">Carte du ciel</div>' +
  mapControls(ribbon) +
  '<div class="mob-timebar">' +
  '<button class="mob-btn mob-btn--field m-body" aria-label="Date et heure, ouvrir les sélecteurs : 2026-10-03 22:15"><span class="mob-btn-label">2026-10-03 22:15</span><span class="mob-btn-caret" aria-hidden="true">' +
  CARET +
  "</span></button>" +
  '<button class="mob-btn m-body">Ce soir</button>' +
  iconBtn("Reprendre le temps", "play") +
  "</div></main>" +
  tabbar("Ciel") +
  "</div>";
const Main = mainScreen(null);
// SkyToggles: Main with the ribbon open. Local sky, Moon and planets are on; the trajectory is enabled because local sky is on; the terrain
// horizon is disabled because no horizon profile has been computed (the desktop disables it without a profile). While the ribbon is open it
// covers the recenter button, which is therefore not drawn.
const SkyToggles = mainScreen({
  on: ["local-sky", "moon", "planets"],
  off: ["mountain"],
});
// SkyTogglesHint: the same ribbon while the azimuth grid button is held (long press): its name appears beside it. The label is not a control.
const SkyTogglesHint = mainScreen({
  on: ["local-sky", "moon", "planets"],
  off: ["mountain"],
  held: "azimuth-grid",
}).replace(
  "</main>",
  '<div class="mob-longpress-label m-body" role="tooltip" style="top:calc(var(--mobile-gutter) + var(--mobile-touch-min) + var(--space-4) + var(--safe-top, 0px) + (var(--mobile-touch-min) + var(--space-4)))">Grille azimutale (alt-az)</div></main>',
);

// ── 2. SkyObject ────────────────────────────────────────────────────────────────────────────
const fact = (label, value) =>
  '<div class="mob-fact"><span class="mob-fact-label m-caption">' +
  label +
  '</span><span class="mob-fact-value m-body-strong">' +
  value +
  "</span></div>";
const actionRow = (ic, label, trail = "") =>
  '<button class="mob-row"><span class="mob-row-lead">' +
  I(ic) +
  '</span><span class="mob-row-body"><span class="mob-row-title m-body">' +
  label +
  "</span></span>" +
  (trail ? '<span class="mob-row-trail">' + trail + "</span>" : "") +
  "</button>";
// Object meta line: id, then the desktop's type badge and constellation badge.
const meta = (id, type, cst) =>
  '<div class="mob-meta m-secondary"><span>' +
  id +
  '</span><span class="mob-badge mob-badge--type m-caption">' +
  type +
  '</span><span class="mob-badge mob-badge--const m-caption">' +
  cst +
  "</span></div>";
const SkyObject =
  ROOT +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;inset:0">Carte du ciel</div>' +
  mapControls() +
  '<section class="mob-sheet mob-sheet--auto" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="sheet-title">' +
  '<button class="mob-sheet-grab" aria-label="Fermer la fiche"><span class="mob-sheet-handle"></span></button>' +
  '<div class="mob-sheet-header"><h2 id="sheet-title" class="m-title" style="color:var(--text-bright)">Galaxie d\x27Andromède</h2>' +
  meta("M31", "Galaxie spirale", "AND") +
  "</div>" +
  '<div class="mob-facts">' +
  fact("Altitude", "57°") +
  fact("Transit", "01:23") +
  fact("Magnitude", "3.4") +
  "</div>" +
  // The desktop offers these on a selected object: DSOActions.vue (add a frame, add a mosaic, edit), the Targets card (add to a plan, show on the map),
  // the info panel (details). One row of icon-only buttons; no eye: the desktop cannot hide a single object (revision 9).
  '<div class="mob-icon-row" role="group" aria-label="Actions sur l&#39;objet">' +
  iconBtn("Ajouter un cadre", "add-frame") +
  iconBtn("Ajouter une mosaïque", "add-mosaic") +
  iconBtn("Ajouter au plan", "list-plus") +
  iconBtn("Modifier", "pen") +
  iconBtn("Voir les détails", "info") +
  "</div></section></main>" +
  tabbar("Ciel") +
  "</div>";

// ── 3. Targets ──────────────────────────────────────────────────────────────────────────────
const star = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const targetRow = (name, id, type, cst, alt, time, mag, rating) =>
  '<button class="mob-row mob-row--roomy"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span><span class="mob-row-sub mob-meta m-secondary"><span>' +
  id +
  '</span><span class="mob-badge mob-badge--type m-caption">' +
  type +
  '</span><span class="mob-badge mob-badge--const m-caption">' +
  cst +
  '</span></span><span class="mob-row-sub m-secondary">Magnitude ' +
  mag +
  ' · <span class="mob-rating">' +
  star(rating) +
  '</span></span></span><span class="mob-row-trail mob-row-trail--stack"><span class="mob-row-trail-main m-mono">' +
  alt +
  '°</span><span class="m-mono">' +
  time +
  "</span></span></button>";
const LOC = "48.58, 7.75"; // the observing location as coordinates (the desktop has no place names): decimal degrees, as the Location fields
const ctx = (aria, text) =>
  '<button class="mob-btn mob-btn--field m-secondary" aria-label="' +
  aria.replace(/"/g, "&quot;") +
  '"><span class="mob-btn-label">' +
  text +
  '</span><span class="mob-btn-caret" aria-hidden="true">' +
  CARET +
  "</span></button>";
// Rows of the Targets list for the two types checked in the types sheet (emission and planetary nebulae).
const targetRows =
  targetRow(
    "Nébuleuse du Cocon",
    "IC5146",
    "Nébuleuse en émission",
    "CYG",
    89,
    "22:33",
    "7.2",
    4,
  ) +
  targetRow(
    "Petite Nébuleuse de l'Haltère",
    "M76",
    "Nébuleuse planétaire",
    "PER",
    87,
    "02:18",
    "10.1",
    4,
  ) +
  targetRow(
    "Nébuleuse de l'Amérique du Nord",
    "NGC7000",
    "Nébuleuse en émission",
    "CYG",
    86,
    "21:38",
    "4.0",
    5,
  ) +
  targetRow(
    "Nébuleuse du Croissant",
    "NGC6888",
    "Nébuleuse en émission",
    "CYG",
    80,
    "20:53",
    "7.4",
    5,
  ) +
  targetRow(
    "Nébuleuse de la Bulle",
    "NGC7635",
    "Nébuleuse en émission",
    "CAS",
    77,
    "23:58",
    "10.0",
    5,
  ) +
  targetRow(
    "Nébuleuse de la Lyre",
    "M57",
    "Nébuleuse planétaire",
    "LYR",
    69,
    "20:48",
    "8.8",
    5,
  ) +
  targetRow(
    "Nébuleuse de l'Haltère",
    "M27",
    "Nébuleuse planétaire",
    "VUL",
    64,
    "20:48",
    "7.4",
    5,
  ) +
  targetRow(
    "Nébuleuse de l'Hélice",
    "NGC7293",
    "Nébuleuse planétaire",
    "AQR",
    21,
    "23:08",
    "7.3",
    5,
  );
const typesField = (value) =>
  '<div class="mob-context mob-context--follow" style="flex:none"><button class="mob-btn mob-btn--field mob-btn--block m-secondary" aria-label="Types d\x27objets : ' +
  value +
  '"><span class="mob-btn-key">Types d\x27objets</span><span class="mob-btn-value">' +
  value +
  '</span><span class="mob-btn-caret" aria-hidden="true">' +
  CARET +
  "</span></button></div>";
const targetsBase = (value) =>
  topbar(
    searchTop("", "Rechercher une cible…", "Rechercher une cible") +
      iconBtn("Plus de filtres", "filter"),
  ) +
  '<div class="mob-context" style="flex:none">' +
  ctx("Équipement : Équipement 1", "Équipement 1") +
  ctx("Nuit : ce soir", "Ce soir") +
  ctx("Lieu : " + LOC, LOC) +
  "</div>" +
  typesField(value) +
  '<div class="mob-scroll" style="flex:1;background:var(--bg-panel)">' +
  targetRows +
  "</div>" +
  tabbar("Cibles");
const Targets = ROOT + targetsBase("2 types") + "</div>";

// ── 3b. TargetsTypes: the types sheet open over the Targets screen ──────────────────────────
const typeRow = (label, checked) =>
  '<label class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  label +
  '</span></span><input class="mob-check" type="checkbox"' +
  (checked ? " checked" : "") +
  "></label>";
const TargetsTypes =
  ROOT +
  targetsBase("2 types") +
  '<div class="mob-scrim"></div>' +
  '<section class="mob-sheet mob-sheet--auto-lg" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="types-title">' +
  '<button class="mob-sheet-grab" aria-label="Fermer"><span class="mob-sheet-handle"></span></button>' +
  '<div class="mob-sheet-header"><h2 id="types-title" class="m-title" style="color:var(--text-bright)">Types d\x27objets</h2></div>' +
  '<div class="mob-sheet-body mob-scroll">' +
  typeRow("Tous", false) +
  typeRow("Galaxies spirales", false) +
  typeRow("Nébuleuses en émission", true) +
  typeRow("Nébuleuses planétaires", true) +
  typeRow("Nébuleuses par réflexion", false) +
  typeRow("Nébuleuses sombres", false) +
  typeRow("Amas ouverts", false) +
  typeRow("Amas globulaires", false) +
  typeRow("Rémanents de supernova", false) +
  "</div>" +
  '<div class="mob-sheet-footer"><button class="mob-btn mob-btn--lg m-body">Réinitialiser</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong">Appliquer</button></div>' +
  "</section></div>";

// ── 4. Plans ────────────────────────────────────────────────────────────────────────────────
const planRow = (name, sub) =>
  '<button class="mob-row"><span class="mob-row-lead">' +
  I("plan-list") +
  '</span><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span><span class="mob-row-sub m-secondary">' +
  sub +
  '</span></span><span class="mob-row-trail">' +
  chevron +
  "</span></button>";
const Plans =
  ROOT +
  topbar(searchTop("", "Rechercher un plan…", "Rechercher un plan")) +
  '<div class="mob-scroll" style="flex:1;padding-top:var(--space-4)"><div style="background:var(--bg-panel)">' +
  planRow("Nuit du 2026-10-03", "3 oct. 2026 · 4 objets") +
  planRow("Cygne et Céphée", "10 oct. 2026 · 6 objets") +
  planRow("Nuit du 2026-09-19", "19 sept. 2026 · 2 objets") +
  "</div></div>" +
  '<button class="mob-fab mob-fab--fixed" aria-label="Nouveau plan">' +
  I("plus") +
  "</button>" +
  tabbar("Plans") +
  "</div>";

// ── 5. PlanDetail ───────────────────────────────────────────────────────────────────────────
const entry = (name, win, gear) =>
  '<div class="mob-entry"><button class="mob-drag" aria-label="Déplacer ' +
  name +
  '">' +
  GRIP +
  '</button><button class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span><span class="mob-row-sub m-secondary"><span class="m-mono">' +
  win +
  "</span> · " +
  gear +
  '</span></span><span class="mob-row-trail">' +
  chevron +
  "</span></button></div>";
const PlanDetail =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Nuit du 2026-10-03</h1>' +
      iconBtn("Actions du plan", "more"),
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  '<h2 class="mob-section-header m-secondary">Résumé</h2>' +
  '<div class="mob-facts mob-facts--2">' +
  fact("Début de nuit", "20:48") +
  fact("Fin de nuit", "05:47") +
  '<div class="mob-fact mob-fact--wide"><span class="mob-fact-label m-caption">Lune</span><span class="mob-fact-value m-body-strong">Dernier quartier · 50 %</span></div>' +
  "</div>" +
  '<h2 class="mob-section-header m-secondary">4 objets</h2>' +
  '<div style="background:var(--bg-panel)">' +
  entry("Nébuleuse de l\x27Amérique du Nord", "21:00 – 22:30", "Équipement 1") +
  entry("Galaxie d\x27Andromède", "22:40 – 00:10", "Équipement 1") +
  entry("Galaxie du Triangle", "00:20 – 01:50", "Équipement 1") +
  entry("Pléiades", "02:00 – 04:30", "Équipement 1") +
  "</div></div>" +
  '<button class="mob-fab mob-fab--fixed mob-fab--flush" aria-label="Ajouter une cible">' +
  I("plus") +
  "</button>" +
  "</div>";

// ── 6. Library ──────────────────────────────────────────────────────────────────────────────
const tile = (file, id) =>
  '<div class="mob-photo"><button class="mob-photo-tile m-secondary" aria-label="' +
  file +
  '"><span class="mob-photo-name">' +
  file +
  '</span></button><span class="mob-photo-id m-mono">' +
  id +
  "</span></div>";
const libraryBase =
  topbar(
    searchTop("", "Rechercher une photo…", "Rechercher une photo") +
      iconBtn("Plus de filtres", "filter"),
  ) +
  '<div class="mob-scroll" style="flex:1"><div class="mob-photo-grid">' +
  tile("M31_2025-09-14_stack.jpg", "M31") +
  tile("NGC7000_HaOIII_2025-08-23.tif", "NGC7000") +
  tile("M42_2025-01-18.png", "M42") +
  tile("M45_2024-11-02_RGB.jpg", "M45") +
  tile("NGC6992_OIII_2025-09-06.fits", "NGC6992") +
  tile("M27_2025-08-30.jpg", "M27") +
  "</div></div>" +
  '<button class="mob-fab mob-fab--fixed" aria-label="Ajouter des photos">' +
  I("plus") +
  "</button>" +
  tabbar("Galerie");
const Library = ROOT + libraryBase + "</div>";
// LibraryConnected: the gallery while it shows the computer's data (LanConnected, first mode): a slim line under the top bar names the computer.
const LibraryConnected =
  ROOT +
  libraryBase.replace(
    "</header>",
    '</header><div class="mob-status-line m-secondary" role="status"><span class="mob-status--success">✓ Connecté</span><span>·</span><span>Ordinateur de l\x27atelier</span></div>',
  ) +
  "</div>";

// ── 7. Settings ─────────────────────────────────────────────────────────────────────────────
const setRow = (label, value = "") =>
  '<button class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  label +
  '</span></span><span class="mob-row-trail m-secondary">' +
  (value ? "<span>" + value + "</span>" : "") +
  chevron +
  "</span></button>";
const group = (title, rows) =>
  '<h2 class="mob-section-header m-secondary">' +
  title +
  '</h2><div style="background:var(--bg-panel)">' +
  rows +
  "</div>";
const Settings =
  ROOT +
  topbar('<h1 class="mob-topbar-title m-title">Réglages</h1>') +
  '<div class="mob-scroll" style="flex:1">' +
  group(
    "Observation",
    setRow("Setups", "3") + setRow("Lieu d\x27observation", LOC),
  ) +
  group(
    "Apparence",
    setRow("Langue", "Français") +
      setRow("Thème", "Froid moderne"),
  ) +
  group(
    "Astrometry.net",
    setRow(
      "Clé astrometry.net",
      '<span class="mob-status--success">✓ Configurée</span>',
    ),
  ) +
  group(
    "Ordinateur et données",
    setRow("Connexion à l\x27ordinateur", "LAN") +
      setRow("Exporter / Importer les données"),
  ) +
  group("Application", setRow("À propos", "0.12.0")) +
  "</div>" +
  tabbar("Réglages") +
  "</div>";

// ── Batch 2a: photo flows ───────────────────────────────────────────────────────────────────
// A row with an optional leading icon and a title over a helper line (the helper may wrap: a reason is never ellipsised).
const lineRow = (ic, title, sub, extra = "", attrs = "") =>
  '<button class="mob-row' +
  extra +
  '"' +
  attrs +
  ">" +
  (ic ? '<span class="mob-row-lead">' + I(ic) + "</span>" : "") +
  '<span class="mob-row-body"><span class="mob-row-title m-body">' +
  title +
  "</span>" +
  (sub
    ? '<span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
      sub +
      "</span>"
    : "") +
  "</span></button>";
const helper = (text) => '<p class="mob-helper m-secondary">' + text + "</p>";
const infoBtn = (what) => iconBtn("Informations : " + what, "info");
// A content-height bottom sheet over a scrim, flush with the bottom of the screen.
const sheetOver = (
  id,
  title,
  body,
  cls = "mob-sheet--auto",
  header = "",
  footer = "",
  headerCls = "",
  lead = "",
) =>
  '<div class="mob-scrim"></div><section class="mob-sheet ' +
  cls +
  '" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="' +
  id +
  '"><button class="mob-sheet-grab" aria-label="Fermer"><span class="mob-sheet-handle"></span></button><div class="mob-sheet-header' +
  headerCls +
  '">' +
  lead +
  '<h2 id="' +
  id +
  '" class="m-title" style="color:var(--text-bright)">' +
  title +
  "</h2>" +
  header +
  '</div><div class="mob-sheet-body mob-scroll">' +
  body +
  "</div>" +
  footer +
  "</section>";

// A. Library, add-a-photo sheet
const LibraryAdd =
  ROOT +
  libraryBase +
  sheetOver(
    "add-title",
    "Ajouter des photos",
    lineRow(
      "folder",
      "Choisir des fichiers",
      "JPEG, PNG, TIF, TIFF, FIT, FITS, XISF",
    ) + lineRow("image", "Depuis la galerie du téléphone", ""),
  ) +
  "</div>";

// B. Import review: one row per file (thumbnail, name, status), one primary button.
const importRow = (file, status, kind) => {
  const body =
    '<span class="mob-row-thumb">' +
    I("image") +
    '</span><span class="mob-row-body"><span class="mob-row-title m-body">' +
    file +
    '</span><span class="mob-row-sub m-secondary' +
    (kind === "ok" ? " mob-status--success" : "") +
    (kind === "busy" ? " mob-row-sub--busy" : "") +
    '">' +
    (kind === "busy" ? '<span class="auto-solve-spinner" aria-hidden="true"></span>' : "") +
    status +
    "</span></span>";
  return kind === "todo"
    ? '<button class="mob-row">' +
        body +
        '<span class="mob-row-trail">' +
        chevron +
        "</span></button>"
    : '<div class="mob-row">' + body + "</div>";
};
const importReviewBase =
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Importer 3 photos</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1;padding-top:var(--space-4)"><div style="background:var(--bg-panel)">' +
  importRow("M31_2025-09-14_stack.fits", "✓ Déjà résolue", "ok") +
  importRow(
    "NGC7000_HaOIII_2025-08-23_integration_bin1_crop.tif",
    "Résolution",
    "busy",
  ) +
  importRow("M45_2024-11-02_RGB.jpg", "À placer", "todo") +
  "</div>" +
  "</div>" +
  '<div class="mob-footer" style="flex:none"><button class="mob-btn mob-btn--confirm mob-btn--lg mob-btn--block m-body-strong">Importer</button></div>';
const ImportReview = ROOT + importReviewBase + "</div>";

// C. Placement method sheet over the import review
const ImportMethod =
  ROOT +
  importReviewBase +
  sheetOver(
    "method-title",
    "Comment placer cette photo ?",
    lineRow(
      "",
      "Résoudre en ligne",
      "astrometry.net, nécessite une connexion",
    ) +
      lineRow(
        "",
        "Résoudre sur l\x27ordinateur",
        "Connectez l\x27application à l\x27ordinateur pour utiliser ASTAP",
        "",
        " disabled",
      ) +
      lineRow(
        "",
        "Identifier 2–3 étoiles",
        "Touchez 2 ou 3 étoiles reconnaissables dans la photo, puis identifiez chacune par son nom.",
      ) +
      lineRow(
        "",
        "Placer à la main",
        "Déplacer, agrandir et tourner la photo sur la carte",
      ),
  ) +
  "</div>";

// D. One photo full screen: the stage on the deepest background, an overlaid top bar, the reset-zoom button (shown while zoomed).
const photoViewerBase = (zoomed = false) =>
  '<div class="mob-stage mob-stage--viewer"><div class="mob-stage-caption m-secondary">M31_2025-09-14_stack.jpg</div>' +
  '<header class="mob-topbar mob-topbar--overlay">' +
  iconBtn("Retour", "arrow-left", " mob-icon-btn--float") +
  '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">M31</h1>' +
  iconBtn("Informations sur la photo", "info", " mob-icon-btn--float") +
  "</header>" +
  (zoomed
    ? iconBtn(
        "Réinitialiser le zoom",
        "reset-zoom",
        " mob-icon-btn--float mob-float-br",
      )
    : "") +
  "</div>";
const PhotoDetail = ROOT + photoViewerBase() + "</div>";
// PhotoZoomed: the same viewer once pinched in; the reset-zoom button appears only now (touch decision 8).
const PhotoZoomed = ROOT + photoViewerBase(true) + "</div>";

// E. Photo info sheet over the viewer: object, facts, actions.
const photoInfoSheet = sheetOver(
  "info-title",
  "Galaxie d\x27Andromède",
  '<div class="mob-facts mob-facts--2" style="padding-top:var(--space-4)">' +
    fact("Date d\x27observation", "14 sept. 2025") +
    fact("Exposition totale", "4 h 20 min") +
    fact("Équipement", "Équipement 1") +
    fact("Filtres", "L, R, G, B") +
    "</div>" +
    '<div class="mob-icon-row" role="group" aria-label="Actions sur la photo">' +
    iconBtn("Voir sur la carte", "map-pin") +
    iconBtn("Modifier les informations", "pen") +
    iconBtn("Identifier les objets", "target") +
    iconBtn("Supprimer", "trash", " mob-icon-btn--danger") +
    "</div>",
  "mob-sheet--auto-lg",
  meta("M31", "Galaxie spirale", "AND"),
);
const PhotoInfo = ROOT + photoViewerBase() + photoInfoSheet + "</div>";

// F. Manual placement: map with the photo outline, a hint, and a bottom panel (not a sheet) with three sliders and a switch.
const sliderRow = (id, label, min, max, value, text, step = null) =>
  '<div class="mob-slider-row"><label class="mob-slider-label m-body" for="' +
  id +
  '">' +
  label +
  '</label><input id="' +
  id +
  '" class="mob-slider" type="range" min="' +
  min +
  '" max="' +
  max +
  '" value="' +
  value +
  '"' +
  (step ? ' step="' + step + '"' : "") +
  '><span class="mob-slider-value m-mono">' +
  text +
  "</span></div>";
const footerBtns = (validateAttrs = "") =>
  '<div class="mob-sheet-footer"><button class="mob-btn mob-btn--lg m-body">Annuler</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong"' +
  validateAttrs +
  ">Valider</button></div>";
const Placement =
  ROOT +
  topbar('<h1 class="mob-topbar-title m-title">Placer la photo</h1>') +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;left:0;right:0;bottom:var(--mobile-gutter)">Carte du ciel</div>' +
  '<div class="mob-map-hint m-secondary">Un doigt : déplacer · Deux doigts : agrandir et tourner</div>' +
  '<div class="mob-map-photo m-secondary" style="left:calc(50% - 110px);top:150px;width:220px;height:150px;transform:rotate(12deg)">M31_2025-09-14_stack.jpg</div>' +
  "</main>" +
  '<section class="mob-panel" aria-label="Réglages de placement">' +
  sliderRow("rot", "Rotation", -180, 180, 12, "12°") +
  sliderRow("size", "Taille", 10, 400, 100, "100 %") +
  sliderRow("opa", "Opacité", 0, 1, 0.85, "0.85", 0.05) +
  '<label class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">Miroir</span></span><input class="mob-switch" type="checkbox" role="switch"></label>' +
  footerBtns() +
  "</section></div>";

// G. Star identification (desktop: 2 or 3 stars, minimum 2): the photo with three numbered markers (3 is being dragged, with its magnifier) and a panel of three rows, the third optional; two stars named, so "Valider" is enabled.
const marker = (n, left, top, active) =>
  '<button class="mob-marker' +
  (active ? " mob-marker--active" : "") +
  '" aria-label="Point ' +
  n +
  '" style="left:calc(' +
  left +
  " - 24px);top:calc(" +
  top +
  ' - 24px)"><span class="mob-marker-dot m-secondary">' +
  n +
  "</span></button>";
const starRow = (n, name) =>
  '<button class="mob-row"><span class="mob-row-lead m-body-strong">' +
  n +
  '</span><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span></span><span class="mob-row-trail mob-row-trail--cell mob-status--success">' +
  I("check") +
  "</span></button>";
// Revision 9. The desktop's "Carte" button of each point entry (photo-overlay.ts, class btn-pick-map, text modal.mapPick "Carte", title modal.mapPickTooltip
// "Choisir sur la carte"): here a 48 x 48 icon-only button to the right of the field, aria-label = the title.
const mapPickBtn =
  '<button class="mob-btn mob-btn--icon" aria-label="Choisir sur la carte">' +
  I("map") +
  "</button>";
const ThreePoint =
  ROOT +
  topbar('<h1 class="mob-topbar-title m-title">Identifier les étoiles</h1>') +
  '<main class="mob-stage"><div class="mob-stage-caption m-secondary" style="align-items:flex-start;padding-top:var(--mobile-gutter)">M31_2025-09-14_stack.jpg</div>' +
  marker(1, "26%", "24%", false) +
  marker(2, "74%", "40%", false) +
  marker(3, "50%", "74%", true) +
  '<div class="mob-magnifier" style="left:calc(50% - 48px);top:calc(74% - 24px - 16px - 96px)"></div>' +
  "</main>" +
  '<section class="mob-panel" aria-label="Étoiles de repère">' +
  starRow(1, "Deneb") +
  starRow(2, "Sadr") +
  '<div class="mob-row"><span class="mob-row-lead m-body-strong">3</span><span class="mob-row-body"><input class="mob-field m-body" type="text" placeholder="Nom de l\x27étoile…" aria-label="Nom de l\x27étoile 3"></span>' +
  mapPickBtn +
  "</div>" +
  helper("Placez et nommez 2 ou 3 étoiles pour valider.") +
  footerBtns() +
  "</section></div>";

// G2. ThreePointSearch: the third field of ThreePoint is focused and "den" is typed. The desktop (photo-overlay.ts, the manual identification
// modal: `searchStarsAPI(query)` on /api/stars/search, 250 ms after the last key, up to 10 results ranked by score) lists, per result, the
// server's one-string label (`starLabel`: "Name (bayer Cst)", else "desig Cst", "flam Cst" or "HIP n (Cst, mag m)") and "mag N.N"; a tap on a
// result fills the row (`selectStar`) and closes the list. The phone shows four, the first highlighted; the panel is cut down to the list and the
// row being edited (the two named rows, the helper and the footer come back when the keyboard closes). The four results are the real ones of
// the desktop's catalogue for "den" (score = match + 2 x (6 - mag)): Deneb, Denebola, Deneb Algedi, Deneb Kaitos Shemali.
const suggestRow = (label, mag, selected) =>
  '<button class="mob-row" role="option" aria-selected="' +
  (selected ? "true" : "false") +
  '"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  label +
  '</span></span><span class="mob-row-trail m-secondary">mag ' +
  mag +
  "</span></button>";
const ThreePointSearch =
  ROOT +
  topbar('<h1 class="mob-topbar-title m-title">Identifier les étoiles</h1>') +
  '<main class="mob-stage"><div class="mob-stage-caption m-secondary" style="align-items:flex-start;padding-top:var(--mobile-gutter)">M31_2025-09-14_stack.jpg</div>' +
  marker(1, "26%", "30%", false) +
  marker(2, "74%", "44%", false) +
  marker(3, "50%", "76%", false) +
  "</main>" +
  '<section class="mob-panel" aria-label="Étoiles de repère">' +
  '<div id="star-suggest" role="listbox" aria-label="Étoiles proposées">' +
  suggestRow("Deneb (α Cyg)", "1.3", true) +
  suggestRow("Denebola (β Leo)", "2.1", false) +
  suggestRow("Deneb Algedi (δ Cap)", "2.9", false) +
  suggestRow("Deneb Kaitos Shemali (ι Cet)", "3.6", false) +
  "</div>" +
  '<div class="mob-row"><span class="mob-row-lead m-body-strong">3</span><span class="mob-row-body"><div class="mob-search-wrap"><input class="mob-field m-body" type="text" role="combobox" aria-expanded="true" aria-controls="star-suggest" placeholder="Nom de l\x27étoile…" aria-label="Nom de l\x27étoile 3" value="den" style="border-color:var(--border-focus)"><button class="mob-search-clear" aria-label="Effacer">' +
  I("close-x") +
  "</button></div></span>" +
  mapPickBtn +
  "</div>" +
  "</section>" +
  '<div class="mob-keyboard m-secondary" role="img" aria-label="Emplacement du clavier">Clavier</div>' +
  "</div>";

// G3. ThreePointMap: the "Carte" pick button of a point entry. Desktop (photo-overlay.ts, the manual identification modal): the button hides the dialog and calls
// skyMap.enterPickingMode(cb) (sky-map.ts: crosshair cursor, frame and photo/DSO clicks swallowed, sky-map-events.ts); a click that is not a drag selects the closest
// star (findClosestStar) and the callback fills the row (selectStar, label = starDisplayLabel: "Name (bayer Cst)", else "desig Cst", "flam Cst", else "HIP n (Cst, mag m)"),
// closes the picking mode and shows the dialog again; Escape cancels. The desktop prints no title, hint or confirmation in this mode. The phone: the full-screen map
// (no tab bar), the tapped star ringed with its label, a panel with the row being filled (3) showing the label and "mag N.N" (the dropdown's wording), "Annuler"
// (= Escape) and "Valider" (a tap on a small screen is imprecise, so the choice is confirmed; disabled until a star is tapped, drawn in the picked state).
// Title: the desktop has none for this mode; its wording for the action is the tooltip "Choisir sur la carte" (modal.mapPickTooltip), used here.
const skyStar = (x, y, r, cls = "") =>
  '<circle class="mob-sky-star' +
  cls +
  '" cx="' +
  x +
  '" cy="' +
  y +
  '" r="' +
  r +
  '"></circle>';
const skyLayer = (inner, label) =>
  '<svg class="mob-map-drawing" role="img" aria-label="' +
  label +
  '" focusable="false">' +
  inner +
  "</svg>";
const ThreePointMap =
  ROOT +
  topbar('<h1 class="mob-topbar-title m-title">Choisir sur la carte</h1>') +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;left:0;right:0;bottom:var(--mobile-gutter)">Carte du ciel</div>' +
  skyLayer(
    [
      [62, 150, 2],
      [120, 96, 3],
      [250, 120, 1.5],
      [318, 214, 2.5],
      [84, 252, 2],
      [262, 372, 3.5],
      [330, 468, 2],
      [110, 430, 2.5],
      [196, 520, 1.5],
      [60, 560, 2],
      [290, 600, 2],
    ]
      .map((a) => skyStar(...a))
      .join("") +
      skyStar(176, 318, 4.5, " mob-sky-star--picked") +
      '<circle class="mob-sky-ring" cx="176" cy="318" r="16"></circle>' +
      '<text class="mob-sky-label m-caption" x="198" y="302">Deneb (α Cyg)</text>',
    "Étoiles de la carte : Deneb (α Cyg) choisie",
  ) +
  "</main>" +
  '<section class="mob-panel" aria-label="Étoile choisie">' +
  '<div class="mob-row"><span class="mob-row-lead m-body-strong">3</span><span class="mob-row-body"><span class="mob-row-title m-body">Deneb (α Cyg)</span></span><span class="mob-row-trail m-secondary">mag 1.3</span></div>' +
  footerBtns() +
  "</section></div>";

// ── Batch 2b: map modes, plan and filter sheets, computer connection ───────────────────────
const formRow = (label, control, id) =>
  '<div class="mob-form-row"><label class="mob-form-label m-secondary" for="' +
  id +
  '">' +
  label +
  "</label>" +
  control +
  "</div>";
const textField = (id, placeholder, value = "", attrs = "") =>
  '<input id="' +
  id +
  '" class="mob-field m-body" type="text" placeholder="' +
  placeholder +
  '"' +
  (value ? ' value="' + value + '"' : "") +
  attrs +
  ">";
// A field-like button holding a key and a value (a select or a picker): "Couleur" ... swatch ▾.
const keyField = (key, valueHtml, aria) =>
  '<div class="mob-form-row" style="padding-bottom:var(--space-4)"><button class="mob-btn mob-btn--field mob-btn--block m-body" aria-label="' +
  (aria || key) +
  '"><span class="mob-btn-key">' +
  key +
  '</span><span class="mob-btn-value mob-btn-value--swatch">' +
  valueHtml +
  '</span><span class="mob-btn-caret" aria-hidden="true">' +
  CARET +
  "</span></button></div>";
const swatch = (color) =>
  '<span class="mob-swatch" style="background:' + color + '"></span>';
const doneFooter = (doneLabel, attrs = "") =>
  '<div class="mob-sheet-footer"><button class="mob-btn mob-btn--lg m-body">Annuler</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong"' +
  attrs +
  ">" +
  doneLabel +
  "</button></div>";

// H. Region drawing: a freehand closed outline (seeded wobble so it is stable) over the map, name and colour of the region.
function handDrawn() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const pts = [];
  const N = 44;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    // a lumpy blob, wider than tall, with a notch on the right: not a rectangle, not an ellipse
    const wob = 1 + 0.16 * Math.sin(a * 3 + 0.8) + 0.07 * Math.sin(a * 5);
    const rx = 112 * wob,
      ry = 96 * wob;
    pts.push([
      180 + rx * Math.cos(a) + rnd() * 4.5,
      250 + ry * Math.sin(a) + rnd() * 4.5,
    ]);
  }
  let d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
  for (let i = 1; i <= N; i++) {
    const p = pts[i % N];
    d += " L" + p[0].toFixed(1) + " " + p[1].toFixed(1);
  }
  return d + " Z";
}
const RegionDraw =
  ROOT +
  topbar('<h1 class="mob-topbar-title m-title">Dessiner une région</h1>') +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;left:0;right:0;bottom:var(--mobile-gutter)">Carte du ciel</div>' +
  '<div class="mob-map-hint m-secondary">Un doigt : dessiner · Deux doigts : déplacer la carte</div>' +
  '<svg class="mob-map-drawing" viewBox="0 0 360 520" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><path d="' +
  handDrawn() +
  '"></path></svg>' +
  "</main>" +
  '<section class="mob-panel" aria-label="Région du ciel">' +
  formRow(
    "Nom",
    textField("region-name", "ex. Vue depuis le jardin"),
    "region-name",
  ) +
  keyField("Couleur", swatch("#4ea1ff"), "Couleur : bleu") +
  '<div class="mob-form-row"><button class="mob-btn mob-btn--block m-body">Effacer le tracé</button></div>' +
  doneFooter("Terminer") +
  "</section></div>";

// I. Frame edit: the Ciel tab with a field-of-view frame selected, a content-height sheet (same construction as SkyObject).
let swSeq = 0;
const switchRow = (title, sub = "", checked = false, info = "") => {
  if (info) {
    const id = "sw-info-" + ++swSeq;
    return (
      '<div class="mob-row mob-row--info"><label class="mob-row-body" for="' +
      id +
      '"><span class="mob-row-title mob-row-title--wrap m-body">' +
      title +
      "</span></label>" +
      infoBtn(info) +
      '<input id="' +
      id +
      '" class="mob-switch" type="checkbox" role="switch"' +
      (checked ? " checked" : "") +
      "></div>"
    );
  }
  return (
    '<label class="mob-row"><span class="mob-row-body"><span class="mob-row-title mob-row-title--wrap m-body">' +
    title +
    "</span>" +
    (sub
      ? '<span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
        sub +
        "</span>"
      : "") +
    '</span><input class="mob-switch" type="checkbox" role="switch"' +
    (checked ? " checked" : "") +
    "></label>"
  );
};
const stepperRow = (label, value, minusLabel, plusLabel) =>
  '<div class="mob-stepper-row"><span class="mob-stepper-label m-body">' +
  label +
  '</span><button class="mob-btn m-body" aria-label="' +
  minusLabel +
  '">' +
  I("minus") +
  '</button><span class="mob-stepper-value m-mono">' +
  value +
  '</span><button class="mob-btn m-body" aria-label="' +
  plusLabel +
  '">' +
  I("plus") +
  "</button></div>";
// Field-of-view frames, drawn as the desktop draws them (src/sky-frame-render.ts renderFovInstances, src/frame-draw.ts, FRAME in canvas-theme.ts).
// Every frame is a dashed 8 4 polygon with its setup name (f.name) along its longest edge, upright (photoLabelEdgeIndex / photoLabelTransform:
// from the first corner, or the second when the edge would read upside down), 4px along and 5px above the edge. The SELECTED frame is at
// full opacity in the accent colour (--accent-color), 2px wide, and carries the marks of drawFrameHandles: the move dot (r 4) at the centre
// and the rotation needle (from the middle of the top edge, 24px out) ending in a dot (r 5). An unselected frame is the red
// --fov-frame-stroke / --fov-frame-label at 50 % opacity, 1.5px wide, with no mark. Not drawn on the phone (the sheet has the control): the
// corner squares (resize: the Lignes / Colonnes steppers) and the pin glyph (the Épingler switch). The 12px label is the phone's type floor
// (the desktop draws 11px). name is the label, active the selected one.
const f2 = (n) => +n.toFixed(2);
function fovFrame({ cx, cy, w, h, rot, name, active, photo = false }) {
  const a = (rot * Math.PI) / 180;
  const co = Math.cos(a),
    si = Math.sin(a);
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * co - y * si, y: cy + x * si + y * co }));
  const len0 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const len1 = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
  const e = len1 > len0 ? 1 : 0;
  const p0 = pts[e],
    p1 = pts[(e + 1) % 4];
  let ang = Math.atan2(p1.y - p0.y, p1.x - p0.x),
    at = p0;
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) {
    ang += Math.PI;
    if (ang > Math.PI) ang -= 2 * Math.PI;
    at = p1;
  }
  const idle = active ? "" : " mob-fov--idle";
  let s =
    '<polygon class="' +
    (photo ? "mob-photo-outline" : "mob-fov-frame" + idle) +
    '" points="' +
    pts.map((p) => f2(p.x) + "," + f2(p.y)).join(" ") +
    '"></polygon>' +
    '<text class="' +
    (photo ? "mob-photo-label m-caption" : "mob-fov-label m-caption" + idle) +
    '" transform="translate(' +
    f2(at.x) +
    " " +
    f2(at.y) +
    ") rotate(" +
    f2((ang * 180) / Math.PI) +
    ')" x="4" y="-5">' +
    name +
    "</text>";
  if (active && !photo) {
    const hh = h / 2;
    const tx = cx + hh * si,
      ty = cy - hh * co;
    const hx = cx + (hh + 24) * si,
      hy = cy - (hh + 24) * co;
    s +=
      '<line class="mob-fov-needle" x1="' +
      f2(tx) +
      '" y1="' +
      f2(ty) +
      '" x2="' +
      f2(hx) +
      '" y2="' +
      f2(hy) +
      '"></line>' +
      '<circle class="mob-fov-dot" cx="' +
      f2(hx) +
      '" cy="' +
      f2(hy) +
      '" r="5"></circle>' +
      '<circle class="mob-fov-dot" cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="4"></circle>';
  }
  return s;
}
// The map's frames, as px in the map's own box (its top-left is the screen's): one selected, one unselected (same setup, another target).
const FRAME_SEL = {
  cx: 118,
  cy: 190,
  w: 168,
  h: 92,
  rot: 24,
  name: "Équipement 1",
  active: true,
};
const FRAME_IDLE = {
  cx: 240,
  cy: 312,
  w: 168,
  h: 92,
  rot: -12,
  name: "Équipement 1",
  active: false,
};
const fovLayer = (inner, label) =>
  '<svg class="mob-map-drawing" role="img" aria-label="' +
  label +
  '" focusable="false">' +
  inner +
  "</svg>";
const FrameEdit =
  ROOT +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;inset:0">Carte du ciel</div>' +
  mapControls() +
  fovLayer(
    fovFrame(FRAME_IDLE) + fovFrame(FRAME_SEL),
    "Cadres du setup Équipement 1 : un sélectionné, un non sélectionné",
  ) +
  '<section class="mob-sheet mob-sheet--auto" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="frame-title">' +
  '<button class="mob-sheet-grab" aria-label="Fermer"><span class="mob-sheet-handle"></span></button>' +
  '<div class="mob-sheet-header"><h2 id="frame-title" class="m-title" style="color:var(--text-bright)">Galaxie d\x27Andromède</h2>' +
  '<div class="mob-meta m-secondary"><span>Équipement 1 · Askar FRA400 + ASI533MC</span></div></div>' +
  '<div class="mob-sheet-body mob-scroll">' +
  sliderRow("frame-rot", "Rotation", 0, 360, 24, "24°") +
  '<div class="mob-btn-row">' +
  [
    "−5°|Tourner de moins 5 degrés",
    "−1°|Tourner de moins 1 degré",
    "+1°|Tourner de plus 1 degré",
    "+5°|Tourner de plus 5 degrés",
  ]
    .map(
      (x) =>
        '<button class="mob-btn m-body" aria-label="' +
        x.split("|")[1] +
        '">' +
        x.split("|")[0] +
        "</button>",
    )
    .join("") +
  "</div>" +
  switchRow("Épingler", "", true) +
  stepperRow("Lignes", 2, "Moins de lignes", "Plus de lignes") +
  stepperRow("Colonnes", 3, "Moins de colonnes", "Plus de colonnes") +
  lineRow("trash", "Supprimer le cadre", "", " mob-row--danger") +
  "</div></section></main>" +
  tabbar("Ciel") +
  "</div>";

// I2. FrameMove: the selected frame while a finger drags it. The sheet is cut down to its handle and title. On the desktop (frame-controller.ts
// handleDragMove; sky-map-events.ts) the frame keeps its selected look and its marks, its centre follows the cursor exactly, and nothing else
// is drawn on the map but the ELASTIC LINE (drawElasticSnapLine): while a DSO is within snap range (Épingler on) a line runs from the frame centre to
// the DSO centre, alpha 0.5 + 0.5 x tension, width 1.5 + 1.5 x tension, with a ring (r 5) at the DSO centre; the frame springs to the DSO on release.
// The desktop draws no ghost of the old place and no read-out while moving (hover tooltips are off during a frame drag; the angle is in the frame list). The
// ring around the centre is the finger (wireframe annotation, not part of the app).
const FrameMove =
  ROOT +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;inset:0">Carte du ciel</div>' +
  mapControls() +
  fovLayer(
    fovFrame(FRAME_IDLE) +
      fovFrame({ ...FRAME_SEL, cx: 170, cy: 590 }) +
      '<line class="mob-fov-elastic" x1="170" y1="590" x2="206" y2="616" style="stroke-opacity:0.72;stroke-width:2.2"></line>' +
      '<circle class="mob-fov-snap" cx="206" cy="616" r="5"></circle>' +
      '<circle class="mob-fov-touch" cx="170" cy="590" r="24"></circle>',
    "Cadre sélectionné en cours de déplacement vers l\x27objet le plus proche",
  ) +
  '<section class="mob-sheet mob-sheet--auto" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="move-title">' +
  '<button class="mob-sheet-grab" aria-label="Fermer"><span class="mob-sheet-handle"></span></button>' +
  '<div class="mob-sheet-header"><h2 id="move-title" class="m-title" style="color:var(--text-bright)">Galaxie d\x27Andromède</h2></div>' +
  "</section></main>" +
  tabbar("Ciel") +
  "</div>";

// J. Observation window of a plan entry, over the dimmed plan detail. Fields of the desktop's ObservationWindow:
// start and end (fractions of the night, shown as clock times), filter, colour, single-frame seconds, snap.
const planDetailInner = PlanDetail.slice(
  ROOT.length,
  PlanDetail.length - "</div>".length,
);
const timeField = (id, value) =>
  '<input id="' +
  id +
  '" class="mob-field m-body" type="text" readonly value="' +
  value +
  '">';
const ObsWindow =
  ROOT +
  planDetailInner +
  sheetOver(
    "obs-title",
    "Fenêtre d\x27observation",
    '<div class="mob-form-row mob-form-row--pair"><div><label class="mob-form-label m-secondary" for="obs-start">Début</label>' +
      timeField("obs-start", "21:00") +
      '</div><div><label class="mob-form-label m-secondary" for="obs-end">Fin</label>' +
      timeField("obs-end", "22:30") +
      "</div></div>" +
      helper("Durée de la fenêtre : 1 h 30 min · 30 poses de 180 s") +
      keyField("Filtre", "Ha", "Filtre : Ha") +
      keyField(
        "Couleur de la fenêtre",
        swatch("var(--filter-ha-text)"),
        "Couleur de la fenêtre : celle du filtre",
      ) +
      '<div class="mob-input-row"><label class="m-body" for="obs-frame">Pose unitaire</label><span class="mob-input-row-derived m-mono">30</span><span class="mob-input-row-unit m-body" aria-hidden="true">×</span><input id="obs-frame" class="mob-field m-body" type="text" inputmode="numeric" value="180"><span class="mob-input-row-unit m-body">s</span></div>' +
      switchRow(
        "Aligner sur la pose unitaire",
        "",
        true,
        "Aligner sur la pose unitaire",
      ),
    "mob-sheet--auto-lg",
    '<div class="mob-meta m-secondary"><span>Nébuleuse de l\x27Amérique du Nord · Équipement 1</span></div>',
    '<div class="mob-sheet-footer"><button class="mob-btn mob-btn--danger mob-btn--lg m-body">Supprimer</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong">Enregistrer</button></div>',
  ) +
  "</div>";

// K. Targets filters sheet: the desktop's refinement filters (everything but the types, the gear, the place and the night,
// which sit in the context row). Selects are key-and-value fields, ranges are slider rows, sets are toggle buttons, booleans are switches.
const sectionHeader = (t) =>
  '<h3 class="mob-section-header m-secondary">' + t + "</h3>";
const groupLabel = (t) =>
  '<div class="mob-form-row mob-form-row--title"><span class="mob-form-label m-secondary">' +
  t +
  "</span></div>";
const groupLabelInfo = (t, info) =>
  '<div class="mob-form-row mob-form-row--title mob-form-row--bar"><span class="mob-form-label m-secondary">' +
  t +
  "</span>" +
  infoBtn(info) +
  "</div>";
const toggleRow = (items) =>
  '<div class="mob-btn-row">' +
  items
    .map(
      ([html, aria, on]) =>
        '<button class="mob-btn m-body" aria-pressed="' +
        (on ? "true" : "false") +
        '" aria-label="' +
        aria +
        '">' +
        html +
        "</button>",
    )
    .join("") +
  "</div>";
const filterBody =
  sectionHeader("Ciel") +
  groupLabelInfo("Ciel observable", "Ciel observable") +
  toggleRow([
    [dirIcon("arrow-up") + "Nord", "Nord", true],
    [dirIcon("arrow-down") + "Sud", "Sud", true],
    [dirIcon("arrow-right") + "Est", "Est", true],
    [dirIcon("arrow-left") + "Ouest", "Ouest", false],
  ]) +
  keyField("Région du ciel", "Tout le ciel", "Région du ciel : tout le ciel") +
  groupLabel("Altitude") +
  sliderRow("alt-min", "Min", 0, 89, 20, "20°") +
  sliderRow("alt-max", "Max", 1, 90, 80, "80°") +
  sectionHeader("Fenêtre d\x27observation") +
  '<div class="mob-form-row mob-form-row--pair"><div><label class="mob-form-label m-secondary" for="win-from">De</label>' +
  timeField("win-from", "22:00") +
  '</div><div><label class="mob-form-label m-secondary" for="win-to">à</label>' +
  timeField("win-to", "02:00") +
  "</div></div>" +
  sectionHeader("Objets") +
  groupLabel("Intérêt DSO") +
  toggleRow(
    [1, 2, 3, 4, 5].map((n) => [
      "<span>" + n + '</span><span class="mob-rating">★</span>',
      "Intérêt " + n + " sur 5",
      n >= 3,
    ]),
  ) +
  groupLabel("Difficulté") +
  toggleRow(
    [1, 2, 3, 4, 5].map((n) => [
      "<span>" +
        n +
        "</span>" +
        I("diamond").replace("<svg ", '<svg class="mob-icon--sm" '),
      "Difficulté " + n + " sur 5",
      n <= 3,
    ]),
  ) +
  keyField("Catalogues", "10 / 10", "Catalogues : 10 sur 10") +
  keyField("Constellations", "88 / 88", "Constellations : 88 sur 88") +
  sectionHeader("Options") +
  switchRow(
    "Inclure les objets trop grands pour le champ",
    "",
    false,
    "Inclure les objets trop grands pour le champ",
  ) +
  switchRow(
    "Exclure les objets déjà photographiés",
    "",
    false,
    "Exclure les objets déjà photographiés",
  ) +
  switchRow("Respecter l\x27horizon");
const TargetsFilter =
  ROOT +
  targetsBase("2 types") +
  sheetOver(
    "filters-title",
    "Filtres",
    filterBody,
    "mob-sheet--auto-lg",
    "",
    '<div class="mob-sheet-footer"><button class="mob-btn mob-btn--lg m-body">Réinitialiser</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong">Appliquer</button></div>',
  ) +
  "</div>";

// L. Draw order of the photos on the map (pushed from Galerie). The desktop lists the placed photos in reverse placement
// order, so the first row is the one drawn on top. One row is lifted while it is dragged, a dashed slot marks the drop place.
const orderRow = (id, file, cls = "", style = "") =>
  '<div class="mob-entry' +
  cls +
  '"' +
  style +
  '><button class="mob-drag" aria-label="Déplacer ' +
  file +
  '">' +
  GRIP +
  "</button>" +
  '<div class="mob-row"><span class="mob-row-thumb">' +
  I("image") +
  '</span><span class="mob-row-body"><span class="mob-row-title m-body">' +
  id +
  '</span><span class="mob-row-sub m-secondary">' +
  file +
  "</span></span></div></div>";
// Revision 8b: opened from the photo sheet of the sky map (SkyPhoto), so it is the sky map's, and it has what DrawOrderModal.vue has: the title
// (photos.zOrder), a search field (photos.searchPlaceholder, focused on open), the checkbox photos.overlapOnly (checked by default: only the photos
// that overlap the current one, found with filterDrawOrderPhotos), the list in reverse placement order (first = drawn on top) with a grip per row,
// the current photo's row highlighted (.zorder-item.current). The list therefore holds the current photo (Cygnus_wide_2025-08-23.jpg) and photos
// that overlap it. The desktop prints no explanation; the one under the toggle is the phone's (kept from the earlier screen).
const DrawOrder =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Ordre d\x27affichage</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  '<div class="mob-form-row" style="padding-top:var(--space-4)"><input class="mob-field m-body" type="search" placeholder="Rechercher une photo…" aria-label="Rechercher une photo"></div>' +
  switchRow("Chevauchement uniquement", "", true) +
  '<div class="mob-entry-list" style="margin-top:var(--space-4)">' +
  orderRow("NGC7000", "NGC7000_HaOIII_2025-08-23_integration_bin1_crop.tif") +
  orderRow("NGC7000", "Cygnus_wide_2025-08-23.jpg", " mob-entry--current") +
  '<div class="mob-entry-gap" aria-hidden="true"></div>' +
  orderRow("IC5070", "IC5070_2025-08-24_stack.jpg") +
  orderRow("NGC6910", "NGC6910_2025-09-02_RGB.jpg") +
  orderRow(
    "M29",
    "M29_2025-09-02_RGB.jpg",
    " mob-entry--lifted",
    ' style="top:166px"',
  ) +
  "</div></div></div>";

// M and N. Connection to the computer running MyAstroSky (pushed from Réglages), not connected and connected.
const lanTop = topbar(
  iconBtn("Retour", "arrow-left") +
    '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Connexion à l\x27ordinateur</h1>',
);
const radioRow = (title, sub, checked) =>
  '<label class="mob-row"><span class="mob-row-body"><span class="mob-row-title mob-row-title--wrap m-body">' +
  title +
  '</span><span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
  sub +
  '</span></span><input class="mob-radio" type="radio" name="lan-mode" aria-label="' +
  title +
  '"' +
  (checked ? " checked" : "") +
  "></label>";
const LanPairing =
  ROOT +
  lanTop +
  '<div class="mob-scroll" style="flex:1">' +
  '<div class="mob-form-row" style="padding-top:var(--space-4)"><button class="mob-btn mob-btn--action mob-btn--lg mob-btn--block m-body-strong">' +
  I("qr-code") +
  "Scanner le code QR</button></div>" +
  helper(
    "Une fois connecté, vous affichez la galerie et les plans de l\x27ordinateur, ou vous gardez ceux du téléphone et n\x27utilisez que les solveurs de l\x27ordinateur.",
  ) +
  sectionHeader("Saisie manuelle") +
  formRow(
    "Adresse",
    textField(
      "lan-addr",
      "192.168.1.20:3001",
      "",
      ' inputmode="url" autocapitalize="none"',
    ),
    "lan-addr",
  ) +
  formRow(
    "Code d\x27appairage",
    textField(
      "lan-code",
      "Code affiché sur l\x27ordinateur",
      "",
      ' inputmode="numeric"',
    ),
    "lan-code",
  ) +
  '<div class="mob-form-row"><button class="mob-btn mob-btn--action mob-btn--block m-body-strong" disabled>Se connecter</button></div>' +
  "</div></div>";

const LanConnected =
  ROOT +
  lanTop +
  '<div class="mob-scroll" style="flex:1">' +
  '<div style="padding-top:var(--space-4);background:var(--bg-panel)"><div class="mob-row"><span class="mob-row-body"><span class="mob-row-title mob-status--success m-body-strong">✓ Connecté</span><span class="mob-row-sub m-secondary">Ordinateur de l\x27atelier</span></span></div></div>' +
  '<div style="padding-top:var(--space-7)"><div class="mob-facts mob-facts--2">' +
  fact("Adresse", "192.168.1.20:3001") +
  fact("Version", "0.12.0") +
  "</div></div>" +
  '<div role="radiogroup" aria-label="Données affichées" style="background:var(--bg-panel)">' +
  radioRow(
    "Galerie et plans de l\x27ordinateur",
    "Les photos et les plans affichés sont ceux de l\x27ordinateur.",
    true,
  ) +
  radioRow(
    "Photos et plans du téléphone",
    "Le téléphone garde ses photos et ses plans, et n\x27utilise que les solveurs de l\x27ordinateur (ASTAP, solve-field).",
    false,
  ) +
  "</div>" +
  '<div style="padding-top:var(--space-7)"><div style="background:var(--bg-panel)">' +
  lineRow("unplug", "Se déconnecter", "", " mob-row--danger") +
  "</div></div>" +
  "</div></div>";

// ── Batch 2c: sky search and display, plan entry, photo metadata, identification ────────────
// O. SkySearch: the Ciel tab while searching. The desktop search (src/search.ts searchUnified, UnifiedSearch.vue) is ONE list ranked by
// score (not grouped), up to 15 rows, each row a kind badge (Étoile / DSO), the label and "mag N" when known. Query "andro" finds, in
// dso.json, only M31 (name "Galaxie d'Andromède") and M32 ("Galaxie satellite d'Andromède"); no star name matches.
const searchRow = (name, id, type, cst, mag) =>
  '<button class="mob-row mob-row--roomy"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span><span class="mob-row-sub mob-meta m-secondary"><span>' +
  id +
  '</span><span class="mob-badge mob-badge--type m-caption">' +
  type +
  '</span><span class="mob-badge mob-badge--const m-caption">' +
  cst +
  '</span></span><span class="mob-row-sub m-secondary">Magnitude ' +
  mag +
  "</span></span></button>";
const SkySearch =
  ROOT +
  topbar(
    '<div class="mob-search-wrap"><input id="sky-q" class="mob-search m-body" type="text" inputmode="search" enterkeyhint="search" value="andro" aria-label="Rechercher étoile ou DSO" style="border-color:var(--border-focus)"><button class="mob-search-clear" aria-label="Effacer la recherche">' +
      I("close-x") +
      "</button></div>" +
      '<button class="mob-btn mob-btn--text m-body">Annuler</button>',
  ) +
  '<div class="mob-scroll" style="flex:1;padding-top:var(--space-4);background:var(--bg-panel)">' +
  searchRow(
    "Galaxie d\x27Andromède",
    "M31 (NGC224)",
    "Galaxie spirale",
    "AND",
    "3.4",
  ) +
  searchRow(
    "Galaxie satellite d\x27Andromède",
    "M32 (NGC221 · Arp 168)",
    "Galaxie elliptique",
    "AND",
    "8.1",
  ) +
  "</div>" +
  '<div class="mob-keyboard m-secondary" role="img" aria-label="Emplacement du clavier">Clavier</div>' +
  "</div>";

// P. SkyDisplay: the map's display settings, opened by the last button of the map ribbon (sliders icon). The desktop set is the side panel's "Affichage" section
// (DisplayControlsSection.vue) and its "Performances" section (PerformanceSection.vue). Changes apply at once: no footer, a close button.
const mainInner = Main.slice(ROOT.length, Main.length - "</div>".length);
// Slider with its label above (the label of a desktop setting is too long for the 80 px column of .mob-slider-row); value optional.
const sliderStack = (
  id,
  label,
  min,
  max,
  value,
  text,
  disabled = false,
  step = null,
  info = "",
) =>
  '<div class="mob-slider-row mob-slider-row--stack' +
  (info ? " mob-slider-row--info" : "") +
  '"><label class="mob-slider-label m-body" for="' +
  id +
  '">' +
  label +
  "</label>" +
  (info ? infoBtn(info) : "") +
  '<input id="' +
  id +
  '" class="mob-slider" type="range" min="' +
  min +
  '" max="' +
  max +
  '" value="' +
  value +
  '"' +
  (step ? ' step="' + step + '"' : "") +
  (disabled ? " disabled" : "") +
  ">" +
  (text !== null
    ? '<span class="mob-slider-value m-mono">' + text + "</span>"
    : "") +
  "</div>";
const displayBody =
  sectionHeader("Photos") +
  switchRow("Afficher les photos", "", true) +
  switchRow("Cadres des photos", "", false) +
  switchRow("Afficher les points d\x27intérêt", "", true) +
  keyField("Points d\x27intérêt", "5 / 5", "Points d\x27intérêt : 5 sur 5") +
  keyField("Étiquettes", "3 / 3", "Étiquettes : 3 sur 3") +
  sectionHeader("Étoiles et constellations") +
  switchRow("Afficher les étoiles", "", true) +
  switchRow("Noms des étoiles", "", false) +
  switchRow("Traits des constellations", "", true) +
  switchRow("Noms des constellations", "", false) +
  keyField(
    "Style de tracé",
    "Occidental classique",
    "Style de tracé : occidental classique",
  ) +
  sectionHeader("Objets du ciel profond") +
  switchRow("Afficher les DSO", "", true) +
  switchRow("Noms des DSO", "", true) +
  keyField("Types", "13 / 13", "Types : 13 sur 13") +
  keyField("Catalogues", "4 / 10", "Catalogues : 4 sur 10") +
  sectionHeader("Carte") +
  switchRow("Grille RA/Déc", "", false) +
  keyField("Hémisphère", "Nord", "Hémisphère : Nord") +
  keyField("Projection", "Stéréo", "Projection : Stéréo") +
  sliderStack(
    "lat",
    "Latitude (°)",
    0,
    90,
    45,
    "45°",
    false,
    null,
    "Latitude (°)",
  ) +
  sliderStack("sky-op", "Opacité ciel", 0, 1, 0.7, "0.70", false, 0.05) +
  sliderStack("bg-op", "Gradient de fond", 0, 1, 0.5, "0.50", false, 0.05) +
  sectionHeader("Performances") +
  sliderStack("dens-star", "Densité d\x27étoiles", 0, 1000, 640, null) +
  switchRow("Auto", "", false) +
  sliderStack("dens-dso", "Densité de DSO", 0, 1000, 500, null, true) +
  switchRow("Auto", "", true) +
  switchRow("Déplacement et zoom fluides", "", true);
const SkyDisplay =
  ROOT +
  mainInner +
  '<div class="mob-scrim"></div><section class="mob-sheet mob-sheet--auto-lg" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="display-title">' +
  '<button class="mob-sheet-grab" aria-label="Fermer"><span class="mob-sheet-handle"></span></button>' +
  '<div class="mob-sheet-header mob-sheet-header--bar"><h2 id="display-title" class="m-title" style="color:var(--text-bright)">Affichage</h2>' +
  iconBtn("Fermer", "close-x") +
  "</div>" +
  '<div class="mob-sheet-body mob-scroll">' +
  displayBody +
  "</div></section></div>";

// Q. PlanEntry: one entry of a plan (the desktop's plan row, TargetsView.buildPlanRow). Facts as the row's meta items, then the
// observation windows (colour, filter, de/à, "N × sub s"), "+ Fenêtre d'observation", "Afficher sur la carte", "Retirer du plan".
const winRow = (color, filter, from, to, count, sub) =>
  '<button class="mob-row"><span class="mob-row-lead"><span class="mob-swatch" style="background:' +
  color +
  '"></span></span><span class="mob-row-body"><span class="mob-row-title m-body">' +
  filter +
  '</span><span class="mob-row-sub m-secondary"><span class="m-mono">' +
  from +
  " – " +
  to +
  '</span></span></span><span class="mob-row-trail m-secondary"><span class="m-mono">' +
  count +
  " × " +
  sub +
  " s</span>" +
  chevron +
  "</span></button>";
const diamondIcon = I("diamond").replace("<svg ", '<svg class="mob-icon--sm" ');
const PlanEntry =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Nébuleuse de l\x27Amérique du Nord</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  '<div class="mob-sheet-header" style="padding-top:var(--space-7)">' +
  meta("NGC7000", "Nébuleuse en émission", "CYG") +
  "</div>" +
  '<div class="mob-facts mob-facts--2">' +
  fact("Alt. max", "86°") +
  fact("Transit", "21:38") +
  fact("Magnitude", "4.0") +
  fact("Taille", "2.0°") +
  fact("Distance Lune", "Éloignée (104°)").replace(
    "m-body-strong",
    "m-body-strong mob-status--success",
  ) +
  '<div class="mob-fact"><span class="mob-fact-label m-caption">Intérêt DSO</span><span class="mob-fact-value mob-rating m-body-strong">★★★★★</span></div>' +
  '<div class="mob-fact"><span class="mob-fact-label m-caption">Difficulté</span><span class="mob-fact-value m-body-strong">1' +
  diamondIcon +
  "</span></div>" +
  fact("Angle", "24°") +
  fact("Score", "84 %") +
  fact("Champ", "54 %") +
  '<div class="mob-fact mob-fact--wide"><span class="mob-fact-label m-caption">Équipement</span><span class="mob-fact-value m-body-strong">Équipement 1 · Askar FRA400 + ASI533MC</span></div>' +
  '<div class="mob-fact mob-fact--wide"><span class="mob-fact-label m-caption">Temps total indicatif</span><span class="mob-fact-value m-body-strong">4 h</span></div>' +
  "</div>" +
  '<div style="background:var(--bg-panel)">' +
  lineRow("filter", "Filtres suggérés", "", "").replace(
    "</button>",
    '<span class="mob-row-trail">' + chevron + "</span></button>",
  ) +
  "</div>" +
  '<h2 class="mob-section-header m-secondary">Fenêtres d\x27observation</h2>' +
  '<div style="background:var(--bg-panel)">' +
  winRow("var(--filter-ha-text)", "Ha", "21:00", "22:30", 30, 180) +
  winRow("var(--filter-oiii-text)", "OIII", "22:30", "00:00", 30, 180) +
  lineRow("plus", "Fenêtre d\x27observation", "") +
  "</div>" +
  '<div style="padding-top:var(--space-7)"><div style="background:var(--bg-panel)">' +
  lineRow("map-pin", "Afficher sur la carte", "") +
  lineRow("trash", "Retirer du plan", "", " mob-row--danger") +
  "</div></div>" +
  "</div></div>";

// R. PhotoEdit: the desktop's photo metadata editor (MetadataEditorPanel.vue, mounted by metadata-editor.ts): file name, objects,
// labels, points of interest, integration rows, observation date, equipment, capture details, notes, then "Charger un fichier WCS".
const removableChip = (text, aria) =>
  '<button class="mob-chip mob-chip--remove m-body" aria-label="' +
  aria +
  '"><span>' +
  text +
  "</span>" +
  I("close-x").replace("<svg ", '<svg class="mob-icon--sm" ') +
  "</button>";
const chipsWrap = (items) =>
  '<div class="mob-chip-row mob-chip-row--wrap">' +
  items.map((x) => removableChip(x, "Retirer " + x)).join("") +
  "</div>";
// A text field and its visible "Ajouter" button: a chip is committed by the keyboard's Done key or by this button.
const addRow = (id, placeholder, aria) =>
  '<div class="mob-add-row"><input id="' +
  id +
  '" class="mob-field m-body" type="text" enterkeyhint="done" placeholder="' +
  placeholder +
  '" aria-label="' +
  aria +
  '"><button class="mob-btn mob-btn--icon" aria-label="Ajouter">' +
  I("plus") +
  "</button></div>";
const integrationRow = (n, filter, frames, secs, total) =>
  '<div class="mob-integration"><div class="mob-integration-filter"><label class="mob-form-label m-secondary" for="int-f' +
  n +
  '">Filtre</label><input id="int-f' +
  n +
  '" class="mob-field m-body" type="text" placeholder="filtre" value="' +
  filter +
  '"></div><input id="int-n' +
  n +
  '" class="mob-field m-body" type="text" inputmode="numeric" aria-label="Nombre de poses, ligne ' +
  n +
  '" value="' +
  frames +
  '"><span class="mob-integration-unit m-body" aria-hidden="true">×</span><input id="int-s' +
  n +
  '" class="mob-field m-body" type="text" inputmode="numeric" aria-label="Durée d\x27une pose en secondes, ligne ' +
  n +
  '" value="' +
  secs +
  '"><span class="mob-integration-unit m-body">s</span><span class="mob-integration-total m-mono">= ' +
  total +
  '</span><button class="mob-icon-btn mob-icon-btn--danger" aria-label="Supprimer la ligne d\x27intégration ' +
  n +
  '">' +
  I("trash") +
  "</button></div>";
const captureRow = (id, label, value, unit) =>
  '<div class="mob-field-row"><label class="m-secondary" for="' +
  id +
  '">' +
  label +
  '</label><input id="' +
  id +
  '" class="mob-field m-body" type="text" inputmode="decimal" value="' +
  value +
  '"><span class="m-body" style="color:var(--text-secondary)">' +
  unit +
  '</span><button class="mob-icon-btn mob-icon-btn--danger" aria-label="Supprimer le champ ' +
  label +
  '">' +
  I("trash") +
  "</button></div>";
const photoEditBody =
  sectionHeader("Nom du fichier") +
  '<div class="mob-form-row">' +
  textField(
    "pe-name",
    "Nom du fichier",
    "M31_2025-09-14_stack.jpg",
    ' aria-label="Nom du fichier"',
  ) +
  "</div>" +
  sectionHeader("Objets dans cette image") +
  chipsWrap(["M31", "M32", "M110"]) +
  addRow("pe-dso", "Rechercher un DSO…", "Rechercher un DSO") +
  sectionHeader("Étiquettes") +
  chipsWrap([
    "2025",
    "LRGB",
    "Galaxies",
    "Askar FRA400",
    "Ciel profond",
    "Strasbourg",
    "Balcon",
  ]) +
  addRow("pe-label", "Ajouter une étiquette…", "Ajouter une étiquette") +
  sectionHeader("Points d\x27intérêt") +
  '<div style="background:var(--bg-panel)">' +
  lineRow("plus", "Ajouter un point d\x27intérêt", "") +
  lineRow("poi-asteroid", "Identifier un astéroïde", "") +
  lineRow("poi-supernova", "Identifier des supernovae", "") +
  lineRow("poi-comet", "Identifier des comètes", "") +
  "</div>" +
  sectionHeader("Intégration") +
  integrationRow(1, "L", 40, 180, "2h00") +
  integrationRow(2, "R", 15, 240, "1h00") +
  integrationRow(3, "G", 10, 240, "40min") +
  integrationRow(4, "B", 10, 240, "40min") +
  '<div class="mob-form-row" style="padding-top:var(--space-4)"><button class="mob-btn mob-btn--block m-body">' +
  I("plus") +
  "Ajouter une ligne</button></div>" +
  sectionHeader("Date d\x27observation") +
  '<div class="mob-form-row">' +
  textField(
    "pe-date",
    "",
    "2025-09-14 21:40",
    ' readonly aria-label="Date d\x27observation"',
  ) +
  "</div>" +
  sectionHeader("Équipement") +
  '<div class="mob-form-row"><button class="mob-btn mob-btn--field mob-btn--block m-body" aria-label="Équipement : Équipement 1"><span class="mob-btn-label">Équipement 1</span><span class="mob-btn-caret" aria-hidden="true">' +
  CARET +
  "</span></button></div>" +
  sectionHeader("Détails de capture") +
  captureRow("cap-gain", "Gain", "100", "") +
  captureRow("cap-offset", "Offset", "50", "") +
  captureRow("cap-ccd", "Temp. capteur", "-10", "°C") +
  captureRow("cap-bin", "Binning", "1x1", "") +
  '<div class="mob-add-row"><span class="mob-select-wrap"><select class="mob-select m-body" aria-label="Ajouter un champ"><option value="">Ajouter un champ…</option><option selected>ISO</option><option>Temp. consigne</option></select></span><button class="mob-btn mob-btn--icon" aria-label="Ajouter">' +
  I("plus") +
  "</button></div>" +
  sectionHeader("Notes") +
  '<div class="mob-form-row"><textarea class="mob-field mob-field--multi m-body" rows="3" placeholder="Notes, commentaires…" aria-label="Notes"></textarea></div>' +
  '<div class="mob-form-row" style="padding-top:var(--space-7)"><button class="mob-btn mob-btn--block m-body">Charger un fichier WCS (fits/tiff)</button></div>';
const PhotoEdit =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Modifier les infos</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  photoEditBody +
  "</div>" +
  '<div class="mob-footer mob-sheet-footer" style="flex:none"><button class="mob-btn mob-btn--lg m-body">Annuler</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong">Enregistrer</button></div>' +
  "</div>";

// Identification strings and helpers (the single-sheet `Identify` screen was removed in revision 7: the per-kind screens below replace it). The desktop has three modals (asteroid, comet, supernova: `Asteroid-`,
// `CometIdentifyModal.vue`, `SupernovaIdentifyModal.vue` on `IdentifyModalShell.vue`); here one flow per kind. Each flow: state line,
// the fields the desktop modal has, "Rechercher", then the rows found. The footer is the shell's "Annuler" / "Ajouter la sélection (n)".
// Feedback pass (identification): the paragraphs that explain a search are behind an "i" button at the right end of each section title (or of
// the top bar), "Rechercher" is a 48 x 48 magnifier button at the right end of the row of its input, and the date, time and button columns
// are the same in every row. The explanations (desktop strings, unchanged) are drawn on the IdentifyInfo artboard.
const INFO = {
  asteroid:
    "Marquez le début et la fin de la traînée sur la photo : IMCCE SkyBoT recherche les astéroïdes connus qui passaient là entre ces deux instants. Touchez la traînée sur la photo pour placer le marqueur sélectionné.",
  comet:
    "Calcule où se trouvaient les comètes connues du Minor Planet Center à l\x27heure d\x27observation de cette photo, à partir de leurs orbites actuelles. Les positions sont approximatives (quelques minutes d\x27arc) et les comètes éteintes depuis longtemps ne sont pas listées.",
  supernova:
    "Recherche dans le Transient Name Server (TNS) les supernovae découvertes dans le champ de cette photo jusqu\x27à un an avant sa date d\x27observation.",
};
// The time zone of a time field is always printed: a unit outside the field, in the style of "arcmin" and "s".
const utcUnit =
  '<span class="m-body" style="color:var(--text-secondary)">UTC</span>';
const searchIconBtn =
  '<button class="mob-btn mob-btn--action mob-btn--icon" aria-label="Rechercher">' +
  I("search") +
  "</button>";
const stateLine = (text, cls = "") =>
  '<p class="mob-helper m-body"><span' +
  (cls ? ' class="' + cls + '"' : "") +
  ">" +
  text +
  "</span></p>";
const foundRow = (name, sub, checked) =>
  '<label class="mob-row"><span class="mob-row-body"><span class="mob-row-title mob-row-title--wrap m-body">' +
  name +
  '</span><span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
  sub +
  '</span></span><input class="mob-check" type="checkbox" aria-label="Garder ' +
  name +
  ' comme point d\x27intérêt"' +
  (checked ? " checked" : "") +
  "></label>";
const asteroidRows =
  foundRow("(1685) Toro", "Géocroiseur · Mag 16.2 · Écart (″) 3.1", true) +
  foundRow(
    "(2204) Lyyli",
    "Ceinture principale · Mag 17.4 · Écart (″) 8.6",
    false,
  ) +
  foundRow(
    "(7968) Elst-Pizarro",
    'Ceinture principale · Mag 18.9 · Écart (″) 21.4 · <span class="mob-status--warn">Orbite incertaine</span>',
    false,
  );
// ── Batch 2d: equipment, observing location, data export and import ────────────────────────
// T. GearSetups: the user's gear setups. The desktop has no such list: a setup is an option of a dropdown (setup name + FOV, from
// `fov-overlay.ts` `buildFovFrameSpecs` / `formatSetupCanvasLabel`) next to a [+] and a pencil button; under the dropdown the hint
// "Focale effective: 400 mm · FOV 1.6° × 1.6° · 1.9″/px" (`targets-view.ts`, `gear-presets.ts` `formatGearFovLabel`). The mobile list
// shows, per setup, the name, the gear (`telescopeLabel + cameraLabel [+ accessoryLabel]`) and that hint. The desktop has no per-setup
// "enabled" control (`patchGearSetupEnabled` is never called), so there is no switch.
const gearRow = (name, gear, hint) =>
  '<button class="mob-row mob-row--roomy"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span><span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
  gear +
  '</span><span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
  hint +
  '</span></span><span class="mob-row-trail">' +
  chevron +
  "</span></button>";
const GearSetups =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Setups</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1;padding-top:var(--space-4)"><div style="background:var(--bg-panel)">' +
  gearRow(
    "Équipement 1",
    "Askar FRA400 + ZWO ASI533MC",
    "Focale effective : 400 mm · FOV 1.6° × 1.6° · 1.9″/px",
  ) +
  gearRow(
    "EdgeHD 8 réduit",
    'Celestron EdgeHD 8" + ZWO ASI2600MC Pro + Celestron 0.7x Reducer Lens – EdgeHD 8"',
    "Focale effective : 1422 mm · FOV 57' × 38' · 0.5″/px",
  ) +
  gearRow(
    "Seestar",
    "ZWO Seestar S50 + ZWO Seestar S50 Integrated Sensor",
    "Focale effective : 250 mm · FOV 1.3° × 44' · 2.4″/px",
  ) +
  "</div></div>" +
  '<button class="mob-fab mob-fab--fixed" aria-label="Ajouter un setup">' +
  I("plus") +
  "</button></div>";

// U. GearSetupEdit: the desktop's setup modal (`fov-overlay.ts` `buildSetupModal` + `targets-view.ts` `buildGearSectionContent`), edit mode:
// "Nom du setup *", Télescope / Caméra / Accessoire (selects, each with a "Gérer …" button), "Gérer les filtres" (filters are NOT part of
// a setup), the "Focale effective" hint, "Utilisé par ces plans :" and the delete button (disabled while a plan uses the setup, with the
// reason as a tooltip on the desktop), then Annuler / Enregistrer. Derived values come from `setup-info.ts` `buildSetupInfoRows`.
const pickField = (id, label, value, aria) =>
  '<div class="mob-form-row"><label class="mob-form-label m-secondary" for="' +
  id +
  '">' +
  label +
  '</label><button id="' +
  id +
  '" class="mob-btn mob-btn--field mob-btn--wrap mob-btn--block m-body" aria-label="' +
  aria +
  '"><span class="mob-btn-label">' +
  value +
  '</span><span class="mob-btn-caret" aria-hidden="true">' +
  CARET +
  "</span></button></div>";
// A text button starts at the 16px gutter: its 8px inner padding is pulled back by an equal negative margin.
const manageBtn = (label) =>
  '<div style="background:var(--bg-panel)">' + setRow(label) + "</div>";
const planLine = (name) =>
  '<div class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  "</span></span></div>";
const gearEditBody =
  '<div style="padding-top:var(--space-4)"></div>' +
  formRow(
    'Nom du setup <span style="color:var(--color-danger)">*</span>',
    textField("gs-name", "", "EdgeHD 8 réduit"),
    "gs-name",
  ) +
  sectionHeader("Équipement") +
  pickField(
    "gs-tel",
    "Télescope",
    'Celestron EdgeHD 8"',
    'Télescope : Celestron EdgeHD 8"',
  ) +
  manageBtn("Gérer les télescopes") +
  pickField(
    "gs-cam",
    "Caméra",
    "ZWO ASI2600MC Pro",
    "Caméra : ZWO ASI2600MC Pro",
  ) +
  manageBtn("Gérer les caméras") +
  pickField(
    "gs-acc",
    "Accessoire",
    'Celestron 0.7x Reducer Lens – EdgeHD 8"',
    'Accessoire : Celestron 0.7x Reducer Lens – EdgeHD 8"',
  ) +
  manageBtn("Gérer les accessoires") +
  manageBtn("Gérer les filtres") +
  '<div class="mob-facts mob-facts--2">' +
  fact("Focale effective", "1422 mm") +
  fact("Résolution", "6248 × 4176 px") +
  '<div class="mob-fact mob-fact--wide"><span class="mob-fact-label m-caption">FOV</span><span class="mob-fact-value m-body-strong">57\' × 38\' · 0.5″/px</span></div>' +
  "</div>" +
  sectionHeader("Utilisé par ces plans :") +
  '<div style="background:var(--bg-panel)">' +
  planLine("Nuit du 2026-10-03") +
  planLine("Cygne et Céphée") +
  "</div>" +
  '<div style="padding-top:var(--space-7)"><div style="background:var(--bg-panel)">' +
  lineRow(
    "trash",
    "Supprimer le setup",
    "Ce setup est utilisé par un ou plusieurs plans et ne peut pas être supprimé.",
    " mob-row--danger",
    " disabled",
  ) +
  "</div></div>";
const gearEditTop = topbar(
  iconBtn("Retour", "arrow-left") +
    '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Modifier le setup</h1>',
);
const GearSetupEdit =
  ROOT +
  gearEditTop +
  '<div class="mob-scroll" style="flex:1">' +
  gearEditBody +
  "</div>" +
  '<div class="mob-footer mob-sheet-footer" style="flex:none"><button class="mob-btn mob-btn--lg m-body">Annuler</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong">Enregistrer</button></div>' +
  "</div>";

// V. GearPicker: the telescope select of the editor, drawn as a sheet. The desktop control is a native <select> of "Marque Modèle"
// (`telescopeLabel`, custom entries first: `sortCustomFirst`) with no search and no figures; the sheet adds a search field and the three
// figures of `TelescopeData` (aperture, focal length, f-ratio). "+ Ajouter un télescope" is the desktop's custom-telescope entry
// (`targets.gear.addTelescope`). A tap on a row chooses it and closes the sheet: no footer.
const gearInner = GearSetupEdit.slice(
  ROOT.length,
  GearSetupEdit.length - "</div>".length,
);
const scopeRow = (name, ap, fl, fr, current) =>
  '<button class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">' +
  name +
  '</span><span class="mob-row-sub m-secondary">Ouverture ' +
  ap +
  " mm · Focale " +
  fl +
  " mm · f/" +
  fr +
  "</span></span>" +
  (current
    ? '<span class="mob-row-trail mob-status--success">' +
      I("check") +
      "</span>"
    : "") +
  "</button>";
const GearPicker =
  ROOT +
  gearInner +
  sheetOver(
    "tel-title",
    "Télescope",
    lineRow("plus", "Ajouter un télescope", "") +
      scopeRow("Celestron C6", "150", "1500", "10", false) +
      scopeRow("Celestron C8", "203.2", "2032", "10", false) +
      scopeRow("Celestron C9.25", "235", "2350", "10", false) +
      scopeRow("Celestron C11", "279.4", "2800", "10", false) +
      scopeRow("Celestron C14", "356", "3910", "11", false) +
      scopeRow('Celestron EdgeHD 8"', "203.2", "2032", "10", true) +
      scopeRow('Celestron EdgeHD 9.25"', "235", "2350", "10", false) +
      scopeRow('Celestron EdgeHD 11"', "279.4", "2800", "10", false) +
      scopeRow('Celestron EdgeHD 14"', "356", "3910", "11", false) +
      scopeRow('Celestron RASA 8"', "203", "400", "2", false) +
      scopeRow('Celestron RASA 11" V2', "279.4", "620", "2.2", false) +
      scopeRow("Sky-Watcher Evostar 72ED", "72", "420", "5.8", false),
    "mob-sheet--auto-lg",
    '<div class="mob-form-row" style="padding-left:0;padding-right:0"><input id="tel-q" class="mob-field m-body" type="search" placeholder="Rechercher un télescope…" aria-label="Rechercher un télescope"></div>',
  ) +
  "</div>";

// W. Location: the desktop's observer position (`SkyTimeControl.vue` location popup, `targets-view.ts` `buildLocationWidget`): latitude and
// longitude (decimal or DMS, a toggle), "Utiliser ma position", and the terrain horizon (eye height, "Calculer l'horizon", "Importer un
// fichier horizon", "Effacer l'horizon" once a profile exists, and the map toggle of the profile). Nothing is saved explicitly: the
// desktop applies each field on `change`, so there is no footer. The desktop has no location name, no time zone and no list of places.
const btnBlock = (label, extra = "", icon = "", cls = "m-body") =>
  '<div class="mob-form-row"><button class="mob-btn mob-btn--block ' +
  cls +
  '"' +
  extra +
  ">" +
  (icon ? I(icon) : "") +
  label +
  "</button></div>";
const Location =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Lieu d\x27observation</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  sectionHeader("Position de l\x27observateur") +
  '<div class="mob-form-row mob-form-row--pair"><div><label class="mob-form-label m-secondary" for="loc-lat">Latitude (°N)</label>' +
  textField("loc-lat", "", "48.58", ' inputmode="decimal"') +
  '</div><div><label class="mob-form-label m-secondary" for="loc-lon">Longitude (°E)</label>' +
  textField("loc-lon", "", "7.75", ' inputmode="decimal"') +
  "</div></div>" +
  btnBlock("DMS (° ′ ″)") +
  btnBlock("Utiliser ma position", "", "map-pin") +
  sectionHeader("Horizon du relief") +
  formRow(
    "Hauteur des yeux au sol (m)",
    textField("loc-eye", "1.7", "", ' inputmode="decimal"'),
    "loc-eye",
  ) +
  btnBlock("Calculer l\x27horizon", "", "", "mob-btn--action m-body-strong") +
  btnBlock("Importer un fichier horizon") +
  btnBlock("Effacer l\x27horizon") +
  '<div style="background:var(--bg-panel)">' +
  switchRow("Afficher/masquer l\x27horizon du relief", "", true) +
  "</div></div></div>";

// X. Backup: the desktop's two modals, `ExportModal.vue` ("Contenu de la sauvegarde": seven options, the list of placed photos, the estimated
// size, "Créer une sauvegarde") and `ImportModal.vue` (pick a file; then, once analysed: file name and "Changer de fichier", "Contenu à
// restaurer" with the global options found in the file, the lists Images / Plans / Setups / Télescopes-caméras with a select-all and the
// replace warning, then "Restaurer une sauvegarde"; the "Recommandé : créez une sauvegarde" warning and its button are on the first
// phase). Drawn state: a file chosen and analysed. Both actions are inline buttons: the screen is not a form with Cancel and Save.
const checkRow = (title, sub = "", checked = false, warn = "") =>
  '<label class="mob-row"><span class="mob-row-body"><span class="mob-row-title mob-row-title--wrap m-body">' +
  title +
  "</span>" +
  (sub
    ? '<span class="mob-row-sub mob-row-sub--wrap m-secondary">' +
      sub +
      "</span>"
    : "") +
  (warn
    ? '<span class="mob-row-sub mob-row-sub--wrap mob-status--warn m-secondary">' +
      warn +
      "</span>"
    : "") +
  '</span><input class="mob-check" type="checkbox" aria-label="' +
  title +
  '"' +
  (checked ? " checked" : "") +
  "></label>";
const replaceWarn =
  "Un élément du même nom existe déjà et sera remplacé si vous l\x27importez.";
const panel = (inner) =>
  '<div style="background:var(--bg-panel)">' + inner + "</div>";
const Backup =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Exporter / Importer les données</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  sectionHeader("Exporter") +
  groupLabel("Contenu de la sauvegarde") +
  panel(
    checkRow("Inclure les modifications de métadonnées DSO") +
      checkRow("Inclure les télescopes/caméras/accessoires personnalisés") +
      checkRow("Inclure les setups", "", true) +
      checkRow("Inclure les types de points d\x27intérêt") +
      checkRow("Inclure les régions du ciel enregistrées") +
      checkRow("Inclure les plans", "", true),
  ) +
  '<div style="padding-top:var(--space-4)"></div>' +
  keyField("Photos", "12 / 12", "Photos : 12 sur 12") +
  helper("Taille estimée : 148.2 MB") +
  '<div class="mob-form-row"><button class="mob-btn mob-btn--confirm mob-btn--lg mob-btn--block m-body-strong">Créer une sauvegarde</button></div>' +
  sectionHeader("Importer") +
  '<p class="mob-helper m-secondary mob-status--warn">Recommandé : créez une sauvegarde de vos données avant de restaurer.</p>' +
  panel(
    '<div class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">sauvegarde-2026-10-03.zip</span></span></div>',
  ) +
  '<div class="mob-form-row"><button class="mob-btn mob-btn--block m-body">Changer de fichier</button></div>' +
  groupLabel("Contenu à restaurer") +
  panel(
    checkRow("Modifications de métadonnées DSO", "", true) +
      checkRow("Types de points d\x27intérêt", "", true) +
      checkRow("Régions du ciel enregistrées", "", true),
  ) +
  sectionHeader("Images (4)") +
  panel(
    checkRow("Tout sélectionner", "", true) +
      checkRow("M31_2025-09-14_stack.jpg", "4.2 MB", true, replaceWarn) +
      checkRow("NGC7000_HaOIII_2025-08-23.tif", "18.6 MB", true) +
      checkRow("M42_2025-01-18.png", "9.8 MB", true) +
      checkRow("M45_2024-11-02_RGB.jpg", "3.1 MB", true),
  ) +
  sectionHeader("Plans (2)") +
  panel(
    checkRow("Tout sélectionner", "", true) +
      checkRow("Nuit du 2026-10-03", "", true, replaceWarn) +
      checkRow("Cygne et Céphée", "", true),
  ) +
  sectionHeader("Setups (2)") +
  panel(
    checkRow("Tout sélectionner", "", true) +
      checkRow("Équipement 1", "", true, replaceWarn) +
      checkRow("EdgeHD 8 réduit", "", true),
  ) +
  sectionHeader("Télescopes/caméras (2)") +
  panel(
    checkRow("Tout sélectionner", "", true) +
      checkRow("Newton 200/800", "", true) +
      checkRow("Caméra planétaire perso", "", true, replaceWarn),
  ) +
  '<div class="mob-form-row" style="padding-top:var(--space-7)"><button class="mob-btn mob-btn--confirm mob-btn--lg mob-btn--block m-body-strong">Restaurer une sauvegarde</button></div>' +
  "</div></div>";

// ── Variants of the identification flow: one flow per kind (the desktop's three modals), opened from the three rows of PhotoEdit ────────────
// Y and Z: the asteroid mode. A full-screen mode like ThreePoint: the photo fills the stage with the trail and its two markers D and A,
// a compact panel holds the controls. AA: the supernova (and, with its own wording, the comet) sheet over the viewer. IdentifyInfo: the
// explanation behind the "i" button.
const trailStage = (activeD) =>
  '<main class="mob-stage"><div class="mob-stage-caption m-secondary" style="align-items:flex-start;padding-top:var(--mobile-gutter)">M31_2025-09-14_stack.jpg</div>' +
  '<svg class="mob-map-drawing" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path vector-effect="non-scaling-stroke" d="M30 40 L68 62"></path></svg>' +
  '<button class="mob-marker' +
  (activeD ? " mob-marker--active" : "") +
  '" aria-label="Marqueur de départ" style="left:calc(30% - 24px);top:calc(40% - 24px)"><span class="mob-marker-dot m-secondary">D</span></button>' +
  '<button class="mob-marker" aria-label="Marqueur d\x27arrivée" style="left:calc(68% - 24px);top:calc(62% - 24px)"><span class="mob-marker-dot m-secondary">A</span></button>' +
  "</main>";
const asteroidTop = topbar(
  '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Identifier un astéroïde</h1>' +
    infoBtn("Identifier un astéroïde"),
);
const whenRow = (marker, aria, pressed, id, date, time) =>
  '<div class="mob-when-row"><button class="mob-btn m-body" aria-pressed="' +
  (pressed ? "true" : "false") +
  '" aria-label="' +
  aria +
  '">' +
  marker +
  '</button><input id="' +
  id +
  '-d" class="mob-field m-body" type="text" readonly value="' +
  date +
  '" aria-label="' +
  marker +
  ', date (UTC)"><input id="' +
  id +
  '-t" class="mob-field m-body" type="text" readonly value="' +
  time +
  '" aria-label="' +
  marker +
  ', heure (UTC)">' +
  utcUnit +
  "</div>";
const addFooter = (n, disabled) =>
  '<div class="mob-sheet-footer mob-sheet-footer--primary-wide"><button class="mob-btn mob-btn--lg m-body">Annuler</button><button class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong"' +
  (disabled ? " disabled" : "") +
  ">Ajouter la sélection (" +
  n +
  ")</button></div>";
const IdentifyAsteroid =
  ROOT +
  asteroidTop +
  trailStage(true) +
  '<section class="mob-panel" aria-label="Recherche d\x27astéroïdes">' +
  '<div style="padding-top:var(--space-4)"></div>' +
  whenRow(
    "Départ",
    "Marquer le départ de la traînée",
    true,
    "ast-start",
    "2025-09-14",
    "21:40",
  ) +
  whenRow(
    "Arrivée",
    "Marquer l\x27arrivée de la traînée",
    false,
    "ast-end",
    "2025-09-14",
    "21:52",
  ) +
  '<div class="mob-when-row mob-when-row--radius"><span class="m-body" style="color:var(--text-secondary)">Rayon</span><input id="ast-radius" class="mob-field m-body" type="text" inputmode="numeric" value="5" aria-label="Rayon de recherche, arcminutes"><span class="m-body" style="color:var(--text-secondary)">arcmin</span>' +
  searchIconBtn +
  "</div>" +
  addFooter(0, true) +
  "</section></div>";

const IdentifyAsteroidResults =
  ROOT +
  asteroidTop +
  trailStage(false) +
  '<section class="mob-panel mob-panel--results" aria-label="Astéroïdes trouvés">' +
  stateLine("3 astéroïdes trouvés", "mob-status--success") +
  '<div class="mob-scroll mob-results-list" style="background:var(--bg-panel)">' +
  asteroidRows +
  "</div>" +
  '<div class="mob-form-row" style="padding-top:var(--space-4)"><button class="mob-btn mob-btn--text m-body" style="margin-left:calc(-1 * var(--space-4))">Modifier la recherche</button></div>' +
  addFooter(1, false) +
  "</section></div>";

const supernovaSheet = sheetOver(
  "sn-title",
  "Identifier des supernovae",
  '<div class="mob-form-row mob-form-row--search" style="padding-top:var(--space-4)"><input id="sn-d" class="mob-field m-body" type="text" readonly value="2025-09-14" aria-label="Date d\x27observation (UTC), date"><input id="sn-t" class="mob-field m-body" type="text" readonly value="21:40" aria-label="Date d\x27observation (UTC), heure">' +
    utcUnit +
    searchIconBtn +
    "</div>" +
    stateLine("Pas encore recherché"),
  "mob-sheet--auto",
  infoBtn("Identifier des supernovae"),
  addFooter(0, true),
  " mob-sheet-header--bar",
);
const IdentifySupernova = ROOT + photoViewerBase() + supernovaSheet + "</div>";
const IdentifyInfo =
  ROOT +
  photoViewerBase() +
  supernovaSheet +
  '<div class="mob-scrim"></div>' +
  '<div class="mob-dialog" role="dialog" aria-modal="true" aria-labelledby="info-sn-title" aria-describedby="info-sn-msg">' +
  '<h2 id="info-sn-title" class="mob-dialog-title m-title">Identifier des supernovae</h2>' +
  '<p id="info-sn-msg" class="mob-dialog-message m-body">' +
  INFO.supernova +
  "</p>" +
  '<div class="mob-dialog-buttons"><button class="mob-btn mob-btn--lg m-body">Fermer</button></div>' +
  "</div></div>";

// IdentifyChoose: the entry point. The "Identifier les objets" row of the photo info sheet opens a content-height sheet with one row per kind
// (desktop strings of PhotoEdit's "Points d'intérêt" group, same lead icons), each with a row chevron; the info sheet stays visible under
// the second scrim, as on IdentifyInfo.
const IdentifyChoose =
  ROOT +
  photoViewerBase() +
  sheetOver(
    "choose-title",
    "Identifier les objets",
    actionRow("poi-asteroid", "Identifier un astéroïde", chevron) +
      actionRow("poi-supernova", "Identifier des supernovae", chevron) +
      actionRow("poi-comet", "Identifier des comètes", chevron),
    "mob-sheet--auto",
    "",
    "",
    " mob-sheet-header--bar",
    iconBtn("Retour", "arrow-left"),
  ) +
  "</div>";

// PlanActions: the "more" button of PlanDetail opens a content-height sheet over the dimmed plan, one row per action the desktop has on a plan
// (targets-view.ts buildPlanSection: show on the map, rename, export to PDF, delete; and buildPlanSortBar: "Trier par"), the delete row last, in the danger colour.
// "Trouver des cibles" is the footer button "Ajouter une cible" of PlanDetail; the Moon / cardinal toggles belong to the chart, which the phone does not draw.
const PlanActions =
  ROOT +
  planDetailInner +
  sheetOver(
    "plan-actions-title",
    "Nuit du 2026-10-03",
    actionRow("map-pin", "Afficher sur la carte") +
      actionRow("pen", "Renommer le plan") +
      actionRow(
        "sort",
        "Trier par",
        '<span class="m-secondary">Heure de transit</span>' + chevron,
      ) +
      actionRow("export", "Exporter en PDF") +
      lineRow("trash", "Supprimer le plan", "", " mob-row--danger"),
    "mob-sheet--auto",
  ) +
  "</div>";

// ConfirmDelete: the delete dialog, here for a plan (PlanDetail dimmed under the scrim). The strings are the desktop's `confirmPlanDelete` (photo-delete-confirm.ts):
// title `targets.plan.delete`, message `targets.plan.confirmDelete`, cancel `gallery.cancelEdit` (btn-cancel), confirm `targets.plan.delete` (btn-danger).
const ConfirmDelete =
  ROOT +
  planDetailInner +
  '<div class="mob-scrim"></div>' +
  '<div class="mob-dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-msg">' +
  '<h2 id="del-title" class="mob-dialog-title m-title">Supprimer le plan</h2>' +
  '<p id="del-msg" class="mob-dialog-message m-body">Supprimer le plan «&#160;Nuit du <span style="white-space:nowrap">2026-10-03</span>&#160;»&#160;?</p>' +
  '<div class="mob-dialog-buttons"><button class="mob-btn mob-btn--lg m-body">Annuler</button><button class="mob-btn mob-btn--danger-fill mob-btn--lg m-body-strong">Supprimer le plan</button></div>' +
  "</div></div>";

// SkyPhoto: the Ciel tab with a photo tapped on the map. On the desktop (ui.ts setOnPhotoClick) the click selects the photo in the photos panel, which shows
// its card (PhotoItem.vue) = the photo's original name, the eye (photos.hide / photos.show), the gear (photos.settings, GearPopup.vue) and "open in the
// gallery" (photos.openInGallery), then the chips of its points of interest, DSO ids and labels; the gear popup holds the opacity slider (photos.opacity)
// and the actions Repositionner, Ordre d'affichage, Modifier les métadonnées and Supprimer (danger). The phone sheet: the name as the title, the DSO chips as
// a paged list of at most three rows (a tap on a chip selects that DSO, triggerSelectDSOForPhotoChip), page dots, the opacity slider and ONE row of icon
// buttons in the desktop's order (card, then popup): hide, open in the gallery, reposition, draw order, edit the metadata, delete. The POI and label chips
// of the card are not drawn. The photo is drawn on the map as a placed photo with the desktop's dashed outline and its name along the longest edge.
const dsoChip = (id) => '<button class="mob-chip m-body">' + id + "</button>";
const SkyPhoto =
  ROOT +
  '<main class="mob-map"><div class="mob-map-caption m-secondary" style="position:absolute;inset:0">Carte du ciel</div>' +
  mapControls() +
  fovLayer(
    fovFrame({
      cx: 170,
      cy: 262,
      w: 250,
      h: 170,
      rot: -8,
      name: "Cygnus_wide_2025-08-23.jpg",
      photo: true,
    }),
    "Photo placée : Cygnus_wide_2025-08-23.jpg",
  ) +
  '<section class="mob-sheet mob-sheet--auto" style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="photo-title">' +
  '<button class="mob-sheet-grab" aria-label="Fermer la fiche"><span class="mob-sheet-handle"></span></button>' +
  '<div class="mob-sheet-header"><h2 id="photo-title" class="m-title" style="color:var(--text-bright)">Cygnus_wide_2025-08-23.jpg</h2></div>' +
  '<div class="mob-pager" role="group" aria-roledescription="carrousel" aria-label="Objets de la photo">' +
  '<div class="mob-pager-track"><div class="mob-pager-page mob-chip-row mob-chip-row--wrap" role="group" aria-label="Page 1 sur 2">' +
  [
    "NGC7000",
    "IC5070",
    "NGC6888",
    "NGC6910",
    "SH2-112",
    "SH2-106",
    "SH2-109",
    "SH2-108",
    "LBN270",
  ]
    .map(dsoChip)
    .join("") +
  "</div></div>" +
  '<div class="mob-pager-dots" role="img" aria-label="Page 1 sur 2"><span class="mob-pager-dot mob-pager-dot--on"></span><span class="mob-pager-dot"></span></div>' +
  "</div>" +
  sliderRow("photo-opacity", "Opacité", 0, 1, 1, "1.00", 0.05) +
  '<div class="mob-icon-row" role="group" aria-label="Actions sur la photo">' +
  iconBtn("Masquer", "eye") +
  iconBtn("Ouvrir dans la galerie", "image") +
  iconBtn("Repositionner", "move") +
  iconBtn("Ordre d\x27affichage", "stack-order") +
  iconBtn("Modifier les métadonnées", "pen") +
  iconBtn("Supprimer", "trash", " mob-icon-btn--danger") +
  "</div></section></main>" +
  tabbar("Ciel") +
  "</div>";

// ── Revision 14: the screens the review found missing ──────────────────────────────────────────────
// Strings are the desktop's (packages/core/src/i18n/fr.ts) unless marked "proposed".
const emptyState = (text, btn = "") =>
  '<div class="mob-empty"><p class="mob-empty-text m-body">' +
  text +
  "</p>" +
  btn +
  "</div>";
const emptyBtn = (label, icon = "") =>
  '<button class="mob-btn mob-btn--action mob-btn--lg m-body-strong">' +
  (icon ? I(icon) : "") +
  label +
  "</button>";

// MainFirstStart: the sky map when no position is set. The desktop map works without a position (only the local sky, the horizon and the Targets need it);
// the Targets print `targets.location.notSet` there. One card on the map: that line and the button to the location screen (`targets.location.label`).
const MainFirstStart = mainScreen(null).replace(
  '<div class="mob-timebar">',
  '<div class="mob-map-prompt"><p class="m-body">Non défini — entrez des coordonnées</p>' +
    emptyBtn("Lieu d\x27observation", "map-pin") +
    "</div>" +
    '<div class="mob-timebar">',
);

// Targets with the equipment, night and place context rows and the types field, and an empty list area.
const targetsEmptyBase = (equip, body) =>
  topbar(
    searchTop("", "Rechercher une cible…", "Rechercher une cible") +
      iconBtn("Plus de filtres", "filter"),
  ) +
  '<div class="mob-context" style="flex:none">' +
  ctx("Équipement : " + equip, equip) +
  ctx("Nuit : ce soir", "Ce soir") +
  ctx("Lieu : " + LOC, LOC) +
  "</div>" +
  typesField("2 types") +
  '<div class="mob-scroll" style="flex:1;background:var(--bg-panel)">' +
  body +
  "</div>" +
  tabbar("Cibles");
// TargetsNoSetup: `targets.gear.noSetup` in the equipment field, `fovOverlay.noSetups` as the line, `fovOverlay.addSetup` as the button.
const TargetsNoSetup =
  ROOT +
  targetsEmptyBase(
    "Aucun setup",
    emptyState("Aucun setup configuré.", emptyBtn("Ajouter un setup", "plus")),
  ) +
  "</div>";
// TargetsNoMatch: `targets.results.empty`. The desktop has no "reset the filters" button, so none is drawn.
const TargetsNoMatch =
  ROOT +
  targetsEmptyBase(
    "Équipement 1",
    emptyState(
      "Aucune cible trouvée pour ces paramètres. Essayez une autre date ou un autre équipement.",
    ),
  ) +
  "</div>";

// LibraryEmpty: `gallery.noPhotos`; the button is proposed ("Ajouter une photo", the title of the add sheet); it replaces the floating button.
const LibraryEmpty =
  ROOT +
  topbar(
    searchTop("", "Rechercher une photo…", "Rechercher une photo") +
      iconBtn("Plus de filtres", "filter"),
  ) +
  '<div class="mob-scroll" style="flex:1">' +
  emptyState(
    "Aucune photo pour l\x27instant",
    emptyBtn("Ajouter des photos", "plus"),
  ) +
  "</div>" +
  tabbar("Galerie") +
  "</div>";
// PlansEmpty: `targets.plan.noPlans`, button `targets.plan.newPlan`.
const PlansEmpty =
  ROOT +
  topbar(searchTop("", "Rechercher un plan…", "Rechercher un plan")) +
  '<div class="mob-scroll" style="flex:1">' +
  emptyState("Aucun plan pour l\x27instant", emptyBtn("Nouveau plan", "plus")) +
  "</div>" +
  tabbar("Plans") +
  "</div>";

// LibrarySolving: the import is done ("Importer" imports everything); two photos still wait. A chip on the tile says why it is not on the map yet.
const stateTile = (file, id, state, busy) =>
  '<div class="mob-photo"><button class="mob-photo-tile mob-photo-tile--state m-secondary" aria-label="' +
  file +
  " : " +
  state +
  '"><span class="mob-photo-name">' +
  file +
  '</span><span class="mob-photo-state m-caption' +
  (busy ? " mob-photo-state--busy" : "") +
  '">' +
  (busy ? '<span class="auto-solve-spinner" aria-hidden="true"></span>' : "") +
  state +
  '</span></button><span class="mob-photo-id m-mono">' +
  id +
  "</span></div>";
const LibrarySolving =
  ROOT +
  libraryBase
    .replace(
      tile("M31_2025-09-14_stack.jpg", "M31"),
      stateTile(
        "M31_2025-09-14_stack.jpg",
        "M31",
        "Résolution",
        true,
      ),
    )
    .replace(
      tile("NGC7000_HaOIII_2025-08-23.tif", "NGC7000"),
      stateTile("NGC7000_HaOIII_2025-08-23.tif", "NGC7000", "À placer", false),
    ) +
  "</div>";

// ImportSolveFailed: the failed row is a button with the row chevron (it opens the placement-method sheet); its state line `import.statusFailed` in the danger colour.
const failedRow = importRow(
  "NGC7000_HaOIII_2025-08-23_integration_bin1_crop.tif",
  "Échec de la résolution",
  "todo",
).replace(
  "mob-row-sub m-secondary",
  "mob-row-sub m-secondary mob-status--danger",
);
const ImportSolveFailed =
  ROOT +
  importReviewBase.replace(
    importRow(
      "NGC7000_HaOIII_2025-08-23_integration_bin1_crop.tif",
      "Résolution",
      "busy",
    ),
    failedRow,
  ) +
  "</div>";

// SolveOffline: the placement-method sheet with no network. "Résoudre en ligne" disabled with one reason line (proposed: the desktop has no such line).
const SolveOffline = ImportMethod.replace(
  lineRow("", "Résoudre en ligne", "astrometry.net, nécessite une connexion"),
  lineRow(
    "",
    "Résoudre en ligne",
    "Aucune connexion internet",
    "",
    " disabled",
  ),
);

// HorizonUnavailable: the desktop error `horizon.error.compute` as a toast (the design system has the desktop `.toast.toast-error`; the desktop prints it as a danger line under the buttons).
const HorizonUnavailable = Location.replace(
  '<header class="mob-topbar"',
  '<div class="mob-toast-host"><div class="toast toast-error" role="alert">Impossible de calculer l\x27horizon à partir des données d\x27altitude</div></div><header class="mob-topbar"',
);
// LocationDenied: on the desktop the button text becomes `targets.location.error`; the fields stay usable.
const LocationDenied = Location.replace(
  btnBlock("Utiliser ma position", "", "map-pin"),
  btnBlock(
    "Impossible d\x27obtenir la position",
    "",
    "map-pin",
    "mob-btn--danger m-body",
  ),
);

// IdentifyComet: like the supernova sheet, plus what CometIdentifyModal adds: the "Près de ce champ" list (comets just outside the frame, with a hint). State "none found".
const cometSheet = sheetOver(
  "co-title",
  "Identifier des comètes",
  '<div class="mob-form-row mob-form-row--search" style="padding-top:var(--space-4)"><input id="co-d" class="mob-field m-body" type="text" readonly value="2025-09-14" aria-label="Date d\x27observation (UTC), date"><input id="co-t" class="mob-field m-body" type="text" readonly value="21:40" aria-label="Date d\x27observation (UTC), heure">' +
    utcUnit +
    searchIconBtn +
    "</div>" +
    stateLine(
      "Aucune comète connue dans cette photo à l\x27heure d\x27observation",
    ) +
    sectionHeader("Près de ce champ") +
    '<p class="mob-helper m-secondary" style="padding-top:0">Juste hors du cadre à cette heure. Si vous attendiez l\x27une de ces comètes, vérifiez la date et l\x27heure d\x27observation : une comète peut se déplacer de plusieurs degrés en quelques jours.</p>' +
    '<div style="background:var(--bg-panel)"><div class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">C/2024 G3 (ATLAS)</span><span class="mob-row-sub m-secondary">à 1.4° du centre · Mag 8.2</span></span></div>' +
    '<div class="mob-row"><span class="mob-row-body"><span class="mob-row-title m-body">12P/Pons-Brooks</span><span class="mob-row-sub m-secondary">à 2.9° du centre · Mag 10.5</span></span></div></div>',
  "mob-sheet--auto-lg",
  infoBtn("Identifier des comètes"),
  addFooter(0, true),
  " mob-sheet-header--bar",
);
const IdentifyComet = ROOT + photoViewerBase() + cometSheet + "</div>";

// Regions: the saved sky regions, opened from the "Région du ciel" field of the Cibles filters. The desktop select lists "Tout le ciel" then the regions;
// its manager lists each region with "Voir" and "Supprimer" and "+ Dessiner une nouvelle région" (no rename). A row selects; the map-pin button shows it on the map; the plus button draws a new one.
const regionRow = (name, color, checked) =>
  '<div class="mob-row mob-row--region"><button class="mob-row-main m-body" role="radio" aria-checked="' +
  (checked ? "true" : "false") +
  '"><span class="mob-radio-mark"></span>' +
  swatch(color) +
  "<span>" +
  name +
  "</span></button>" +
  iconBtn("Voir la région « " + name + " »", "map-pin") +
  iconBtn(
    "Supprimer la région « " + name + " »",
    "trash",
    " mob-icon-btn--danger",
  ) +
  "</div>";
const Regions =
  ROOT +
  topbar(
    iconBtn("Retour", "arrow-left") +
      '<h1 class="mob-topbar-title mob-topbar-title--grow m-title">Région du ciel</h1>',
  ) +
  '<div class="mob-scroll" style="flex:1;padding-top:var(--space-4)"><div role="radiogroup" aria-label="Région du ciel" style="background:var(--bg-panel)">' +
  '<div class="mob-row mob-row--region"><button class="mob-row-main m-body" role="radio" aria-checked="false"><span class="mob-radio-mark"></span><span>Tout le ciel</span></button></div>' +
  regionRow("Vue depuis le jardin", "#4a9eff", true) +
  regionRow("Horizon dégagé sud", "#e6a23c", false) +
  regionRow("Ciel du nord", "#5ec27a", false) +
  "</div></div>" +
  '<button class="mob-fab mob-fab--fixed" style="bottom:calc(var(--mobile-gutter) + var(--safe-bottom,0px))" aria-label="Dessiner une nouvelle région">' +
  I("plus") +
  "</button>" +
  "</div>";

const SCREENS = {
  Main: ["Ciel", Main],
  MainFirstStart: ["Ciel, premier démarrage", MainFirstStart],
  SkyToggles: ["Ciel, calques de la carte", SkyToggles],
  SkyTogglesHint: ["Ciel, nom d'un calque (appui long)", SkyTogglesHint],
  SkyObject: ["Ciel, objet sélectionné", SkyObject],
  SkyPhoto: ["Ciel, photo sélectionnée", SkyPhoto],
  Targets: ["Cibles", Targets],
  TargetsNoSetup: ["Cibles, aucun setup", TargetsNoSetup],
  TargetsNoMatch: ["Cibles, aucun résultat", TargetsNoMatch],
  Regions: ["Cibles, régions du ciel", Regions],
  TargetsTypes: ["Cibles, types d'objets", TargetsTypes],
  Plans: ["Plans", Plans],
  PlansEmpty: ["Plans, aucun plan", PlansEmpty],
  PlanDetail: ["Détail du plan", PlanDetail],
  PlanActions: ["Plan, actions", PlanActions],
  ConfirmDelete: ["Plan, confirmer la suppression", ConfirmDelete],
  Library: ["Galerie", Library],
  LibraryEmpty: ["Galerie, aucune photo", LibraryEmpty],
  LibrarySolving: ["Galerie, résolutions en cours", LibrarySolving],
  LibraryConnected: ["Galerie, données de l'ordinateur", LibraryConnected],
  Settings: ["Réglages", Settings],
  LibraryAdd: ["Galerie, ajouter une photo", LibraryAdd],
  ImportReview: ["Importer des photos", ImportReview],
  ImportMethod: ["Importer, méthode de placement", ImportMethod],
  ImportSolveFailed: ["Importer, résolution échouée", ImportSolveFailed],
  SolveOffline: ["Importer, hors connexion", SolveOffline],
  PhotoDetail: ["Photo", PhotoDetail],
  PhotoZoomed: ["Photo, zoomée", PhotoZoomed],
  PhotoInfo: ["Photo, informations", PhotoInfo],
  Placement: ["Placer la photo", Placement],
  ThreePoint: ["Identifier les étoiles", ThreePoint],
  ThreePointSearch: [
    "Identifier les étoiles, choisir une étoile",
    ThreePointSearch,
  ],
  ThreePointMap: [
    "Identifier les étoiles, choisir sur la carte",
    ThreePointMap,
  ],
  RegionDraw: ["Dessiner une région", RegionDraw],
  FrameEdit: ["Ciel, cadre sélectionné", FrameEdit],
  FrameMove: ["Ciel, déplacer le cadre", FrameMove],
  ObsWindow: ["Plan, fenêtre d'observation", ObsWindow],
  TargetsFilter: ["Cibles, filtres", TargetsFilter],
  DrawOrder: ["Ciel, ordre d'affichage", DrawOrder],
  LanPairing: ["Réglages, connexion à l'ordinateur", LanPairing],
  LanConnected: ["Réglages, ordinateur connecté", LanConnected],
  SkySearch: ["Ciel, recherche", SkySearch],
  SkyDisplay: ["Ciel, affichage", SkyDisplay],
  PlanEntry: ["Plan, cible", PlanEntry],
  PhotoEdit: ["Photo, modifier les infos", PhotoEdit],
  GearSetups: ["Réglages, setups", GearSetups],
  GearSetupEdit: ["Équipement, modifier le setup", GearSetupEdit],
  GearPicker: ["Équipement, choisir un télescope", GearPicker],
  Location: ["Réglages, lieu d'observation", Location],
  HorizonUnavailable: ["Lieu, horizon indisponible", HorizonUnavailable],
  LocationDenied: ["Lieu, position refusée", LocationDenied],
  Backup: ["Réglages, exporter et importer", Backup],
  IdentifyAsteroid: ["Identifier un astéroïde", IdentifyAsteroid],
  IdentifyAsteroidResults: ["Astéroïdes trouvés", IdentifyAsteroidResults],
  IdentifySupernova: ["Identifier des supernovae", IdentifySupernova],
  IdentifyComet: ["Identifier des comètes", IdentifyComet],
  IdentifyInfo: ["Identification, explication ouverte", IdentifyInfo],
  IdentifyChoose: ["Photo, choisir une identification", IdentifyChoose],
};

for (const [name, [title, root]] of Object.entries(SCREENS)) {
  const plain =
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>' +
    title +
    '</title>\n<script>document.documentElement.setAttribute("data-theme",new URLSearchParams(location.search).get("theme")||"cold-blue-v2");if(new URLSearchParams(location.search).get("fallback"))document.write("<style>*{font-family:Verdana,DejaVu Sans,sans-serif!important}</style>")</script>\n<link href="' +
    FONTS +
    '" rel="stylesheet">\n<link rel="stylesheet" href="../ds/myastrosky/tokens.css">\n<link rel="stylesheet" href="../ds/myastrosky/components/bundle.css">\n<style>body{margin:0}</style>\n</head>\n<body>\n' +
    root +
    "\n</body>\n</html>\n";
  fs.writeFileSync(path.join(here, "../plain", name + ".html"), plain);

  const dc =
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>' +
    title +
    '</title>\n<script src="./support.js"></script>\n<link rel="stylesheet" href="../ds/myastrosky/tokens.css">\n<link rel="stylesheet" href="../ds/myastrosky/components/bundle.css">\n</head>\n<body>\n<x-dc>\n<helmet>\n<link href="' +
    FONTS +
    '" rel="stylesheet">\n<style>\nbody{margin:0}\n</style>\n</helmet>\n' +
    root +
    '\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":412,"height":915}}\'>\nclass Component extends DCLogic {\nrenderVals() {\nreturn {};\n}\n}\n</script>\n</body>\n</html>\n';
  fs.writeFileSync(path.join(here, "../boards", name + ".dc.html"), dc);
}
console.log("built", Object.keys(SCREENS).join(", "));
