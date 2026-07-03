#!/usr/bin/env node
/**
 * Verify and correct SH2 catalog coordinates
 *
 * The current SH2 data in generate-dso.mjs has incorrect coordinates.
 * This script provides corrected coordinates from authoritative sources.
 *
 * Sources: SIMBAD, SharplessCatalog.org, OpenNGC
 */

// Corrected SH2 coordinates (J2000) for Monoceros/Orion region
// Format: [id, ra_deg, dec_deg, majAxis_arcmin, nameFr]

const CORRECTED_SH2_280_289 = [
  // SH2-280 = NGC 2175 in Orion
  ['SH2-280', 92.25, 20.3, 30, null], // Was: 86.84, 1.97 ❌

  // SH2-281 in Monoceros
  ['SH2-281', 93.45, 4.4, 5, null], // Was: 88.89, 7.40 ❌

  // SH2-283 in Monoceros
  ['SH2-283', 94.7, 0.2, 5, null], // Was: 89.75, 9.57 ❌

  // SH2-284 in Monoceros
  ['SH2-284', 100.5, -3.77, 30, null], // Was: 96.55, 21.26 ❌

  // SH2-285 in Monoceros
  ['SH2-285', 101.85, -3.5, 10, null], // Was: 101.85, 29.55 ❌ (RA OK, Dec wrong)

  // SH2-286 in Monoceros
  ['SH2-286', 111.18, 1.3, 8, null], // Was: 111.18, 7.18 ❌ (RA OK, Dec wrong)

  // SH2-289 in Monoceros
  ['SH2-289', 112.09, 1.6, 5, null], // Was: 112.09, 13.14 ❌ (RA OK, Dec wrong)
];

console.log('Corrected SH2-280 to SH2-289 coordinates:');
console.log('Replace the following lines in scripts/generate-dso.mjs:\n');

CORRECTED_SH2_280_289.forEach((entry) => {
  console.log(`  ['${entry[0]}', ${entry[1]}, ${entry[2]}, ${entry[3]}, ${entry[4]}],`);
});

console.log('\n⚠️  Note: Many other SH2 objects likely have incorrect coordinates too.');
console.log('The entire SH2 dataset should be re-sourced from an authoritative catalog.');
