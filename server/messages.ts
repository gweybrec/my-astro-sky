/**
 * Server-side bilingual message catalogue (FR / EN).
 *
 * The backend cannot import the frontend i18n module (src/i18n/) because they
 * live in different module boundaries (browser bundle vs. Node.js).  All
 * user-visible strings produced by the server are centralised here so they
 * are easy to audit and extend.
 *
 * Usage:
 *   import { msg } from './messages.js';
 *   return { error: msg.solveField.noIndexFiles(lang) };
 */

export type ServerLang = 'fr' | 'en';

function m(lang: ServerLang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

export const msg = {

  // ── solve-field ─────────────────────────────────────────────────────────────
  solveField: {
    notFound: (lang: ServerLang, bin: string) =>
      m(lang,
        `solve-field introuvable. Vérifiez SOLVE_FIELD_PATH dans Paramètres (actuel : ${bin}).`,
        `solve-field executable not found. Check SOLVE_FIELD_PATH in Settings (current: ${bin}).`,
      ),

    noIndexFiles: (lang: ServerLang) =>
      m(lang,
        "solve-field échoué : fichiers d'index manquants. Exécutez : sudo bash scripts/install-solve-field.sh",
        'solve-field failed: index files not found. Run: sudo bash scripts/install-solve-field.sh',
      ),

    noPyfits: (lang: ServerLang) =>
      m(lang,
        "solve-field échoué : dépendance Python manquante (pyfits/astropy). Exécutez : pip3 install astropy",
        'solve-field failed: missing Python dependency (pyfits/astropy). Run: pip3 install astropy',
      ),

    noSolution: (lang: ServerLang, fields: number, matches: number) =>
      m(lang,
        `Aucune solution trouvée. solve-field a examiné ${fields} champs et trouvé ${matches} correspondances`,
        `No solution found. solve-field examined ${fields} fields and found ${matches} matches`,
      ),

    noSolutionCauses: (lang: ServerLang) =>
      m(lang,
        ". Causes possibles : (1) Image avec peu d'étoiles détectables, (2) Position catalogue incorrecte, (3) FOV estimé incorrect. Essayez : ",
        '. Possible causes: (1) Image with few detectable stars, (2) Incorrect catalog position, (3) Wrong FOV estimate. Try: ',
      ),

    noSolutionHintNone: (lang: ServerLang) =>
      m(lang,
        '(1) Fournir une indication de position et FOV, (2) Identification manuelle.',
        '(1) Provide position hint and FOV, (2) Manual identification.',
      ),

    noSolutionHintNoFov: (lang: ServerLang) =>
      m(lang,
        '(1) Fournir le FOV de votre image, (2) Identification manuelle.',
        '(1) Provide your image FOV, (2) Manual identification.',
      ),

    noSolutionHintFull: (lang: ServerLang) =>
      m(lang, 'Identification manuelle.', 'Manual identification.'),

    failed: (lang: ServerLang, fields: number) =>
      m(lang,
        `solve-field échoué (${fields} champs examinés)`,
        `solve-field failed (${fields} fields examined)`,
      ),

    noWcsFile: (lang: ServerLang) =>
      m(lang,
        "solve-field n'a pas produit de fichier WCS",
        'solve-field did not produce a WCS file',
      ),

    notEnoughStars: (lang: ServerLang, n: number) =>
      m(lang,
        `Calibration WCS obtenue mais seulement ${n} étoiles de catalogue trouvées`,
        `WCS calibration obtained but only ${n} catalog stars found`,
      ),

    missingWcsKey: (lang: ServerLang, key: string) =>
      m(lang, `Clé WCS manquante : ${key}`, `Missing WCS key: ${key}`),
  },

  // ── ASTAP ────────────────────────────────────────────────────────────────────
  astap: {
    timeout: (lang: ServerLang, secs: number, hinted: boolean) =>
      m(lang,
        `Délai ASTAP dépassé (${secs} s).` + (hinted
          ? ''
          : " Une résolution à l'aveugle (sans objet cible) balaie tout le ciel et peut être lente — indiquez un objet cible pour accélérer."),
        `ASTAP timed out (${secs} s).` + (hinted
          ? ''
          : ' A blind solve (no target object) searches the whole sky and can be slow — provide a target object to speed it up.'),
      ),

    noDatabase: (lang: ServerLang, dir: string) =>
      m(lang,
        `ASTAP échoué. Vérifiez que la base de données d'étoiles est installée dans ${dir}. Exécutez : sudo bash scripts/install-astap.sh`,
        `ASTAP failed. Verify that the star database is installed in ${dir}. Run: sudo bash scripts/install-astap.sh`,
      ),

    noSolution: (lang: ServerLang, stars: number, quads: number) =>
      m(lang,
        `Aucune solution trouvée. ASTAP a détecté ${stars} étoiles et ${quads} quads dans l'image`,
        `No solution found. ASTAP detected ${stars} stars and ${quads} quads in the image`,
      ),

    noSolutionFov: (lang: ServerLang, fov: string) =>
      m(lang,
        ` (dernière tentative : FOV ${fov}°)`,
        ` (last attempt: FOV ${fov}°)`,
      ),

    noSolutionCauses: (lang: ServerLang) =>
      m(lang,
        ". Causes possibles : (1) Traitement intensif de l'image déformant les motifs d'étoiles, (2) Nébulosité importante perturbant la détection, (3) Position catalogue incorrecte. Essayez : ",
        '. Possible causes: (1) Heavy image processing distorting star patterns, (2) Significant nebulosity interfering with detection, (3) Incorrect catalog position. Try: ',
      ),

    noSolutionHintNone: (lang: ServerLang) =>
      m(lang,
        '(1) Fournir une indication de position (objet cible), (2) Utiliser le solveur en ligne, ou (3) Identification manuelle.',
        '(1) Provide position hint (target object), (2) Use online solver, or (3) Manual identification.',
      ),

    noSolutionHintGiven: (lang: ServerLang) =>
      m(lang,
        '(1) Utiliser le solveur en ligne, ou (2) Identification manuelle.',
        '(1) Use online solver, or (2) Manual identification.',
      ),

    failed: (lang: ServerLang, stars: number) =>
      m(lang,
        `ASTAP échoué (${stars} étoiles détectées)`,
        `ASTAP failed (${stars} stars detected)`,
      ),

    noWcsFile: (lang: ServerLang) =>
      m(lang,
        "ASTAP n'a pas produit de fichier WCS",
        'ASTAP did not produce a WCS file',
      ),

    missingWcsKey: (lang: ServerLang, key: string) =>
      m(lang, `Clé WCS manquante : ${key}`, `Missing WCS key: ${key}`),

    badSolution: (lang: ServerLang, dist: string) =>
      m(lang,
        `ASTAP a trouvé une solution incorrecte (${dist}° de la position attendue). Essayez le solveur en ligne (astrometry.net).`,
        `ASTAP found an incorrect solution (${dist}° away from expected position). Try using the online solver (astrometry.net).`,
      ),

    distortedSolution: (lang: ServerLang, skew: string) =>
      m(lang,
        `ASTAP a trouvé une fausse solution déformée (cisaillement de ${skew}° ; une vraie solution astrométrique n'a aucun cisaillement). L'échelle était probablement inconnue. Essayez le solveur en ligne (astrometry.net).`,
        `ASTAP found a distorted false solution (${skew}° shear; a real astrometric solution has none). The scale was likely unknown. Try using the online solver (astrometry.net).`,
      ),

    notEnoughCatalogStars: (lang: ServerLang) =>
      m(lang,
        "Pas assez d'étoiles du catalogue dans le champ résolu",
        'Not enough catalog stars in the solved field',
      ),
  },

  // ── HTTP API (server/index.ts) ───────────────────────────────────────────────
  api: {
    missingFile: (lang: ServerLang) =>
      m(lang, 'Fichier manquant', 'Missing file'),

    noFile: (lang: ServerLang) =>
      m(lang, 'Aucun fichier fourni', 'No file provided'),

    unsupportedWcsFormat: (lang: ServerLang) =>
      m(lang,
        'Format non supporté. Utilisez TIFF ou FITS.',
        'Unsupported format. Use TIFF or FITS.',
      ),

    noWcsData: (lang: ServerLang) =>
      m(lang,
        "Aucune donnée WCS trouvée dans le fichier. Ce fichier n'a pas été résolu astrométriquement.",
        'No WCS metadata found in this file. The file was not plate-solved.',
      ),

    noImageDimensions: (lang: ServerLang) =>
      m(lang, "Dimensions de l'image introuvables", 'Image dimensions not found'),

    cannotDetermineImageDimensions: (lang: ServerLang) =>
      m(lang, "Impossible de déterminer les dimensions de l'image", 'Cannot determine image dimensions'),

    notEnoughCatalogStars: (lang: ServerLang) =>
      m(lang, "Pas assez d'étoiles du catalogue dans le champ", 'Not enough catalog stars in field'),

    solveCanceled: (lang: ServerLang) =>
      m(lang, 'Résolution annulée', 'Solve canceled'),

    unsupportedFormatAstap: (lang: ServerLang, ext: string) =>
      m(lang,
        `Format non pris en charge pour ASTAP : ${ext}. Utilisez JPG/PNG/WEBP.`,
        `Unsupported format for ASTAP: ${ext}. Use JPG/PNG/WEBP.`,
      ),

    unsupportedFormatSolveField: (lang: ServerLang, ext: string) =>
      m(lang,
        `Format non pris en charge pour solve-field : ${ext}. Utilisez JPG/PNG/WEBP.`,
        `Unsupported format for solve-field: ${ext}. Use JPG/PNG/WEBP.`,
      ),

    astapError: (lang: ServerLang, err: string) =>
      m(lang, `Erreur ASTAP : ${err}`, `ASTAP error: ${err}`),

    solveFieldError: (lang: ServerLang, err: string) =>
      m(lang, `Erreur solve-field : ${err}`, `solve-field error: ${err}`),
  },
};
