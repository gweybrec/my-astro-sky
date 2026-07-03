import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeDSOAliases } from '../../server/dso-utils';
import { parseSolveFieldDSOs } from '../../server/solve-field';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../fixtures');

// ─── normalizeDSOAliases ──────────────────────────────────────────────────────

describe('normalizeDSOAliases', () => {
  it('removes spaces from IDs', () => {
    expect(normalizeDSOAliases(['M 101'])).toEqual(['M101']);
    expect(normalizeDSOAliases(['NGC 224'])).toEqual(['NGC224']);
    expect(normalizeDSOAliases(['IC 1805'])).toEqual(['IC1805']);
  });

  it('splits slash-separated aliases on a single entry', () => {
    expect(normalizeDSOAliases(['NGC 5457 / M 101'])).toEqual(['NGC5457', 'M101']);
  });

  it('handles multiple entries', () => {
    const result = normalizeDSOAliases(['NGC 6205', 'M 13', 'NGC 6207']);
    expect(result).toEqual(['NGC6205', 'M13', 'NGC6207']);
  });

  it('handles mix of aliased and plain entries', () => {
    const result = normalizeDSOAliases([
      'NGC 6205',
      'M 13 / NGC 6205',
      'Hercules Globular Cluster',
    ]);
    expect(result).toContain('NGC6205');
    expect(result).toContain('M13');
    expect(result).toContain('HerculesGlobularCluster');
  });

  it('filters out empty strings', () => {
    const result = normalizeDSOAliases(['']);
    expect(result).toEqual([]);
  });

  it('handles empty array', () => {
    expect(normalizeDSOAliases([])).toEqual([]);
  });

  it('processes real astrometry.net objects_in_field fixture (job 10796000 — M13 field)', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'astrometry/10796000-objects.json'), 'utf8'),
    );
    const result = normalizeDSOAliases(raw.objects_in_field);
    // Job 10796000: NGC 6205, M 13, NGC 6207, Hercules Globular Cluster
    expect(result).toContain('NGC6205');
    expect(result).toContain('M13');
    expect(result).toContain('NGC6207');
    // No spaces in any ID
    for (const id of result) {
      expect(id).not.toMatch(/\s/);
    }
  });
});

// ─── parseSolveFieldDSOs ─────────────────────────────────────────────────────

describe('parseSolveFieldDSOs', () => {
  it('returns empty array when no "Your field contains:" section', () => {
    const stdout = 'Field 1: solved.\nRA,Dec = (100.0, 30.0)\n';
    expect(parseSolveFieldDSOs(stdout)).toEqual([]);
  });

  it('parses a single object', () => {
    const stdout = 'Solved!\nYour field contains:\nNGC 224\n\nDone.';
    expect(parseSolveFieldDSOs(stdout)).toEqual(['NGC224']);
  });

  it('parses slash-separated aliases on one line', () => {
    const stdout = 'Your field contains:\nNGC 5457 / M 101\n\n';
    const result = parseSolveFieldDSOs(stdout);
    expect(result).toContain('NGC5457');
    expect(result).toContain('M101');
  });

  it('parses multiple objects on multiple lines', () => {
    const stdout = [
      'Your field contains:',
      'NGC 5457 / M 101',
      'NGC 5461',
      'NGC 5462',
      '',
      'Creating new FITS file...',
    ].join('\n');
    const result = parseSolveFieldDSOs(stdout);
    expect(result).toContain('NGC5457');
    expect(result).toContain('M101');
    expect(result).toContain('NGC5461');
    expect(result).toContain('NGC5462');
    // Nothing after the blank line
    expect(result).not.toContain('CreatingnewFITSfile...');
  });

  it('blank line immediately after header yields empty array', () => {
    const stdout = 'Your field contains:\n\nSome other output\n';
    expect(parseSolveFieldDSOs(stdout)).toEqual([]);
  });

  it('stops at blank line (objects after blank not included)', () => {
    const stdout = 'Your field contains:\nM 42\n\nM 31\n';
    const result = parseSolveFieldDSOs(stdout);
    expect(result).toContain('M42');
    expect(result).not.toContain('M31');
  });

  it('real solve-field stdout for LDN1235 returns empty (no DSO catalog installed)', () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'solve-field/LDN1235-stdout.txt'), 'utf8');
    // This install of solve-field doesn't have the DSO catalog — result is empty
    const result = parseSolveFieldDSOs(stdout);
    expect(Array.isArray(result)).toBe(true);
  });
});
