#!/usr/bin/env node
/**
 * generate-dso.mjs — Generates public/data/dso.json from OpenNGC + SH2 data.
 * Usage: node scripts/generate-dso.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../public/data/dso.json');
// Hand-maintained override file for DSO metadata values:
//   constellation, rating, difficulty
const METADATA_OVERRIDES_PATH = join(__dirname, 'dso-metadata-overrides.json');

function loadMetadataOverrides() {
  if (!existsSync(METADATA_OVERRIDES_PATH)) return new Map();
  const raw = JSON.parse(readFileSync(METADATA_OVERRIDES_PATH, 'utf8'));
  const map = new Map();

  const addEntry = (entry) => {
    const id = String(entry.id ?? '').trim().toUpperCase();
    if (!id) return;
    const catalogs = Array.isArray(entry.catalogs) ? entry.catalogs.map(String) : [];
    const override = {
      constellation: entry.constellation ?? null,
      rating: entry.rating ?? null,
      difficulty: entry.difficulty ?? null,
      catalogs,
      names: entry.names ?? null,
      ra: typeof entry.ra === 'number' ? entry.ra : null,
      dec: typeof entry.dec === 'number' ? entry.dec : null,
      // type: corrected DSO type code (e.g. 'EN', 'RN', 'SNR') or null
      type: typeof entry.type === 'string' && entry.type ? entry.type : null,
      // majAxis/minAxis: corrected angular size in arcmin (overrides catalog value)
      majAxis: typeof entry.majAxis === 'number' ? entry.majAxis : null,
      minAxis: typeof entry.minAxis === 'number' ? entry.minAxis : null,
    };
    map.set(id, override);
    for (const cat of catalogs) {
      if (cat) map.set(String(cat).toUpperCase(), override);
    }
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === 'object') addEntry(entry);
    }
    return map;
  }

  const idxId = raw.fields?.indexOf('id');
  const idxCatalogs = raw.fields?.indexOf('catalogs');
  const idxConstellation = raw.fields?.indexOf('constellation');
  const idxRating = raw.fields?.indexOf('rating');
  const idxDifficulty = raw.fields?.indexOf('difficulty');
  if (idxId < 0 || !Array.isArray(raw.data)) return map;

  for (const row of raw.data) {
    const id = String(row[idxId] ?? '').trim();
    const catalogs = Array.isArray(row[idxCatalogs]) ? row[idxCatalogs].map(String) : [];
    const entry = {
      id,
      constellation: idxConstellation >= 0 ? row[idxConstellation] ?? null : null,
      rating: idxRating >= 0 ? (row[idxRating] ?? null) : null,
      difficulty: idxDifficulty >= 0 ? (row[idxDifficulty] ?? null) : null,
      catalogs,
    };
    addEntry(entry);
  }
  return map;
}

function applyMetadataOverrides(row, overrides) {
  const id = String(row[0] ?? '').toUpperCase();
  let entry = overrides.get(id);
  if (!entry && Array.isArray(row[12])) {
    for (const cat of row[12]) {
      if (cat && overrides.has(String(cat).toUpperCase())) {
        entry = overrides.get(String(cat).toUpperCase());
        break;
      }
    }
  }
  if (!entry) return;
  if (entry.ra !== null) row[1] = entry.ra;
  if (entry.dec !== null) row[2] = entry.dec;
  if (entry.names?.fr) row[8] = entry.names.fr;
  if (entry.names?.en) row[9] = entry.names.en;
  if (entry.names?.es) row[10] = entry.names.es;
  if (entry.names?.de) row[11] = entry.names.de;
  row[14] = entry.constellation ?? row[14];
  row[15] = entry.rating ?? row[15];
  row[16] = entry.difficulty ?? row[16];
  // type override (e.g. when OpenNGC records a nebula as '?' or generic 'Neb')
  if (entry.type) row[3] = entry.type;
  // angular size override (arcmin) — e.g. correcting a wrong/missing diameter
  if (entry.majAxis !== null) row[4] = entry.majAxis;
  if (entry.minAxis !== null) row[5] = entry.minAxis;
  // Merge additional catalog aliases from override into row[12] (so e.g. M102 becomes searchable)
  if (Array.isArray(entry.catalogs) && Array.isArray(row[12])) {
    const existing = new Set(row[12].map(c => String(c).toUpperCase()));
    for (const cat of entry.catalogs) {
      if (cat && !existing.has(String(cat).toUpperCase())) {
        row[12].push(cat);
        existing.add(String(cat).toUpperCase());
      }
    }
  }
}


// ─── SH2 catalogue (integrated data block) ──────────────────────────────────
// SH2_DATA is a *primary source catalog*, not an override file.
// Sharpless H-II regions do not appear in any downloadable machine-readable
// catalog used by this pipeline (OpenNGC, LBN, LDN, vdB), so they are
// embedded here directly. dso-metadata-overrides.json overrides fields on
// objects that already exist — it cannot create new objects.
// Coordinates and angular sizes come from Sharpless 1959 (ApJS 4, 257) with
// modern SIMBAD corrections applied via scripts/fix-sh2-coords.mjs.
// Names (French, English, etc.) are sourced from dso-metadata-overrides.json
// via applyMetadataOverrides() at generation time.
// Format: [id, ra_deg, dec_deg, majAxis_arcmin, nameFr_unused]
const SH2_DATA = [
  ['SH2-1', 245.94, -19.55, 30.0, null],
  ['SH2-2', 249.2, -24.57, 12.0, null],
  ['SH2-3', 258.1, -38.47, 10, null],
  ['SH2-4', 259.5996, -39.3194, 10, null],
  ['SH2-5', 260.0541, -38.484, 10, null],
  ['SH2-6', 258.4354, -37.1031, 10, null],
  ['SH2-7', 253.4, -34.4, 25.0, null],
  ['SH2-8', 260.37, -36.03, 10, null],
  ['SH2-9', 245.297, -25.593, 10, null],
  ['SH2-10', 259.75, -34.08, 10, null],
  ['SH2-11', 255.32, -40.65, 10.0, null],
  ['SH2-12', 263.9375, -32.5847, 10, null],
  ['SH2-13', 257.41, -37.18, 14.0, null],
  ['SH2-14', 262.57, -30.25, 10, null],
  ['SH2-15', 267.62, -31.27, 10, null],
  ['SH2-16', 264.73, -29.76, 50.0, null],
  ['SH2-17', 266.55, -28.85, 10, null],
  ['SH2-18', 267.2, -29.25, 10, null],
  ['SH2-19', 267.35, -29.12, 10, null],
  ['SH2-20', 266.7833, -28.775, 10, null],
  ['SH2-21', 267.92, -28.9, 10, null],
  ['SH2-22', 268.77, -25.02, 10, null],
  ['SH2-23', 243.35, -8.37, 10, null],
  ['SH2-24', 242.753, -7.0267, 10, null],
  ['SH2-25', 267.59, -28.52, 20.0, null],
  ['SH2-26', 269.72, -23.32, 10, null],
  ['SH2-27', 271.4, -13.24, 200.0, 'Nébuleuse de Zeta Ophiuchi'],
  ['SH2-28', 270.68, -23.58, 10, null],
  ['SH2-29', 269.81, -19.2, 90.0, null],
  ['SH2-30', 270.86, -17.81, 25.0, null],
  ['SH2-31', 272.85, -23.78, 10, null],
  ['SH2-32', 272.75, -23.63, 10, null],
  ['SH2-33', 239.98, -1.6, 10, null],
  ['SH2-34', 271.6, -21.65, 10, null],
  ['SH2-35', 273.98, -20.25, 10, null],
  ['SH2-36', 241.4, 0.38, 10, null],
  ['SH2-37', 276.38, -1.73, 50.0, null],
  ['SH2-38', 272.2133, -18.26, 10, null],
  ['SH2-39', 274.2187, -18.6972, 10, null],
  ['SH2-40', 273.0446, -17.7133, 10, null],
  ['SH2-41', 273.95, -18.23, 10, null],
  ['SH2-42', 272.5567, -16.7969, 10, null],
  ['SH2-43', 274.1, -17.4, 10, null],
  ['SH2-44', 274.12, -16.73, 10, null],
  ['SH2-45', 279.96, 3.14, 15.0, null],
  ['SH2-46', 281.48, 3.56, 10.0, null],
  ['SH2-47', 281.84, 4.12, 15.0, null],
  ['SH2-48', 282.42, 0.48, 10.0, null],
  ['SH2-49', 282.34, -3.34, 150.0, null],
  ['SH2-50', 276.4, -14.7, 10, null],
  ['SH2-51', 280.1617, -16.5651, 10, null],
  ['SH2-52', 296.643, -23.137, 10, null],
  ['SH2-53', 276.3179, -13.2214, 10, null],
  ['SH2-54', 278.96, -12.62, 60.0, null],
  ['SH2-55', 282.09, -12.48, 10.0, null],
  ['SH2-56', 277.8, -9.72, 10, null],
  ['SH2-57', 282.97, -12.57, 10.0, null],
  ['SH2-58', 277.85, -8.47, 10, null],
  ['SH2-59', 279.25, -7.58, 10, null],
  ['SH2-60', 279.1762, -6.6244, 10, null],
  ['SH2-61', 285.09, 2.51, 5.0, null],
  ['SH2-62', 291.87, -3.78, 10, null],
  ['SH2-63', 285.23, -4.09, 20.0, null],
  ['SH2-64', 277.8604, -2.0728, 10, null],
  ['SH2-65', 281.765, -3.8011, 10, null],
  ['SH2-66', 281.37, -2.0, 10, null],
  ['SH2-67', 282.3413, -2.3606, 10, null],
  ['SH2-68', 286.22, -2.58, 8.0, null],
  ['SH2-69', 281.0575, -0.3147, 10, null],
  ['SH2-70', 273.65, 7.05, 10, null],
  ['SH2-71', 285.501, 2.153, 2.0, null],
  ['SH2-72', 285.95, 2.32, 10.0, null],
  ['SH2-73', 242.5587, 21.8689, 1.0, null],
  ['SH2-74', 287.1292, 5.5972, 10, null],
  ['SH2-75', 284.809, 7.081, 10, null],
  ['SH2-76', 284.1, 7.8, 10, null],
  ['SH2-77', 297.07, 1.15, 10, null],
  ['SH2-78', 285.792, 14.116, 10, null],
  ['SH2-79', 290.82, 13.97, 10, null],
  ['SH2-80', 287.879, 16.861, 6.0, null],
  ['SH2-81', 300.32, 11.78, 10, null],
  ['SH2-82', 292.5621, 18.2917, 6.0, null],
  ['SH2-83', 291.125, 20.793, 5.0, null],
  ['SH2-84', 297.282, 18.3847, 8.0, null],
  ['SH2-85', 285.82, 25.82, 10, null],
  ['SH2-86', 295.8, 23.25, 25.0, 'Nébuleuse NGC 6820'],
  ['SH2-87', 296.586, 24.588, 10, null],
  ['SH2-88', 296.69, 25.216, 10.0, null],
  ['SH2-89', 297.519, 26.473, 12.0, null],
  ['SH2-90', 297.299, 26.86, 5.0, null],
  ['SH2-91', 293.9, 29.6, 3.0, null],
  ['SH2-92', 296.748, 28.173, 10, null],
  ['SH2-93', 298.758, 27.213, 10, null],
  ['SH2-94', 292.067, 31.465, 10, null],
  ['SH2-95', 298.759, 29.29, 10, null],
  ['SH2-96', 292.17, 32.68, 10.0, null],
  ['SH2-97', 299.154, 30.213, 15.0, null],
  ['SH2-98', 299.754, 31.375, 10, null],
  ['SH2-99', 300.222, 33.491, 10.0, null],
  ['SH2-100', 300.436, 33.521, 6.0, null],
  ['SH2-101', 299.979, 35.277, 30.0, 'Nébuleuse de la Tulipe'],
  ['SH2-102', 307.93, 30.6, 10, null],
  ['SH2-103', 312.75, 30.67, 300.0, 'Réseau du Cygne'],
  ['SH2-104', 304.469, 36.823, 10, null],
  ['SH2-105', 305.409, 37.52, 10, null],
  ['SH2-106', 306.862, 37.38, 3.0, 'Nébuleuse SH2-106'],
  ['SH2-107', 310.654, 36.347, 10, null],
  ['SH2-108', 305.163, 39.631, 20.0, 'Nébuleuse du Croissant'],
  ['SH2-109', 308.4, 40.33, 10.0, null],
  ['SH2-110', 320.2, 32.45, 10, null],
  ['SH2-111', 325.48, 30.1, 10.0, null],
  ['SH2-112', 308.454, 45.633, 15.0, null],
  ['SH2-113', 320.2, 38.08, 10, null],
  ['SH2-114', 320.3, 38.7, 10, null],
  ['SH2-115', 308.758, 47.04, 40.0, null],
  ['SH2-116', 308.097, 47.347, 3.0, null],
  ['SH2-117', 314.696, 44.33, 10, null],
  ['SH2-118', 324.25, 40.22, 10, null],
  ['SH2-119', 319.62, 43.93, 20.0, null],
  ['SH2-120', 315.938, 49.867, 10, null],
  ['SH2-121', 316.316, 49.665, 15.0, null],
  ['SH2-122', 347.2, 14.92, 8.0, null],
  ['SH2-123', 325.57, 44.53, 10, null],
  ['SH2-124', 324.607, 50.384, 10.0, null],
  ['SH2-125', 328.372, 47.257, 30.0, 'Nébuleuse du Cocon IC 5146'],
  ['SH2-126', 338.658, 40.667, 8.0, null],
  ['SH2-127', 322.173, 54.617, 10.0, null],
  ['SH2-128', 323.041, 55.881, 10, null],
  ['SH2-129', 317.95, 59.95, 20.0, null],
  ['SH2-130', 310.75, 63.22, 5.0, null],
  ['SH2-131', 324.278, 57.515, 200.0, 'Nébuleuse IC 1396'],
  ['SH2-132', 334.788, 56.079, 60.0, null],
  ['SH2-133', 322.25, 64.3, 10, null],
  ['SH2-134', 333.184, 58.999, 25.0, null],
  ['SH2-135', 335.548, 58.738, 15.0, null],
  ['SH2-136', 319.108, 68.26, 10.0, null],
  ['SH2-137', 329.3, 64.68, 10, null],
  ['SH2-138', 338.19, 58.472, 10, null],
  ['SH2-139', 338.75, 58.22, 10, null],
  ['SH2-140', 334.783, 63.285, 10.0, null],
  ['SH2-141', 337.16, 61.631, 10, null],
  ['SH2-142', 341.883, 58.048, 25.0, 'Nébuleuse de l\'Araignée'],
  ['SH2-143', 342.55, 57.7, 10.0, null],
  ['SH2-144', 341.2, 59.88, 8.0, null],
  ['SH2-145', 336.37, 64.3, 10, null],
  ['SH2-146', 342.371, 59.916, 10, null],
  ['SH2-147', 343.93, 58.47, 180.0, null],
  ['SH2-148', 344.075, 58.517, 10, null],
  ['SH2-149', 344.07, 58.523, 10.0, null],
  ['SH2-150', 337.316, 64.852, 10, null],
  ['SH2-151', 345.86, 57.225, 10, null],
  ['SH2-152', 344.67, 58.783, 5.0, null],
  ['SH2-153', 344.654, 58.78, 8.0, null],
  ['SH2-154', 342.87, 61.17, 10, null],
  ['SH2-155', 344.275, 62.636, 60.0, 'Nébuleuse de la Caverne'],
  ['SH2-156', 346.291, 60.242, 10, null],
  ['SH2-157', 349.016, 60.034, 60.0, null],
  ['SH2-158', 348.405, 61.5, 20.0, null],
  ['SH2-159', 348.88, 61.119, 10, null],
  ['SH2-160', 346.45, 64.67, 10, null],
  ['SH2-161', 348.872, 61.862, 10, null],
  ['SH2-162', 350.201, 61.202, 10, null],
  ['SH2-163', 353.241, 60.8, 4.0, null],
  ['SH2-164', 354.599, 59.978, 10, null],
  ['SH2-165', 354.95, 61.93, 10, null],
  ['SH2-166', 355.046, 60.96, 10, null],
  ['SH2-167', 353.877, 64.872, 10, null],
  ['SH2-168', 358.235, 60.484, 20.0, null],
  ['SH2-169', 358.5, 60.37, 10, null],
  ['SH2-170', 0.37, 64.651, 15.0, null],
  ['SH2-171', 353.68, 66.56, 30.0, null],
  ['SH2-173', 4.37, 61.75, 15.0, null],
  ['SH2-174', 12.0, 74.25, 30.0, null],
  ['SH2-175', 14.78, 62.36, 6.0, null],
  ['SH2-176', 20.25, 62.04, 30.0, null],
  ['SH2-177', 18.5, 61.4, 10.0, null],
  ['SH2-182', 21.56, 66.31, 20.0, null],
  ['SH2-183', 21.07, 68.08, 10.0, null],
  ['SH2-184', 14.24, 56.01, 3.0, null],
  ['SH2-185', 14.49, 60.78, 120.0, 'Nébuleuse IC 59/63'],
  ['SH2-188', 22.81, 58.85, 8.0, null],
  ['SH2-190', 23.98, 61.87, 20.0, 'Nébuleuse de l\'Étoile de mer'],
  ['SH2-198', 27.61, 60.54, 90.0, 'Nébuleuse du Cœur IC 1805'],
  ['SH2-199', 34.36, 60.58, 150.0, 'Nébuleuse de l\'Âme IC 1848'],
  ['SH2-200', 30.46, 63.33, 30.0, null],
  ['SH2-201', 34.59, 63.88, 60.0, null],
  ['SH2-204', 45.21, 57.64, 5.0, null],
  ['SH2-205', 48.57, 57.17, 5.0, null],
  ['SH2-206', 48.53, 49.98, 20.0, null],
  ['SH2-207', 52.79, 52.59, 5.0, null],
  ['SH2-208', 53.04, 52.8, 8.0, null],
  ['SH2-209', 50.98, 58.15, 15.0, null],
  ['SH2-210', 53.72, 58.92, 30.0, null],
  ['SH2-211', 54.12, 60.11, 10.0, null],
  ['SH2-212', 73.86, 47.8, 10.0, null],
  ['SH2-219', 74.91, 47.77, 5.0, null],
  ['SH2-220', 76.16, 46.16, 5.0, null],
  ['SH2-221', 77.0, 47.4, 8.0, null],
  ['SH2-224', 78.57, 37.25, 5.0, null],
  ['SH2-228', 83.82, 32.9, 8.0, null],
  ['SH2-230', 87.93, 34.56, 10.0, null],
  ['SH2-231', 88.37, 36.48, 5.0, null],
  ['SH2-232', 88.53, 37.52, 5.0, null],
  ['SH2-233', 88.75, 37.75, 5.0, null],
  ['SH2-234', 90.82, 44.74, 8.0, null],
  ['SH2-235', 91.41, 35.85, 20.0, null],
  ['SH2-236', 91.02, 39.16, 5.0, null],
  ['SH2-237', 92.75, 29.52, 10.0, null],
  ['SH2-238', 93.26, 33.64, 5.0, null],
  ['SH2-239', 92.68, 30.78, 20.0, null],
  ['SH2-240', 97.05, 27.9, 180.0, 'Nébuleuse du Crayon'],
  ['SH2-241', 93.36, 37.55, 10.0, null],
  ['SH2-242', 95.45, 38.57, 10.0, null],
  ['SH2-243', 95.49, 38.37, 5.0, null],
  ['SH2-245', 100.55, 13.36, 30.0, null],
  ['SH2-247', 96.55, 9.93, 10.0, null],
  ['SH2-249', 97.11, 22.73, 10.0, null],
  ['SH2-252', 98.53, 24.72, 30.0, 'Nébuleuse du Singe'],
  ['SH2-254', 98.9, 17.74, 10.0, null],
  ['SH2-255', 99.07, 18.0, 5.0, null],
  ['SH2-256', 99.3, 17.92, 5.0, null],
  ['SH2-257', 99.47, 18.15, 5.0, null],
  ['SH2-258', 100.27, 20.6, 8.0, null],
  ['SH2-261', 103.52, 9.71, 30.0, 'Nébuleuse du Poulpe'],
  ['SH2-263', 85.71, 7.0, 30.0, null],
  ['SH2-264', 85.26, 1.02, 600.0, 'Nébuleuse de Lambda Orionis'],
  ['SH2-273', 100.0, 22.5, 20.0, null],
  ['SH2-274', 111.25, 0.74, 90.0, null],
  ['SH2-275', 98.33, 8.79, 10.0, null],
  ['SH2-276', 83.78, -5.42, 180.0, 'Grande Nébuleuse d\'Orion étendue'],
  ['SH2-277', 81.76, -5.98, 20.0, null],
  ['SH2-278', 80.89, 4.07, 10.0, null],
  ['SH2-279', 83.73, -5.42, 20.0, 'Nébuleuse de Running Man'],
  ['SH2-280', 98.592, 2.468, 30.0, null],
  ['SH2-281', 83.81, -5.375, 5.0, null],
  ['SH2-282', 99.533, 1.42, 15.0, null],
  ['SH2-283', 99.621, 0.705, 5.0, null],
  ['SH2-284', 101.367, 0.297, 30.0, null],
  ['SH2-285', 103.813, -0.498, 10.0, null],
  ['SH2-286', 111.18, 1.3, 8.0, null],
  ['SH2-287', 104.871, -4.82, 10.0, null],
  ['SH2-288', 107.154, -4.313, 10.0, null],
  ['SH2-289', 112.09, 1.6, 5.0, null],
  ['SH2-290', 115.94, 19.35, 5.0, null],
  ['SH2-292', 111.42, 1.48, 30.0, null],
  ['SH2-293', 105.456, -11.301, 10, null],
  ['SH2-294', 113.56, -18.5, 15.0, null],
  ['SH2-295', 116.07, -12.01, 8.0, null],
  ['SH2-296', 108.5, -12.0, 150.0, null],
  ['SH2-297', 116.36, -11.32, 10.0, null],
  ['SH2-298', 118.15, -17.33, 10.0, null],
  ['SH2-299', 118.71, -13.87, 10.0, null],
  ['SH2-300', 123.16, -32.71, 15.0, null],
  ['SH2-301', 121.75, -20.68, 10.0, null],
  ['SH2-302', 122.87, -23.35, 20.0, null],
  ['SH2-303', 122.69, -24.68, 8.0, null],
  ['SH2-304', 124.21, -27.54, 10.0, null],
  ['SH2-305', 126.65, -34.58, 12.0, null],
  ['SH2-306', 129.12, -34.67, 8.0, null],
  ['SH2-307', 139.34, -34.87, 8.0, null],
  ['SH2-308', 98.49, -14.37, 40.0, 'Nébuleuse de l\'Étoile de Mer Zeta Puppis'],
  ['SH2-309', 112.95, -19.435, 10, null],
  ['SH2-310', 111.02, -25.971, 10, null],
  ['SH2-311', 123.96, -26.68, 90.0, 'Nébuleuse NGC 2467'],
  ['SH2-312', 131.72, -32.38, 30.0, null],
  ['SH2-313', 193.387, -22.873, 10, null],
];

// ─── OpenNGC type mapping ────────────────────────────────────────────────────
const TYPE_MAP = {
  'G':    'Gx',  'Gxy':  'Gx', 'GxyP': 'Gx',
  'GGroup': 'Gx', 'GPair': 'Gx', 'GTrpl': 'Gx',
  'OCl':  'OC',  'OClAs': 'OC',
  'GCl':  'GC',
  'EN':   'EN',  'EmN':  'EN', 'EnN':  'EN', 'HII': 'EN',
  'RN':   'RN',  'RefN': 'RN',
  'PN':   'PN',
  'SNR':  'SNR',
  'DN':   'DN',  'DrkN': 'DN',
  'C+N':  'EN',  'Cl+N': 'EN',
  'Neb':  '?',   'Nov':  '?', 'Other': '?',
  '*':    null,   '**':   null, // Skip single/double stars
  'Dup':  null,   'PD':   null,
};




function parseRA(raStr) {
  if (!raStr) return null;
  const parts = raStr.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseFloat(parts[0]);
  const m = parseFloat(parts[1]);
  const s = parts.length >= 3 ? parseFloat(parts[2]) : 0;
  return (h + m / 60 + s / 3600) * 15;
}

function parseDec(decStr) {
  if (!decStr) return null;
  const sign = decStr.startsWith('-') ? -1 : 1;
  const abs = decStr.replace(/^[+-]/, '');
  const parts = abs.split(':');
  const d = parseFloat(parts[0]);
  const m = parts.length >= 2 ? parseFloat(parts[1]) : 0;
  const s = parts.length >= 3 ? parseFloat(parts[2]) : 0;
  return sign * (d + m / 60 + s / 3600);
}

function parseNum(s) {
  if (!s || s.trim() === '') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

// ─── Galactic (l, b) → equatorial J2000 (IAU 1958 galactic system) ──────────
// NGP (J2000): α = 192.85948°, δ = 27.12825°. Galactic longitude of NCP: 122.93192°.
function galacticToEquatorial(l_deg, b_deg) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const alphaNGP = 192.85948 * toRad;
  const deltaNGP = 27.12825  * toRad;
  const lNCP     = 122.93192 * toRad;
  const l = l_deg * toRad;
  const b = b_deg * toRad;
  const sinDec = Math.sin(b) * Math.sin(deltaNGP) + Math.cos(b) * Math.cos(deltaNGP) * Math.cos(lNCP - l);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const cosDecSinHA = Math.cos(b) * Math.sin(lNCP - l);
  const cosDecCosHA = Math.cos(deltaNGP) * Math.sin(b) - Math.sin(deltaNGP) * Math.cos(b) * Math.cos(lNCP - l);
  let ra = (alphaNGP + Math.atan2(cosDecSinHA, cosDecCosHA)) * toDeg;
  ra = ((ra % 360) + 360) % 360;
  return { ra, dec: dec * toDeg };
}

// ─── Precession B1950 → J2000 (IAU FK4→FK5 rotation matrix, Murray 1989) ────
function precess1950to2000(ra_deg, dec_deg) {
  const M = [
    [ 0.9999256782, -0.0111820611, -0.0048579477],
    [ 0.0111820610,  0.9999374784, -0.0000271765],
    [ 0.0048579479, -0.0000271474,  0.9999881997],
  ];
  const toRad = Math.PI / 180;
  const ra = ra_deg * toRad;
  const dec = dec_deg * toRad;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const x2 = M[0][0]*x + M[0][1]*y + M[0][2]*z;
  const y2 = M[1][0]*x + M[1][1]*y + M[1][2]*z;
  const z2 = M[2][0]*x + M[2][1]*y + M[2][2]*z;
  return {
    ra:  (Math.atan2(y2, x2) * 180 / Math.PI + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, z2))) * 180 / Math.PI,
  };
}

async function fetchNGC() {
  const url = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';
  console.log('Downloading OpenNGC CSV...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchLBN() {
  const url = 'https://cdsarc.cds.unistra.fr/ftp/VII/9/catalog.dat';
  console.log('Downloading LBN catalog...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LBN HTTP ${res.status}`);
  return await res.text();
}

// Parse LBN catalog.dat (B1950 coords).
// Returns array of: { seq, ra50, dec50, diam1, diam2, color, xrefCat, xrefNum }
function parseLBN(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const p = t.split(/\s+/);
    if (p.length < 12) continue;
    const seq    = parseInt(p[0]);
    const rah    = parseInt(p[3]);
    const ram    = parseFloat(p[4]);
    const deSign = p[5].startsWith('-') ? -1 : 1;
    const deAbs  = Math.abs(parseFloat(p[5]));
    const deMin  = parseFloat(p[6]);
    const diam1  = parseFloat(p[7]);   // arcmin, largest
    const diam2  = parseFloat(p[8]);   // arcmin, smallest
    const color  = parseInt(p[10]);    // 1=blue(RN), 2-4=red(EN)
    // p[12] = identification number (not the LBN seq)
    // p[13] = xref catalog prefix (S, NGC, IC, DG, C…), p[14] = number
    const xrefCat = p.length >= 15 ? p[13] : null;
    const xrefNum = p.length >= 15 ? parseInt(p[14]) : NaN;
    if (isNaN(seq) || isNaN(rah) || isNaN(ram) || isNaN(deAbs) || isNaN(deMin)) continue;
    const ra50  = (rah + ram / 60) * 15;
    const dec50 = deSign * (deAbs + deMin / 60);
    entries.push({ seq, ra50, dec50, diam1, diam2, color, xrefCat, xrefNum });
  }
  return entries;
}

async function fetchLDN() {
  const url = 'https://cdsarc.cds.unistra.fr/ftp/VII/7A/ldn';
  console.log('Downloading LDN catalog...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LDN HTTP ${res.status}`);
  return await res.text();
}

// Parse LDN catalog (B1950 coords).
// Returns array of: { ldn, ra50, dec50, area, opacity }
function parseLDN(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const p = t.split(/\s+/);
    if (p.length < 9) continue;
    const ldn    = parseInt(p[0]);
    const rah    = parseInt(p[1]);
    const ram    = parseFloat(p[2]);
    const deSign = p[3].startsWith('-') ? -1 : 1;
    const deAbs  = Math.abs(parseFloat(p[3]));
    const deMin  = parseFloat(p[4]);
    // p[5]=GLON, p[6]=GLAT (skip)
    const area    = parseFloat(p[7]);   // square degrees
    const opacity = parseInt(p[8]);
    if (isNaN(ldn) || ldn === 0) continue;   // skip unnumbered entries
    if (isNaN(rah) || isNaN(ram) || isNaN(deAbs) || isNaN(deMin) || isNaN(area)) continue;
    const ra50  = (rah + ram / 60) * 15;
    const dec50 = deSign * (deAbs + deMin / 60);
    entries.push({ ldn, ra50, dec50, area, opacity });
  }
  return entries;
}

// Curated Barnard → existing-object identity/association map.
// OpenNGC carries no Barnard cross-refs and SIMBAD treats Barnard dark nebulae
// as distinct from the bright NGC/IC nebulae they are silhouetted against, so
// these associations are a deliberate curation choice to avoid duplicate markers
// on iconic objects. The bright object stays primary; the Barnard id becomes an
// alias on it (and the standalone Barnard entry is suppressed). Verify any new
// pair before adding it — do NOT add dark-nebula-next-to-cluster pairs (e.g.
// B86/NGC6520, B81/NGC6401) which are genuinely separate objects.
const BARNARD_ALIASES = {
  Barnard33:  'IC434',   // Horsehead dark nebula, silhouetted against IC434
  Barnard168: 'IC5146',  // dark lane leading to the Cocoon Nebula (IC5146)
};

// ─── Curated vdB → NGC/IC/M/SH2/LBN cross-identifications ───────────────────
// The van den Bergh (1966) catalog (VII/21) has NO NGC/IC column and gives only
// galactic coordinates at 0.1° (~6') precision, marking the *illuminating star*.
// Many vdB reflection nebulae are the same physical object as an NGC/IC/M/SH2/LBN
// nebula but were not auto-matched (OpenNGC's Identifiers column omits the vdB id).
// Each mapping below was verified against SIMBAD (positions coincide; vdB number
// resolves to the nebula's illuminating star inside that object). When merged, the
// vdB id is appended to the target row's catalogs[] and the standalone vdB row is
// suppressed, so it inherits the target's precise position. Distinct objects that
// merely lie near a cluster (vdB23≈M45, vdB6≈NGC654) are intentionally NOT merged.
const VDB_ALIASES = {
  5:   'SH2-185',  17:  'NGC1333', 19:  'IC348',   21:  'NGC1432', 22:  'IC349',
  28:  'NGC1555',  33:  'NGC1788', 34:  'IC405',   44:  'IC420',   46:  'NGC1999',
  50:  'IC431',    51:  'IC432',   52:  'NGC2023', 57:  'IC435',   59:  'M78',
  60:  'NGC2071',  66:  'NGC2149', 67:  'NGC2170', 72:  'NGC2182', 73:  'NGC2185',
  82:  'NGC2247',  85:  'NGC2282', 93:  'IC2177',  105: 'IC4603',  106: 'IC4604',
  108: 'IC4605',   115: 'IC4684',  118: 'NGC6589', 119: 'NGC6590', 124: 'IC1287',
  137: 'IC5076',   139: 'NGC7023', 140: 'LBN446',  99:  'SH2-1',
};

// Authoritative vdB positions (ICRS J2000, decimal degrees) resolved from SIMBAD
// by illuminating star — replaces the coarse galactic→equatorial conversion for
// standalone vdB rows. Regenerate via the SIMBAD TAP query documented in
// docs/dev/dso-catalog.md. Keyed by vdB number; missing numbers fall back to the
// galactic-coordinate conversion.
const VDB_COORDS_PATH = join(__dirname, 'vdb-coords.json');
const VDB_COORDS = existsSync(VDB_COORDS_PATH)
  ? JSON.parse(readFileSync(VDB_COORDS_PATH, 'utf8'))
  : {};

// Authoritative SH2 angular diameters (arcmin) from the Sharpless (1959) catalogue,
// Vizier VII/20 `Diam` column — the best machine-readable size source for these
// H-II regions. Keyed by SH2 number. Used to correct the hand-entered SH2_DATA
// majAxis values that diverge from Sharpless by >3× (see docs/dev/dso-catalog.md).
// Regenerate: SELECT "Sh2", Diam FROM "VII/20/catalog" on the Vizier TAP service.
const SHARPLESS_DIAM_PATH = join(__dirname, 'sharpless-diam.json');
const SHARPLESS_DIAM = existsSync(SHARPLESS_DIAM_PATH)
  ? JSON.parse(readFileSync(SHARPLESS_DIAM_PATH, 'utf8'))
  : {};

// ─── Curated SH2 → NGC/IC/Abell merges ─────────────────────────────────────
// SH2 H-II regions that are the same physical object as an already-catalogued
// NGC/IC/Abell nebula. The SH2 row is suppressed and its designations folded into
// the target row's catalogs[] (so it inherits the target's position/type and there
// is a single object). Sizes/names for the target are set in dso-metadata-overrides.
// Verified against SIMBAD / standard references.
const SH2_ALIASES = {
  'SH2-95':  'NGC6842',  // small planetary nebula (= LBN 149)
  'SH2-171': 'NGC7822',  // 180' Cep OB4 region; most-used designation NGC 7822
  'SH2-190': 'IC1805',   // Heart Nebula
  'SH2-290': 'Abell31',  // large ancient planetary nebula Abell 31
};

async function fetchBarnard() {
  const url = 'https://cdsarc.cds.unistra.fr/ftp/VII/220A/barnard.dat';
  console.log('Downloading Barnard catalog...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Barnard HTTP ${res.status}`);
  return res.text();
}

// Parse Barnard's Catalogue of Dark Objects (VII/220A).
// Byte layout (1-indexed per ReadMe): 2-5 Barn, 23-24 RA2000h, 26-27 RA2000m,
// 29-30 RA2000s, 33 DE2000-, 34-35 DE2000d, 37-38 DE2000m, 40-44 Diam(arcmin).
// J2000 coords are provided directly — no precession needed.
// Returns array of: { barn, ra, dec, diam }
function parseBarnard(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.length < 38) continue;
    const barn = line.substring(1, 5).trim();           // e.g. "33", "67a"
    if (!barn) continue;
    const rah  = parseInt(line.substring(22, 24).trim());
    const ram  = parseInt(line.substring(25, 27).trim());
    const ras  = parseInt(line.substring(28, 30).trim()) || 0;
    const sign = line.charAt(32) === '-' ? -1 : 1;
    const ded  = parseInt(line.substring(33, 35).trim());
    const dem  = parseInt(line.substring(36, 38).trim());
    const diam = parseFloat(line.substring(39, 44).trim());
    if (isNaN(rah) || isNaN(ram) || isNaN(ded) || isNaN(dem)) continue;
    const ra  = (rah + ram / 60 + ras / 3600) * 15;
    const dec = sign * (ded + dem / 60);
    entries.push({ barn, ra, dec, diam: isNaN(diam) ? null : diam });
  }
  return entries;
}

async function fetchVdB() {
  const url = 'https://cdsarc.cds.unistra.fr/ftp/VII/21/catalog.dat';
  console.log('Downloading vdB catalog...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vdB HTTP ${res.status}`);
  return await res.text();
}

// Parse van den Bergh (1966) catalog.dat (galactic coordinates, epoch 1958 IAU).
// Byte positions (1-indexed, per ReadMe):
//   2-4: VdB number, 25-29: oGLON (deg), 30-34: oGLAT (deg)
//   45-49: Vmag, 71-75: BRadMax (arcmin, semi-major radius on blue prints)
// Returns array of: { vdb, glon, glat, vmag, bradmax }
function parseVdB(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.length < 29) continue;
    const vdb     = parseInt(line.substring(1, 4));
    const glon    = parseFloat(line.substring(24, 29));
    const glat    = parseFloat(line.substring(29, 34));
    const vmag    = parseFloat(line.substring(44, 49));
    const bradmax = parseFloat(line.substring(70, 75));
    if (isNaN(vdb) || vdb < 1) continue;
    if (isNaN(glon) || isNaN(glat)) continue;
    entries.push({
      vdb,
      glon,
      glat,
      vmag:    isNaN(vmag) ? null : vmag,
      bradmax: isNaN(bradmax) ? null : bradmax,
    });
  }
  return entries;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(';').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(';');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] ? cols[j].trim() : '';
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  // ── Step 1: Download OpenNGC CSV ─────────────────────────────────────────
  const csvText = await fetchNGC();
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} rows from OpenNGC`);

  // ── Step 2: Download LBN / LDN / vdB / Barnard catalogs ─────────────────
  let lbnEntries = [];
  let ldnEntries = [];
  let vdbEntries = [];
  let barnardEntries = [];
  try {
    const lbnText = await fetchLBN();
    lbnEntries = parseLBN(lbnText);
    console.log(`Parsed ${lbnEntries.length} LBN entries`);
  } catch (e) {
    console.warn(`Warning: could not fetch LBN: ${e.message}`);
  }
  try {
    const ldnText = await fetchLDN();
    ldnEntries = parseLDN(ldnText);
    console.log(`Parsed ${ldnEntries.length} LDN entries`);
  } catch (e) {
    console.warn(`Warning: could not fetch LDN: ${e.message}`);
  }
  try {
    const vdbText = await fetchVdB();
    vdbEntries = parseVdB(vdbText);
    console.log(`Parsed ${vdbEntries.length} vdB entries`);
  } catch (e) {
    console.warn(`Warning: could not fetch vdB: ${e.message}`);
  }
  try {
    barnardEntries = parseBarnard(await fetchBarnard());
    console.log(`Parsed ${barnardEntries.length} Barnard entries`);
  } catch (e) {
    console.warn(`Warning: could not fetch Barnard: ${e.message}`);
  }

  // ── Step 3: Build SH2-number → LBN-seq map (from LBN cross-refs) ─────────
  // LBN's xrefCat='S', xrefNum=NN means this LBN entry corresponds to SH2-NN.
  const sh2ToLbnSeq = new Map();   // SH2 number → LBN seq
  for (const lbn of lbnEntries) {
    if (lbn.xrefCat === 'S' && !isNaN(lbn.xrefNum)) {
      sh2ToLbnSeq.set(lbn.xrefNum, lbn.seq);
    }
  }

  // Track which LBN seqs are already assigned to an NGC/IC/SH2 entry
  const assignedLbnSeqs = new Set();

  // Track which vdB numbers are already assigned to an NGC/IC/SH2/LBN entry
  const assignedVdbNums = new Set();

  // Track which Barnard ids are already assigned as cross-refs to NGC/IC entries
  const assignedBarnardIds = new Set();

  // ── Step 4: Process OpenNGC CSV ──────────────────────────────────────────
  const data = [];
  let skipped = 0;

  for (const row of rows) {
    // Determine primary id
    const catalog = (row['Catalog'] || row['Name'] || '').trim();
    const objName = (row['Name'] || row['Object'] || '').trim();
    const idSource = catalog.startsWith('NGC') || catalog.startsWith('IC') ? catalog : objName;

    // Parse type
    const rawType = row['Type'] || row['ObjectType'] || '';
    const mappedType = TYPE_MAP[rawType];
    if (mappedType === null || mappedType === undefined) {
      if (mappedType === null) { skipped++; continue; }
    }
    const dsoType = mappedType || '?';

    // Parse coordinates
    const ra = parseRA(row['RA'] || row['Ra']);
    const dec = parseDec(row['Dec'] || row['DEC']);
    if (ra === null || dec === null) { skipped++; continue; }

    // Build ID
    let id = '';
    const catName = idSource;
    if (catName.startsWith('NGC') || catName.startsWith('IC')) {
      const prefix = catName.startsWith('NGC') ? 'NGC' : 'IC';
      const suffix = catName.slice(prefix.length).trim();
      // Skip sub-components like NGC5866B — they would collide with the main object id
      if (!/^\d+$/.test(suffix)) { skipped++; continue; }
      const num = parseInt(suffix, 10);
      id = `${prefix}${num}`;
    } else {
      skipped++; continue;
    }

    // Messier designation
    const messierNum = row['M'] || row['Messier'];
    let primaryId = id;
    if (messierNum && messierNum.trim() !== '') {
      primaryId = `M${parseInt(messierNum.trim(), 10)}`;
    }

    // Dimensions
    const majAxis = parseNum(row['MajAx'] || row['Maj.Ax.'] || row['SizeMax']);
    const minAxis = parseNum(row['MinAx'] || row['Min.Ax.'] || row['SizeMin']);
    const pa = parseNum(row['PA'] || row['PosAng']) || 0;
    const mag = parseNum(row['V-Mag'] || row['Mag'] || row['Bmag'] || row['Vmag']);

    // French / English / Spanish / German names and type corrections come from
    // dso-metadata-overrides.json (applied by applyMetadataOverrides at the end).

    const finalType = dsoType;

    // ── Extract LBN cross-refs from Identifiers field ─────────────────────
    const identifiers = row['Identifiers'] || '';
    const lbnMatches = [...identifiers.matchAll(/LBN\s+(\d+)/g)];
    const lbnIds = lbnMatches.map(m => `LBN${parseInt(m[1])}`);
    for (const m of lbnMatches) assignedLbnSeqs.add(parseInt(m[1]));

    // ── Extract vdB cross-refs from Identifiers field ─────────────────────
    // Matches "VdB 23", "vdB 23", "VDB 23" but not "vdBH NNN" (Herbst catalog)
    const vdbMatches = [...identifiers.matchAll(/vdB\s+(\d+)/gi)];
    const vdbIds = vdbMatches.map(m => `vdB${parseInt(m[1])}`);
    for (const m of vdbMatches) assignedVdbNums.add(parseInt(m[1]));

    // NOTE: OpenNGC's Identifiers column does not carry Barnard designations,
    // so Barnard cross-refs are handled via the curated BARNARD_ALIASES map
    // (applied after this loop), not by scanning Identifiers here.

    // ── Build catalogs array ──────────────────────────────────────────────
    // Priority: M first, then NGC/IC, then LBN, then vdB
    const catalogs = [];
    if (primaryId !== id) catalogs.push(primaryId);  // M-number
    catalogs.push(id);                                // NGC/IC
    catalogs.push(...lbnIds);
    catalogs.push(...vdbIds);

    data.push([
      primaryId,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      finalType,
      majAxis !== null ? Math.round(majAxis * 10) / 10 : null,
      minAxis !== null ? Math.round(minAxis * 10) / 10 : null,
      Math.round(pa),
      mag !== null ? Math.round(mag * 100) / 100 : null,
      null,
      null,
      null,
      null,
      catalogs,
      null,
      null,
      null,
    ]);
  }

  // ── Step 5: SH2 objects (with optional LBN cross-ref) ────────────────────
  for (const [shId, ra, dec, majAxis] of SH2_DATA) {
    if (dec < -35) continue;
    const sh2Num = parseInt(shId.slice(4));   // 'SH2-17' → 17
    // Prefer the authoritative Sharpless VII/20 diameter when the hand-entered
    // value diverges from it by >3× (in either direction). Per-object exceptions
    // where Sharpless itself is wrong (e.g. SH2-147/Simeis 147) are corrected via
    // a majAxis override in dso-metadata-overrides.json.
    const sharp = SHARPLESS_DIAM[sh2Num];
    let sh2Maj = majAxis;
    if (sharp != null) {
      if (majAxis == null || sharp / majAxis > 3 || majAxis / sharp > 3) sh2Maj = sharp;
    }
    const lbnSeq = sh2ToLbnSeq.get(sh2Num);
    const lbnIds = [];
    if (lbnSeq !== undefined) {
      lbnIds.push(`LBN${lbnSeq}`);
      assignedLbnSeqs.add(lbnSeq);
    }
    // Names come from dso-metadata-overrides.json via applyMetadataOverrides
    data.push([
      shId,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      'EN',
      sh2Maj,
      null,
      0,
      null,
      null,
      null,
      null,
      null,
      [shId, ...lbnIds],
      null,
      null,
      null,
    ]);
  }

  // ── Step 6: Standalone LBN entries ───────────────────────────────────────
  // LBN entries not already assigned to NGC/IC/SH2 objects
  let lbnAdded = 0;
  for (const lbn of lbnEntries) {
    if (assignedLbnSeqs.has(lbn.seq)) continue;
    const { ra, dec } = precess1950to2000(lbn.ra50, lbn.dec50);
    if (dec < -35) continue;
    // Type: color 1 = brighter on blue → likely reflection nebula
    const lbnType = lbn.color === 1 ? 'RN' : 'EN';
    const lbnId = `LBN${lbn.seq}`;
    data.push([
      lbnId,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      lbnType,
      lbn.diam1 || null,
      lbn.diam2 || null,
      0,
      null,
      null,
      null,
      null,
      null,
      [lbnId],
      null,
      null,
      null,
    ]);
    lbnAdded++;
  }
  console.log(`Added ${lbnAdded} standalone LBN entries`);

  // ── Step 7: LDN dark nebula entries ──────────────────────────────────────
  // Include all with opacity ≥ 4 (clearly dark) to keep catalog size manageable
  let ldnAdded = 0;
  for (const ldn of ldnEntries) {
    if (ldn.opacity < 4) continue;
    const { ra, dec } = precess1950to2000(ldn.ra50, ldn.dec50);
    if (dec < -35) continue;
    // Estimate diameter from area (sq degrees): assume circular
    const radiusDeg = Math.sqrt(ldn.area / Math.PI);
    const majAxisArcmin = Math.round(radiusDeg * 60 * 2 * 10) / 10;  // diameter
    const ldnId = `LDN${ldn.ldn}`;
    data.push([
      ldnId,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      'DN',
      majAxisArcmin || null,
      null,
      0,
      null,
      null,
      null,
      null,
      null,
      [ldnId],
      null,
      null,
      null,
    ]);
    ldnAdded++;
  }
  console.log(`Added ${ldnAdded} LDN entries (opacity ≥ 4)`);

  // ── Step 7b: Curated vdB → NGC/IC/M/SH2/LBN aliases ──────────────────────
  // Append each curated vdB id to its target object's catalogs[] and mark it
  // assigned so the standalone loop below does not emit a duplicate marker.
  // Targets are NGC/IC/M (Step 4), SH2 (Step 5), LBN (Step 6) — all already in
  // `data` at this point. (Messier-only objects are added later in Step 11, but
  // no vdB alias targets one — M78 already exists from OpenNGC.)
  const rowByIdVdb = new Map(data.map(r => [String(r[0]).toUpperCase(), r]));
  let vdbAliasMerged = 0;
  for (const [num, targetId] of Object.entries(VDB_ALIASES)) {
    const target = rowByIdVdb.get(String(targetId).toUpperCase());
    if (!target) { console.warn(`Warning: vdB alias target ${targetId} not found for vdB${num}`); continue; }
    const vdbId = `vdB${num}`;
    if (!target[12].some(c => String(c).toLowerCase() === vdbId.toLowerCase())) target[12].push(vdbId);
    assignedVdbNums.add(Number(num));
    vdbAliasMerged++;
  }
  console.log(`Merged ${vdbAliasMerged} vdB aliases into existing objects`);

  // ── Step 8: Standalone vdB entries ───────────────────────────────────────
  // vdB entries not already assigned as cross-refs to NGC/IC objects.
  // Position: authoritative SIMBAD star coords (VDB_COORDS) when available,
  // else galactic (B1950 IAU 1958 system) → equatorial J2000 fallback.
  // BRadMax = semi-major radius in arcmin → majAxis = 2 × BRadMax (diameter).
  let vdbAdded = 0;
  for (const entry of vdbEntries) {
    if (assignedVdbNums.has(entry.vdb)) continue;
    const simbad = VDB_COORDS[entry.vdb];
    const { ra, dec } = simbad
      ? { ra: simbad[0], dec: simbad[1] }
      : galacticToEquatorial(entry.glon, entry.glat);
    if (dec < -35) continue;
    const vdbId = `vdB${entry.vdb}`;
    // Names come from dso-metadata-overrides.json via applyMetadataOverrides
    // majAxis = diameter = 2 × radius; cap at 300' to avoid absurdly large hit areas
    const majAxis = entry.bradmax !== null ? Math.min(entry.bradmax * 2, 300) : null;
    data.push([
      vdbId,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      'RN',
      majAxis,
      null,
      0,
      entry.vmag,
      null,
      null,
      null,
      null,
      [vdbId],
      null,
      null,
      null,
    ]);
    vdbAdded++;
  }
  console.log(`Added ${vdbAdded} standalone vdB entries`);

  // ── Step 9: Apply curated Barnard aliases ────────────────────────────────
  // Append each curated Barnard id to its target object's catalogs[] (field 12)
  // and mark it assigned so it is not emitted as a standalone duplicate marker.
  const rowById = new Map(data.map(r => [r[0], r]));
  let barnardMerged = 0;
  for (const e of barnardEntries) {
    const barnId = `Barnard${e.barn}`;
    const targetId = BARNARD_ALIASES[barnId];
    if (!targetId) continue;
    const target = rowById.get(targetId);
    if (!target) { console.warn(`Warning: Barnard alias target ${targetId} not found for ${barnId}`); continue; }
    target[12].push(barnId);
    assignedBarnardIds.add(e.barn);
    barnardMerged++;
  }
  console.log(`Merged ${barnardMerged} Barnard aliases into existing objects`);

  // ── Step 10: Standalone Barnard dark-object entries ───────────────────────
  // Barnard objects not merged as a curated alias above.
  // J2000 coordinates are read directly from the catalog (no conversion needed).
  // Diam column is already a diameter in arcminutes.
  let barnardAdded = 0;
  for (const e of barnardEntries) {
    if (assignedBarnardIds.has(e.barn)) continue;
    if (e.dec < -35) continue;
    const barnId = `Barnard${e.barn}`;
    const majAxis = e.diam !== null ? Math.min(e.diam, 300) : null;
    data.push([
      barnId,
      Math.round(e.ra * 1000) / 1000,
      Math.round(e.dec * 1000) / 1000,
      'DN',
      majAxis,
      null,
      0,
      null,
      null,
      null,
      null,
      null,
      [barnId],
      null,
      null,
      null,
      null,
    ]);
    barnardAdded++;
  }
  console.log(`Added ${barnardAdded} standalone Barnard entries`);

  // ── Step 11: Large Planetary Nebulae (Vogel Large PN Observing Guide) ───────
  // Source: "Large Planetaries Observing Guide" by Reiner Vogel (reinervogel.net)
  // Emission line data from Madsen et al. 2006, Proc IAU Symp 234.
  //
  // Strategy:
  // a) For objects already in the catalog (NGC/M/SH2 entries), inject emissionLines
  //    and any extra cross-ref IDs into their existing data row.
  // b) For objects not in any existing catalog, add new LPN-prefixed entries.
  //
  // Build a lookup: canonical existingId → { emissionLines, extraCatIds, coordFix, magFix, nameEnFix, nameFrFix }
  // coordFix: { ra, dec, majAxis, minAxis } overrides wrong OpenNGC coordinates
  const existingLPNUpdates = [
    { id: 'NGC7293', emissionLines: 'HD and OIII',           extraCatIds: [] },
    { id: 'M27',    emissionLines: 'Halo OIII',              extraCatIds: [] },
    { id: 'NGC1360', emissionLines: null,                    extraCatIds: [] },
    { id: 'SH2-174', emissionLines: null,                    extraCatIds: ['PN G120.3+18.3'] },
    { id: 'SH2-68',  emissionLines: null,                    extraCatIds: ['PN G030.6+06.2'] },
    { id: 'SH2-176', emissionLines: 'mostly NII, HD weaker', extraCatIds: ['PN G120.2-05.3'] },
    { id: 'SH2-188', emissionLines: 'HD > OIII',             extraCatIds: ['Simeis 22', 'PN G128.0-04.1'] },
    { id: 'SH2-200', emissionLines: 'OIII and HD',           extraCatIds: ['HDW 2', 'PN G138.1+04.1'] },
    { id: 'SH2-78',  emissionLines: 'OIII and HD',           extraCatIds: ['CTSS 3', 'PN G046.8+03.8'] },
    // SH2-274 IS the Medusa Nebula / Abell 21 but OpenNGC has wrong coordinates (7h25m +0°44').
    // Correct position: RA 07h 29m 02.69s, Dec +13° 14' 48.4" (Gemini)
    // 'Abell21' (no space) added so getDSOById('Abell21') resolves to this object.
    { id: 'SH2-274', emissionLines: 'OIII and HD',
      extraCatIds: ['Abell 21', 'Abell21', 'PN G205.1+14.2', 'PK 205+14.1'],
      coordFix: {
        ra:  (7 + 29/60 + 2.69/3600) * 15,  // 112.261°
        dec:  13 + 14/60 + 48.4/3600,        // +13.247°
        majAxis: 12, minAxis: 9,
      },
      magFix: 10.2,
      nameEnFix: 'Medusa Nebula',
      nameFrFix: 'N\u00e9buleuse de la M\u00e9duse',
    },
  ];

  // Index: id → row index in data array
  const dataIdxById = new Map();
  for (let i = 0; i < data.length; i++) {
    dataIdxById.set(data[i][0], i);
  }
  // Field 13 is emissionLines (new) and fields 14-16 are metadata override fields.
  // Ensure all existing rows have the expected number of fields.
  for (const row of data) {
    while (row.length < 17) row.push(null);
  }

  // Apply updates to existing entries
  let existingUpdated = 0;
  for (const { id, emissionLines, extraCatIds, coordFix, magFix, nameEnFix, nameFrFix } of existingLPNUpdates) {
    const idx = dataIdxById.get(id);
    if (idx === undefined) {
      console.warn(`LPN update: ${id} NOT FOUND in data, skipping`);
      continue;
    }
    const row = data[idx];
    // Fix wrong coordinates from OpenNGC if provided
    if (coordFix) {
      row[1] = Math.round(coordFix.ra * 1000) / 1000;
      row[2] = Math.round(coordFix.dec * 1000) / 1000;
      if (coordFix.majAxis != null) row[4] = coordFix.majAxis;
      if (coordFix.minAxis != null) row[5] = coordFix.minAxis;
    }
    // Fix missing magnitude
    if (magFix != null) row[7] = magFix;
    // Fix names
    if (nameEnFix) row[9] = nameEnFix;
    if (nameFrFix) row[8] = nameFrFix;
    // Set emissionLines (field 13)
    row[13] = emissionLines;
    // Append extra catalog IDs to catalogs array (field 12) if not already present
    if (extraCatIds.length > 0) {
      const cats = row[12];
      for (const c of extraCatIds) {
        if (!cats.includes(c)) cats.push(c);
      }
    }
    existingUpdated++;
  }
  console.log(`Updated ${existingUpdated} existing entries with Large PN data`);

  // New standalone LPN entries (not in any existing catalog)
  // Format: [id, ra°, dec°, type, majAxis', minAxis', pa, mag, nameFr, nameEn, catalogs[], emissionLines]
  function hms(h, m, s) { return (h + m / 60 + s / 3600) * 15; }
  function dms(d, m, s, neg = false) { const v = d + m / 60 + s / 3600; return neg ? -v : v; }

  const lpnEntries = [
    // [id, ra, dec, majAxis, minAxis, emissionLines, nameEn, nameFr, otherCatIds]
    ['LPN-Sh2216',      hms( 4,43,22), dms(46,42, 7),   100, null, 'OIII > HD',  // coords from SIMBAD (PN G158.5+00.7)
      'Sh 2-216', 'Sh 2-216', ['SH2-216', 'PN G158.6+00.7']],
    ['LPN-Outters4',    hms(21,11,48), dms(59,59,12),    69,   20, null,
      'Outters 4', 'Outters 4', []],
    ['LPN-TK2',         hms(17,38, 2), dms(66,53,48),    60, null, null,
      'TK 2', 'TK 2', ['RE 1738+665', 'PN G096.8+31.9']],
    ['LPN-TK1',         hms( 8,27, 6), dms(31,30, 9),    30, null, null,
      'TK 1', 'TK 1', ['TON 320', 'PN G191.4+33.0']],
    ['LPN-WeDe1',       hms( 5,59,24), dms(10,41,40),    22,   17, null,
      'WeDe 1', 'WeDe 1', ['WDHS 1', 'PN G197.4-06.4']],
    ['LPN-PuWe1',       hms( 6,19,34), dms(55,36,42),    20, null, 'HD and OIII',
      'PuWe 1', 'PuWe 1', ['PN G158.9+17.8']],
    ['LPN-PFP1',        hms( 7,22,18), dms( 6,21,46,true), 19, 18, 'mostly NII, HD and OIII weak',
      'PFP 1', 'PFP 1', ['PN G222.1+03.9']],
    // Abell PNe: primary IDs are now Abell{N} (Abell catalog priority > LPN).
    // LPN-Abell{N} is kept as a secondary cross-reference (same pattern as M > NGC).
    ['Abell31',     hms( 8,54,13), dms( 8,53,58),    17,   16, 'OIII > HD',
      'Abell 31', 'Abell 31', ['LPN-Abell31', 'PN G219.1+31.2'], 12.0],
    ['LPN-IsWe2',       hms(22,13,22), dms(65,53,55),    16,   14, 'mostly HD, HE & OIII',
      'IsWe 2', 'IsWe 2', ['PN G107.7+07.8']],
    ['Abell35',     hms(12,53,33), dms(22,52,23,true), 13, 11, 'HD and OIII',  // coords from SIMBAD (PN A66 35); maj updated to SIMBAD 12.87→13
      'Abell 35', 'Abell 35', ['LPN-Abell35', 'PN G303.6+40.0'], 13.3],
    ['LPN-HFG1',        hms( 3, 3,46), dms(64,54,36),    15, null, 'mostly OIII',  // coords from SIMBAD (PN G136.3+05.5)
      'HFG 1', 'HFG 1', ['PN G136.3+05.5']],
    ['Abell74',     hms(21,16,52), dms(24, 8,51),    15,   13, 'HD and OIII',
      'Abell 74', 'Abell 74', ['LPN-Abell74', 'PN G072.7-17.1'], 15.8],
    ['Abell7',      hms( 5, 3, 8), dms(15,36,13,true), 13, 11, 'HD and OIII',  // maj updated to SIMBAD 12.73→13
      'Abell 7', 'Abell 7', ['LPN-Abell7', 'PN G215.5-30.8'], 13.2],
    ['LPN-IsWe1',       hms( 3,49, 5), dms(50, 0,15),    13, null, null,
      'IsWe 1', 'IsWe 1', ['PN G149.7-03.3']],
    ['LPN-EGB6',        hms( 9,53, 0), dms(13,44,50),    13,   11, 'OIII > HD',
      'EGB 6', 'EGB 6', ['PN G221.5+46.3']],
    ['LPN-MWP1',        hms(21,17, 7), dms(34,12,40),    13,    9, 'OIII > HD',
      'MWP 1', 'MWP 1', ['PN G080.3-10.4']],
    ['LPN-Jacoby1',     hms(15,21,47), dms(52,22, 5),    11, null, 'mostly OIII',
      'Jacoby 1', 'Jacoby 1', ['PK 085+52.1']],
    ['LPN-HDW3',        hms( 3,27,15), dms(45,24,19),     9, null, 'OIII > HD',
      'HDW 3', 'HDW 3', ['HW 4', 'PN G149.4-09.2']],
    ['LPN-DeHt5',       hms(22,19,34), dms(70,56, 1),     9, null, 'HD > OIII',
      'DeHt 5', 'DeHt 5', ['DHW 5', 'PN G111.0+11.6']],
    ['LPN-LoTr5',       hms(12,55,34), dms(25,53,28),     9, null, 'mostly OIII',
      'LoTr 5', 'LoTr 5', ['PN G339.9+88.4']],
    // Abell 29/36: RA given as "HH MM.m" (decimal minutes, no seconds)
    ['Abell29',     hms( 8,40,18), dms(20,54,36,true),  8, null, null,  // coords from SIMBAD (PN A66 29)
      'Abell 29', 'Abell 29', ['LPN-Abell29', 'PN G244.5+12.5'], 14.3],
    ['Abell36',     (13 + 40.7/60) * 15, dms(19,53, 0,true), 6, null, 'mostly OIII',  // maj updated to SIMBAD 6.12→6
      'Abell 36', 'Abell 36', ['LPN-Abell36', 'PN G318.4+41.4'], 11.8],
    ['LPN-Ko2-2',       hms( 6,52,28), dms( 9,58,17),     7, null, 'OIII and HD',
      'Kohoutek 2-2', 'Kohoutek 2-2', ['PN G204.1+04.7']],
    ['LPN-JnEr1',       hms( 7,57,51), dms(53,25,16),     7,    6, 'OIII and HD',
      'Jones-Emberson 1', 'Jones-Emberson 1', ['VV 47', 'PN G164.8+31.1']],
    ['LPN-YM16',        hms(18,54,57), dms( 6, 2,31),     6, null, null,
      'Yerkes-McDonald 16', 'Yerkes-McDonald 16', ['PN G038.7+01.9']],
    ['LPN-IPHASX205013', hms(20,50, 5), dms(46,52,48),    6, null, 'OIII and HD',
      'Ear Nebula', 'Ear Nebula', ['IPHASX J205013.7+465518']],
    ['Abell24',     hms( 7,51,38), dms( 3, 0,27),     6, null, null,
      'Abell 24', 'Abell 24', ['LPN-Abell24', 'PN G217.1+14.7']],
    ['Abell28',     hms( 8,41,35), dms(58,14, 3),     4, null, null,  // maj updated to SIMBAD 4.47→4
      'Abell 28', 'Abell 28', ['LPN-Abell28', 'PN G158.8+37.1']],
    ['LPN-EGB1',        hms( 1, 7, 8), dms(73,33,24),     5, null, 'OIII and HD',
      'EGB 1', 'EGB 1', ['HDW 1', 'PN G124.0+10.7']],
    ['Abell45',     hms(18,30,17), dms(11,36,54,true), 5, null, null,
      'Abell 45', 'Abell 45', ['LPN-Abell45', 'PN G020.2-00.6']],
    ['LPN-Jones1',      hms(23,35,53), dms(30,28, 2),     5, null, 'mostly OIII',
      'Jones 1', 'Jones 1', ['PN G104.2-29.6']],
  ];

  let lpnAdded = 0;
  for (const [id, ra, dec, majAxis, minAxis, emissionLines, nameEn, nameFr, otherCatIds, mag = null] of lpnEntries) {
    if (dec < -35) continue; // southern cut-off
    const cats = [id, ...otherCatIds];
    data.push([
      id,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      'PN',
      majAxis,
      minAxis,
      0,
      mag,
      nameFr,
      nameEn,
      null,
      null,
      cats,
      emissionLines,
      null,
      null,
    ]);
    lpnAdded++;
  }
  console.log(`Added ${lpnAdded} standalone Large PN entries`);

  // ── Step 12: Abell Planetary Nebulae (Abell 1966) ─────────────────────────
  // Source: SIMBAD TAP query 'PN A66 %' (scripts/download-abell-pn.py).
  // 86 objects total. 14 already in DB are handled separately:
  //   - Abell 21 = SH2-274 (cross-ref 'Abell21' added in existingLPNUpdates above)
  //   - Abell 7,24,28,29,31,35,36,45,74 migrated from LPN in lpnEntries above
  //   - Abell 37=IC972, 50=NGC6742, 75=NGC7076, 81=IC1454 → add Abell{N} cross-ref
  // Remaining 72 are new standalone entries below.
  // All objects are dec > -35, so none excluded by southern cut-off.

  // PK, PN ARO, and PN G identifiers from SIMBAD for all 86 Abell PNe.
  // Generated by scripts/download-abell-crossrefs.py — applied to every entry
  // that already carries an Abell{N} catalog ID (standalone, LPN-migrated,
  // NGC/IC primary, or SH2-274). Abell 85 = CTB 1 SNR has no PN cross-refs.
  const ABELL_CROSSREFS = {
    'Abell1':  ['PK 119+06  1', 'PN ARO  198', 'PN G119.4+06.5'],
    'Abell2':  ['PK 122-04  1', 'PN ARO  202', 'PN G122.1-04.9'],
    'Abell3':  ['PK 131+02  1', 'PN ARO  204', 'PN G131.5+02.6'],
    'Abell4':  ['PK 144-15  1', 'PN ARO  205', 'PN G144.3-15.5'],
    'Abell5':  ['PK 141-07  1', 'PN ARO  206', 'PN G141.7-07.8'],
    'Abell6':  ['PK 136+04  1', 'PN ARO  207', 'PN G136.1+04.9'],
    'Abell7':  ['PK 215-30  1', 'PN ARO  215', 'PN G215.5-30.8'],
    'Abell8':  ['PK 167-00  1', 'PN ARO  216', 'PN G167.0-00.9'],
    'Abell9':  ['PK 172+00  1', 'PN ARO  122'],
    'Abell10': ['PK 197-14  1', 'PN ARO  176', 'PN G197.2-14.2'],
    'Abell11': ['PK 196-12  1', 'PN ARO  217'],
    'Abell12': ['PK 198-06  1', 'PN ARO  220', 'PN G198.6-06.3'],
    'Abell13': ['PK 204-08  1', 'PN ARO  124', 'PN G204.0-08.5'],
    'Abell14': ['PK 197-03  1', 'PN ARO  125', 'PN G197.8-03.3'],
    'Abell15': ['PK 233-16  1', 'PN ARO  221', 'PN G233.5-16.3'],
    'Abell16': ['PK 153+22  1', 'PN ARO  222', 'PN G153.7+22.8'],
    'Abell17': ['PK 221-04  1', 'PN ARO  223'],
    'Abell18': ['PK 216-00  1', 'PN ARO  224', 'PN G216.0-00.2'],
    'Abell19': ['PK 200+08  1', 'PN ARO  130', 'PN G200.7+08.4'],
    'Abell20': ['PK 214+07  1', 'PN ARO  132', 'PN G214.9+07.8'],
    'Abell21': ['PK 205+14  1', 'PN ARO  388', 'PN G205.1+14.2'],
    'Abell22': ['PK 215+11  1', 'PN ARO  133', 'PN G215.6+11.1'],
    'Abell23': ['PK 249-05  1', 'PN ARO  542', 'PN G249.3-05.4'],
    'Abell24': ['PK 217+14  1', 'PN ARO  134', 'PN G217.1+14.7'],
    'Abell25': ['PK 224+15', 'PK 224+15  1', 'PN ARO  246', 'PN G224.3+15.3'],
    'Abell26': ['PK 250+00  1', 'PN ARO  545', 'PN G250.3+00.1'],
    'Abell27': ['PK 252+04  1', 'PN G252.6+04.4'],
    'Abell28': ['PK 158+37', 'PK 158+37  1', 'PN G158.8+37.1'],
    'Abell29': ['PK 244+12  1', 'PN G244.5+12.5'],
    'Abell30': ['PK 208+33  1', 'PN G208.5+33.2'],
    'Abell31': ['PK 219+31', 'PK 219+31  1', 'PN ARO  135', 'PN G219.1+31.2'],
    'Abell32': ['PK 227+33  1', 'PN ARO  178'],
    'Abell33': ['PK 238+34  1', 'PN ARO   65', 'PN G238.0+34.8'],
    'Abell34': ['PK 248+29  1', 'PN G248.7+29.5'],
    'Abell35': ['PK 303+40  1', 'PN G303.6+40.0'],
    'Abell36': ['PK 318+41  1', 'PN G318.4+41.4'],
    'Abell37': ['PK 326+42  1', 'PN G326.6+42.2', 'PN G326.7+42.2'],
    'Abell38': ['PK 346+12  1', 'PN G346.9+12.4'],
    'Abell39': ['PK 047+42  1', 'PN ARO  180', 'PN G047.0+42.4'],
    'Abell40': ['PK 359+15  1', 'PN G359.1+15.1'],
    'Abell41': ['PK 009+10  1', 'PN G009.6+10.5'],
    'Abell42': ['PK 016+13  1', 'PN G016.0+13.5'],
    'Abell43': ['PK 036+17  1', 'PN ARO  181', 'PN G036.0+17.6'],
    'Abell44': ['PK 015-03  1', 'PN ARO  278', 'PN G015.6-03.0'],
    'Abell45': ['PK 020-00  1', 'PN G020.0-00.6', 'PN G020.2-00.6'],
    'Abell46': ['PK 055+16  1', 'PN ARO  119', 'PN G055.4+16.0'],
    'Abell47': ['PK 030+03  1', 'PN ARO  138', 'PN G030.8+03.4'],
    'Abell48': ['PK 029+00  1', 'PN G029.0+00.4'],
    'Abell49': ['PK 027-03  1', 'PN G027.3-03.4'],
    'Abell50': ['PK 078+18  1', 'PN G078.5+18.7'],
    'Abell51': ['PK 017-10  1', 'PN ARO  300', 'PN G017.6-10.2'],
    'Abell52': ['PK 050+05  1', 'PN ARO  144', 'PN G050.4+05.2'],
    'Abell53': ['PK 040-00  1', 'PN ARO  183', 'PN G040.3-00.4'],
    'Abell54': ['PK 055+06  1', 'PN ARO  184', 'PN G055.3+06.6'],
    'Abell55': ['PK 033-05  1', 'PN G033.0-05.3'],
    'Abell56': ['PK 037-03  2', 'PN ARO  146', 'PN G037.9-03.4'],
    'Abell57': ['PK 058+06  1', 'PN ARO  149', 'PN G058.6+06.1'],
    'Abell58': ['PK 037-05  1', 'PN ARO  150', 'PN G037.5-05.1'],
    'Abell59': ['PK 053+03  1', 'PN ARO   84', 'PN G053.3+03.0'],
    'Abell60': ['PK 025-11  1', 'PN ARO  314', 'PN G025.0-11.6'],
    'Abell61': ['PK 077+14', 'PK 077+14  1', 'PN G077.6+14.7'],
    'Abell62': ['PK 047-04  1', 'PN ARO  155', 'PN G047.1-04.2'],
    'Abell63': ['PK 053-03  1', 'PN ARO  161', 'PN G053.8-03.0'],
    'Abell64': ['PK 044-09  1', 'PN ARO  163'],
    'Abell65': ['PK 017-21  1', 'PN ARO   36', 'PN G017.3-21.9'],
    'Abell66': ['PK 019-23  1', 'PN ARO  339', 'PN G019.8-23.7'],
    'Abell67': ['PK 043-13  1', 'PN ARO  117', 'PN G043.5-13.4'],
    'Abell68': ['PK 060-04  1', 'PN ARO  166', 'PN G060.0-04.3'],
    'Abell69': ['PK 076+01  1', 'PN ARO   15', 'PN G076.3+01.1'],
    'Abell70': ['PK 038-25  1', 'PN ARO  351', 'PN G038.1-25.4'],
    'Abell71': ['PK 085+04  1', 'PN ARO  352', 'PN G084.9+04.4'],
    'Abell72': ['PK 059-18  1', 'PN ARO  173', 'PN G059.7-18.7'],
    'Abell73': ['PK 095+07  1', 'PN ARO  356', 'PN G095.2+07.8'],
    'Abell74': ['PK 072-17', 'PK 072-17  1', 'PN ARO  193', 'PN G072.7-17.1'],
    'Abell75': ['PK 101+08  1', 'PN ARO  359', 'PN G101.8+08.7'],
    'Abell76': ['PK 050-36  1', 'PN ARO  360'],
    'Abell77': ['PK 097+03  1', 'PN ARO  363', 'PN G097.5+03.1'],
    'Abell78': ['PK 081-14  1', 'PN ARO  174', 'PN G081.2-14.9'],
    'Abell79': ['PK 102-02  1', 'PN ARO  372', 'PN G102.9-02.3'],
    'Abell80': ['PK 102-05  1', 'PN ARO  375', 'PN G102.8-05.0'],
    'Abell81': ['PK 117+18  1', 'PN ARO  376', 'PN G117.5+18.9'],
    'Abell82': ['PK 114-04  1', 'PN ARO  114', 'PN G114.0-04.6'],
    'Abell83': ['PK 113-06  1', 'PN ARO  385', 'PN G113.6-06.9'],
    'Abell84': ['PK 112-10  1', 'PN ARO  115', 'PN G112.9-10.2'],
    'Abell85': [],  // CTB 1 SNR – no PN cross-refs in SIMBAD
    'Abell86': ['PK 118+08  2', 'PN ARO  245', 'PN G118.7+08.2'],
  };

  // Add Abell{N} cross-ref IDs to existing NGC/IC entries
  const abellNGCICRefs = [
    { id: 'IC972',   abellId: 'Abell37' },
    { id: 'NGC6742', abellId: 'Abell50' },
    { id: 'NGC7076', abellId: 'Abell75' },
    { id: 'IC1454',  abellId: 'Abell81' },
  ];
  for (const { id, abellId } of abellNGCICRefs) {
    const idx = dataIdxById.get(id);
    if (idx !== undefined) {
      const cats = data[idx][12];
      if (!cats.includes(abellId)) cats.push(abellId);
    } else {
      console.warn(`Abell cross-ref: ${id} not found in data`);
    }
  }

  // 72 standalone Abell entries (RA/Dec/size from SIMBAD; coords in J2000 degrees)
  // Format: [id, ra, dec, type, majAxis', minAxis', pa, mag, nameFr, nameEn, catalogs[], emissionLines]
  const abellEntries = [
    ['Abell1',  3.229,   69.173, 'PN', 0.78, null, 0, null, null, null, ['Abell1',  'PN G119.4+06.5'], null],
    ['Abell2',  11.394,  57.96,  'PN', 0.52, null, 0, null, null, null, ['Abell2',  'PN G122.1-04.9'], null],
    ['Abell3',  33.028,  64.151, 'PN', 1,    null, 0, null, null, null, ['Abell3',  'PN G131.5+02.6'], null],
    ['Abell4',  41.349,  42.551, 'PN', 0.33, null, 0, null, null, null, ['Abell4',  'PN G144.3-15.5'], null],
    ['Abell5',  43.063,  50.598, 'PN', 2.12, null, 0, null, null, null, ['Abell5',  'PN G141.7-07.8'], null],
    ['Abell6',  44.674,  64.502, 'PN', 3.1,  null, 0, null, null, null, ['Abell6',  'PN G136.1+04.9'], null],
    ['Abell8',  76.66,   39.136, 'PN', 1,    null, 0, null, null, null, ['Abell8',  'PN G167.0-00.9'], null],
    ['Abell9',  82.236,  36.051, 'PN', 0.62, null, 0, null, null, null, ['Abell9'                    ], null],
    ['Abell10', 82.94,    6.934, 'PN', 0.33, null, 0, null, null, null, ['Abell10', 'PN G197.2-14.2'], null],
    ['Abell11', 84.34,    8.258, '?',  0.32, null, 0, null, null, null, ['Abell11'                   ], null],  // SIMBAD otype: G (galaxy)
    ['Abell12', 90.584,   9.654, 'PN', 0.62, null, 0, null, null, null, ['Abell12', 'PN G198.6-06.3'], null],
    ['Abell13', 91.2,     3.943, 'PN', 2.54, null, 0, 19.9, null, null, ['Abell13', 'PN G204.0-08.5'], null],
    ['Abell14', 92.786,  11.779, 'PN', 0.55, null, 0, 15.2, null, null, ['Abell14', 'PN G197.8-03.3'], null],
    ['Abell15', 96.758,  -25.38, 'PN', 0.57, null, 0, 15.7, null, null, ['Abell15', 'PN G233.5-16.3'], null],
    ['Abell16', 100.981,  61.79, 'PN', 2.35, null, 0, 18.7, null, null, ['Abell16', 'PN G153.7+22.8'], null],
    ['Abell17', 102.158,  -9.544,'PN', 0.71, null, 0, null, null, null, ['Abell17'                   ], null],  // SIMBAD otype: PN? (uncertain)
    ['Abell18', 104.061,  -2.886,'PN', 1.22, null, 0, 20.9, null, null, ['Abell18', 'PN G216.0-00.2'], null],
    ['Abell19', 104.985,  14.609,'PN', 1.12, null, 0, null, null, null, ['Abell19', 'PN G200.7+08.4'], null],
    ['Abell20', 110.74,   1.759, 'PN', 1.12, null, 0, 16.5, null, null, ['Abell20', 'PN G214.9+07.8'], null],
    ['Abell22', 114.033,  2.708, 'PN', 1.4,  null, 0, 19.6, null, null, ['Abell22', 'PN G215.6+11.1'], null],
    ['Abell23', 115.825, -34.754,'PN', 0.9,  null, 0, null, null, null, ['Abell23', 'PN G249.3-05.4'], null],
    ['Abell25', 121.694,  -2.876,'PN', 2.77, null, 0, 18.4, null, null, ['Abell25', 'PN G224.3+15.3'], null],
    ['Abell26', 122.257, -32.674,'PN', 0.67, null, 0, 11.6, null, null, ['Abell26', 'PN G250.3+00.1'], null],
    ['Abell27', 127.969, -32.102,'PN', 0.72, null, 0, null, null, null, ['Abell27', 'PN G252.6+04.4'], null],
    ['Abell30', 131.723,  17.88, 'PN', 0.29, null, 0, 14.3, null, null, ['Abell30', 'PN G208.5+33.2'], null],
    ['Abell32', 139.103,  3.891, '?',  2.23, null, 0, null, null, null, ['Abell32'                   ], null],  // SIMBAD otype: ? (unknown)
    ['Abell33', 144.788,  -2.808,'PN', 4.47, null, 0, null, null, null, ['Abell33', 'PN G238.0+34.8'], null],
    ['Abell34', 146.397, -13.171,'PN', 4.83, null, 0, 16.3, null, null, ['Abell34', 'PN G248.7+29.5'], null],
    ['Abell38', 245.829, -31.75, 'PN', 1.53, null, 0, 20,   null, null, ['Abell38', 'PN G346.9+12.4'], null],
    ['Abell39', 246.89,   27.909,'PN', 2.9,  null, 0, 15.6, null, null, ['Abell39', 'PN G047.0+42.4'], null],
    ['Abell40', 252.144, -21.014,'PN', 0.57, null, 0, null, null, null, ['Abell40', 'PN G359.1+15.1'], null],
    ['Abell41', 262.258, -15.218,'PN', 0.31, null, 0, 15.9, null, null, ['Abell41', 'PN G009.6+10.5'], null],
    ['Abell42', 262.871,  -8.319,'PN', null, null, 0, 20.2, null, null, ['Abell42', 'PN G016.0+13.5'], null],
    ['Abell43', 268.384,  10.623,'PN', 1.33, null, 0, 14.7, null, null, ['Abell43', 'PN G036.0+17.6'], null],
    ['Abell44', 277.547, -16.757,'PN', 0.1,  null, 0, null, null, null, ['Abell44', 'PN G015.6-03.0'], null],
    ['Abell46', 277.827,  26.937,'PN', 1.06, null, 0, null, null, null, ['Abell46', 'PN G055.4+16.0'], null],
    ['Abell47', 278.844,  -0.231,'PN', null, null, 0, null, null, null, ['Abell47', 'PN G030.8+03.4'], null],
    ['Abell48', 280.696,  -3.221,'PN', 0.7,  null, 0, null, null, null, ['Abell48', 'PN G029.0+00.4'], null],
    ['Abell49', 283.368,  -6.48, 'PN', null, null, 0, null, null, null, ['Abell49', 'PN G027.3-03.4'], null],
    ['Abell51', 285.256, -18.204,'PN', 1.12, null, 0, 15.4, null, null, ['Abell51', 'PN G017.6-10.2'], null],
    ['Abell52', 286.135,  17.952,'PN', null, null, 0, null, null, null, ['Abell52', 'PN G050.4+05.2'], null],
    ['Abell53', 286.691,  6.398, 'PN', 0.52, null, 0, null, null, null, ['Abell53', 'PN G040.3-00.4'], null],
    ['Abell54', 287.165,  22.983,'PN', 0.93, null, 0, null, null, null, ['Abell54', 'PN G055.3+06.6'], null],
    ['Abell55', 287.607,  -2.34, 'PN', 0.8,  null, 0, null, null, null, ['Abell55', 'PN G033.0-05.3'], null],
    ['Abell56', 288.275,  2.88,  'PN', null, null, 0, null, null, null, ['Abell56', 'PN G037.9-03.4'], null],
    ['Abell57', 289.274,  25.626,'PN', null, null, 0, 17.7, null, null, ['Abell57', 'PN G058.6+06.1'], null],
    ['Abell58', 289.585,  1.783, 'PN', null, null, 0, null, null, null, ['Abell58', 'PN G037.5-05.1'], null],
    ['Abell59', 289.667,  19.576,'PN', 1.43, null, 0, null, null, null, ['Abell59', 'PN G053.3+03.0'], null],
    ['Abell60', 289.824, -12.243,'PN', 1.23, null, 0, null, null, null, ['Abell60', 'PN G025.0-11.6'], null],
    ['Abell61', 289.793,  46.248,'PN', null, null, 0, null, null, null, ['Abell61', 'PN G077.6+14.7'], null],
    ['Abell62', 293.325,  10.617,'PN', 2.68, null, 0, null, null, null, ['Abell62', 'PN G047.1-04.2'], null],
    ['Abell63', 295.543,  17.087,'PN', null, null, 0, null, null, null, ['Abell63', 'PN G053.8-03.0'], null],
    ['Abell64', 296.395,  5.564, '?',  0.58, null, 0, null, null, null, ['Abell64'                   ], null],  // SIMBAD otype: AG? (AGN candidate)
    ['Abell65', 296.643, -23.137,'PN', 1.8,  null, 0, 15.8, null, null, ['Abell65', 'PN G017.3-21.9'], null],
    ['Abell66', 299.381, -21.613,'PN', 4.45, null, 0, 17.4, null, null, ['Abell66', 'PN G019.8-23.7'], null],
    ['Abell67', 299.613,  3.05,  'PN', 1.12, null, 0, null, null, null, ['Abell67', 'PN G043.5-13.4'], null],
    ['Abell68', 300.044,  21.716,'PN', null, null, 0, null, null, null, ['Abell68', 'PN G060.0-04.3'], null],
    ['Abell69', 304.993,  38.401,'PN', 0.37, null, 0, null, null, null, ['Abell69', 'PN G076.3+01.1'], null],
    ['Abell70', 307.888,  -7.088,'PN', 0.7,  null, 0, null, null, null, ['Abell70', 'PN G038.1-25.4'], null],
    ['Abell71', 308.097,  47.347,'PN', 2.63, null, 0, 19.3, null, null, ['Abell71', 'PN G084.9+04.4'], null],
    ['Abell72', 312.509,  13.558,'PN', 2.12, null, 0, 16.1, null, null, ['Abell72', 'PN G059.7-18.7'], null],
    ['Abell73', 314.113,  57.434,'PN', 1.22, null, 0, null, null, null, ['Abell73', 'PN G095.2+07.8'], null],
    ['Abell76', 322.516,  -2.808,'?',  null, null, 0, null, null, null, ['Abell76'                   ], null],  // SIMBAD otype: EmG (emission galaxy)
    ['Abell77', 323.041,  55.881,'EN', 1.21, null, 0, null, null, null, ['Abell77', 'PN G097.5+03.1'], null],  // SIMBAD otype: HII
    ['Abell78', 323.872,  31.696,'PN', 1.78, null, 0, 13.2, null, null, ['Abell78', 'PN G081.2-14.9'], null],
    ['Abell79', 336.572,  54.827,'PN', 0.9,  null, 0, 17.0, null, null, ['Abell79', 'PN G102.9-02.3'], null],
    ['Abell80', 338.69,   52.435,'PN', 1.83, null, 0, null, null, null, ['Abell80', 'PN G102.8-05.0'], null],
    ['Abell82', 356.449,  57.066,'PN', 1.35, null, 0, null, null, null, ['Abell82', 'PN G114.0-04.6'], null],
    ['Abell83', 356.695,  54.744,'PN', 0.78, null, 0, null, null, null, ['Abell83', 'PN G113.6-06.9'], null],
    ['Abell84', 356.934,  51.399,'PN', 1.58, null, 0, 18.6, null, null, ['Abell84', 'PN G112.9-10.2'], null],
    ['Abell85', 359.804,  62.437,'SNR',34,   null, 0, null, null, null, ['Abell85'                   ], null],  // CTB 1, SNR (not a true PN)
    ['Abell86', 0.379,    70.708,'PN', 1.05, null, 0, null, null, null, ['Abell86', 'PN G118.7+08.2'], null],
  ];

  let abellAdded = 0;
  for (const [id, ra, dec, type, majAxis, minAxis, pa, mag, nameFr, nameEn, catalogs, emissionLines] of abellEntries) {
    if (dec < -35) continue; // southern cut-off (none excluded for this catalog)
    data.push([id, ra, dec, type, majAxis, minAxis, pa, mag, nameFr, nameEn, null, null, catalogs, emissionLines, null, null, null]);
    abellAdded++;
  }
  console.log(`Added ${abellAdded} standalone Abell PN entries`);

  // ── Apply PK / PN ARO / PN G cross-refs to every Abell-bearing entry ─────
  // Covers: standalone entries above, LPN-migrated entries (Step 9 lpnEntries),
  // NGC/IC primaries (abellNGCICRefs above), and SH2-274 = Abell 21.
  let abellXrefCount = 0;
  for (const row of data) {
    const cats = row[12];
    if (!cats) continue;
    for (const cat of [...cats]) {
      const xrefs = ABELL_CROSSREFS[cat];
      if (!xrefs) continue;
      for (const xref of xrefs) {
        if (!cats.includes(xref)) {
          cats.push(xref);
          abellXrefCount++;
        }
      }
    }
  }
  console.log(`Added ${abellXrefCount} PK/ARO/PNG cross-ref IDs to Abell entries`);

  // ── Step 11: Messier-only objects (no NGC/IC designation) ───────────────────
  // Messier objects that don't appear in OpenNGC because they have no NGC/IC number.
  // Names come from dso-metadata-overrides.json via applyMetadataOverrides.
  // [id, ra, dec, type, majAxis', minAxis', pa, mag, cats[]]
  const messierOnlyEntries = [
    // M45 Pleiades (Mel 22 / OCl 421). SIMBAD coords: RA 03h 47m 24s, Dec +24° 07' 00"
    ['M45', hms(3, 47, 24), dms(24, 7, 0), 'OC', 110, null, 0, 1.6, ['M45']],
  ];
  for (const [id, ra, dec, type, majAxis, minAxis, pa, mag, cats] of messierOnlyEntries) {
    data.push([
      id,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      type,
      majAxis,
      minAxis,
      pa,
      mag,
      null, null, null, null,
      cats,
      null, null, null, null,
    ]);
  }
  console.log(`Added ${messierOnlyEntries.length} Messier-only entries`);

  // ── Curated SH2 → NGC/IC/Abell merges ────────────────────────────────────
  // Fold each duplicate SH2 row into its NGC/IC/Abell parent (append designations
  // to the target's catalogs[]) and drop the standalone SH2 row, so the region is a
  // single object. Runs after all sources (incl. Abell PNe, Step 12) are in `data`.
  const rowByIdSh2 = new Map(data.map(r => [String(r[0]).toUpperCase(), r]));
  const sh2Suppress = new Set();
  let sh2Merged = 0;
  for (const [shId, targetId] of Object.entries(SH2_ALIASES)) {
    const target = rowByIdSh2.get(String(targetId).toUpperCase());
    if (!target) { console.warn(`Warning: SH2 alias target ${targetId} not found for ${shId}`); continue; }
    const sh2row = rowByIdSh2.get(shId.toUpperCase());
    const carried = sh2row ? sh2row[12] : [shId];
    for (const c of carried) {
      if (c && !target[12].some(x => String(x).toLowerCase() === String(c).toLowerCase())) target[12].push(c);
    }
    sh2Suppress.add(shId.toUpperCase());
    sh2Merged++;
  }
  for (let i = data.length - 1; i >= 0; i--) {
    if (sh2Suppress.has(String(data[i][0]).toUpperCase())) data.splice(i, 1);
  }
  console.log(`Merged ${sh2Merged} SH2 aliases into existing objects`);

  const metadataOverrides = loadMetadataOverrides();
  if (metadataOverrides.size > 0) {
    for (const row of data) {
      applyMetadataOverrides(row, metadataOverrides);
    }
    console.log(`Applied names/constellation/rating/difficulty metadata overrides to ${metadataOverrides.size} objects`);
  }

  // ── Sort by magnitude (brightest first, nulls last) ───────────────────────
  data.sort((a, b) => {
    const ma = a[7];
    const mb = b[7];
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return ma - mb;
  });

  const total = data.length;
  console.log(`Generated ${total} DSOs total (skipped ${skipped} OpenNGC rows)`);

  const output = {
    fields: ['id', 'ra', 'dec', 'type', 'majAxis', 'minAxis', 'pa', 'mag', 'nameFr', 'nameEn', 'nameEs', 'nameDe', 'catalogs', 'emissionLines', 'constellation', 'rating', 'difficulty'],
    data,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output));
  console.log(`Written to ${OUT_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });

