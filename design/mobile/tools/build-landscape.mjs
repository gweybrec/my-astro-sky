// Revision 12: landscape variant of every screen (boards/<Name>Landscape.dc.html + plain/<Name>Landscape.html).
// Recipes = the reviewer's hunks (landscape-recipes.json); a new screen borrows the recipe of its sibling.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
import { apply, split } from "./landscape-lib.mjs";
const recipes = JSON.parse(fs.readFileSync(path.join(here, "landscape-recipes.json"), "utf8"));
const SIBLING = { LibraryConnected: "Library", PhotoZoomed: "PhotoDetail", SkyTogglesHint: "SkyToggles", MainFirstStart: "Main", TargetsNoSetup: "Targets", TargetsNoMatch: "Targets", LibraryEmpty: "Library", LibrarySolving: "Library", PlansEmpty: "Plans", ImportSolveFailed: "ImportReview", SolveOffline: "ImportMethod", HorizonUnavailable: "Location", LocationDenied: "Location", IdentifyComet: "IdentifySupernova", Regions: "GearSetups" };
const names = fs
  .readdirSync(path.join(here, "../boards"))
  .filter((f) => f.endsWith(".dc.html") && !f.includes("Landscape"))
  .map((f) => f.replace(".dc.html", ""));
const FONTS = fs
  .readFileSync(path.join(here, "build-screens.mjs"), "utf8")
  .match(/const FONTS =\s*"([^"]+)"/)[1];
fs.mkdirSync(path.join(here, "../plain"), { recursive: true });
let bad = 0;
for (const n of names) {
  const hunks = recipes[SIBLING[n] || n];
  const p = fs.readFileSync(path.join(here, `../boards/${n}.dc.html`), "utf8");
  let { out, missed } = apply(p, hunks);
  if (n === "IdentifyComet") { out = out.replace('style="position:absolute;left:0;right:0;bottom:0" aria-labelledby="co-title"', 'style="position: absolute; left: 0px; right: 0px; bottom: 0px; margin-inline: auto;" aria-labelledby="co-title"'); missed = []; }
  if (missed.length) {
    bad++;
    console.log(
      "MISSED",
      n,
      missed.length,
      JSON.stringify(
        missed.map((h) => [h.old.slice(0, 2), h.neu.slice(0, 1)]),
      ).slice(0, 400),
    );
  }
  fs.writeFileSync(path.join(here, `../boards/${n}Landscape.dc.html`), out);
  const title = out.match(/<title>(.*?)<\/title>/)[1];
  const root = split(out).body.replace(/\n$/, "");
  const plain =
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>' +
    title +
    '</title>\n<script>document.documentElement.setAttribute("data-theme",new URLSearchParams(location.search).get("theme")||"cold-blue-v2");if(new URLSearchParams(location.search).get("fallback"))document.write("<style>*{font-family:Verdana,DejaVu Sans,sans-serif!important}</style>")</script>\n<link href="' +
    FONTS +
    '" rel="stylesheet">\n<link rel="stylesheet" href="../ds/myastrosky/tokens.css">\n<link rel="stylesheet" href="../ds/myastrosky/components/bundle.css">\n<link rel="stylesheet" href="../tools/landscape.css">\n<style>body{margin:0}</style>\n</head>\n<body>\n' +
    root +
    "\n</body>\n</html>\n";
  fs.writeFileSync(path.join(here, `../plain/${n}Landscape.html`), plain);
}
console.log(
  "landscape built for",
  names.length,
  "screens;",
  bad,
  "with missed hunks",
);
