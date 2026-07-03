import { describe, it, expect } from 'vitest';
import { msg } from '../../server/messages';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Assert that a message differs between FR and EN (the switch actually fires). */
function assertBilingual(fr: string, en: string) {
  expect(typeof fr).toBe('string');
  expect(typeof en).toBe('string');
  expect(fr.length).toBeGreaterThan(0);
  expect(en.length).toBeGreaterThan(0);
  expect(fr).not.toBe(en);
}

// ─── msg.solveField ───────────────────────────────────────────────────────────

describe('msg.solveField', () => {
  it('notFound — is bilingual and includes the bin path', () => {
    const bin = '/usr/bin/solve-field';
    assertBilingual(msg.solveField.notFound('fr', bin), msg.solveField.notFound('en', bin));
    expect(msg.solveField.notFound('en', bin)).toContain(bin);
    expect(msg.solveField.notFound('fr', bin)).toContain(bin);
  });

  it('noIndexFiles — is bilingual', () => {
    assertBilingual(msg.solveField.noIndexFiles('fr'), msg.solveField.noIndexFiles('en'));
  });

  it('noPyfits — is bilingual', () => {
    assertBilingual(msg.solveField.noPyfits('fr'), msg.solveField.noPyfits('en'));
  });

  it('noSolution — is bilingual and includes field/match counts', () => {
    assertBilingual(msg.solveField.noSolution('fr', 7, 3), msg.solveField.noSolution('en', 7, 3));
    expect(msg.solveField.noSolution('en', 7, 3)).toContain('7');
    expect(msg.solveField.noSolution('en', 7, 3)).toContain('3');
  });

  it('noSolutionCauses — is bilingual', () => {
    assertBilingual(msg.solveField.noSolutionCauses('fr'), msg.solveField.noSolutionCauses('en'));
  });

  it('noSolutionHintNone — is bilingual', () => {
    assertBilingual(
      msg.solveField.noSolutionHintNone('fr'),
      msg.solveField.noSolutionHintNone('en'),
    );
  });

  it('noSolutionHintNoFov — is bilingual', () => {
    assertBilingual(
      msg.solveField.noSolutionHintNoFov('fr'),
      msg.solveField.noSolutionHintNoFov('en'),
    );
  });

  it('noSolutionHintFull — is bilingual', () => {
    assertBilingual(
      msg.solveField.noSolutionHintFull('fr'),
      msg.solveField.noSolutionHintFull('en'),
    );
  });

  it('failed — is bilingual and includes field count', () => {
    assertBilingual(msg.solveField.failed('fr', 12), msg.solveField.failed('en', 12));
    expect(msg.solveField.failed('en', 12)).toContain('12');
  });

  it('noWcsFile — is bilingual', () => {
    assertBilingual(msg.solveField.noWcsFile('fr'), msg.solveField.noWcsFile('en'));
  });

  it('notEnoughStars — is bilingual and includes star count', () => {
    assertBilingual(msg.solveField.notEnoughStars('fr', 2), msg.solveField.notEnoughStars('en', 2));
    expect(msg.solveField.notEnoughStars('en', 2)).toContain('2');
  });

  it('missingWcsKey — is bilingual and contains the key name', () => {
    const key = 'CD1_1';
    assertBilingual(
      msg.solveField.missingWcsKey('fr', key),
      msg.solveField.missingWcsKey('en', key),
    );
    expect(msg.solveField.missingWcsKey('fr', key)).toContain(key);
    expect(msg.solveField.missingWcsKey('en', key)).toContain(key);
    expect(msg.solveField.missingWcsKey('fr', key).toLowerCase()).toContain('manquante');
    expect(msg.solveField.missingWcsKey('en', key).toLowerCase()).toContain('missing');
  });
});

// ─── msg.astap ────────────────────────────────────────────────────────────────

describe('msg.astap', () => {
  it('timeout — returns a non-empty string', () => {
    expect(msg.astap.timeout().length).toBeGreaterThan(0);
  });

  it('noDatabase — is bilingual and includes the directory', () => {
    const dir = '/opt/astap';
    assertBilingual(msg.astap.noDatabase('fr', dir), msg.astap.noDatabase('en', dir));
    expect(msg.astap.noDatabase('en', dir)).toContain(dir);
    expect(msg.astap.noDatabase('fr', dir)).toContain(dir);
  });

  it('noSolution — is bilingual and includes star/quad counts', () => {
    assertBilingual(msg.astap.noSolution('fr', 50, 10), msg.astap.noSolution('en', 50, 10));
    expect(msg.astap.noSolution('en', 50, 10)).toContain('50');
    expect(msg.astap.noSolution('en', 50, 10)).toContain('10');
  });

  it('noSolutionFov — is bilingual and includes FOV value', () => {
    assertBilingual(msg.astap.noSolutionFov('fr', '2.5'), msg.astap.noSolutionFov('en', '2.5'));
    expect(msg.astap.noSolutionFov('en', '2.5')).toContain('2.5');
  });

  it('noSolutionCauses — is bilingual', () => {
    assertBilingual(msg.astap.noSolutionCauses('fr'), msg.astap.noSolutionCauses('en'));
  });

  it('noSolutionHintNone — is bilingual', () => {
    assertBilingual(msg.astap.noSolutionHintNone('fr'), msg.astap.noSolutionHintNone('en'));
  });

  it('noSolutionHintGiven — is bilingual', () => {
    assertBilingual(msg.astap.noSolutionHintGiven('fr'), msg.astap.noSolutionHintGiven('en'));
  });

  it('failed — is bilingual and includes star count', () => {
    assertBilingual(msg.astap.failed('fr', 8), msg.astap.failed('en', 8));
    expect(msg.astap.failed('en', 8)).toContain('8');
  });

  it('noWcsFile — is bilingual', () => {
    assertBilingual(msg.astap.noWcsFile('fr'), msg.astap.noWcsFile('en'));
  });

  it('missingWcsKey — is bilingual and contains the key name', () => {
    const key = 'CRPIX1';
    assertBilingual(msg.astap.missingWcsKey('fr', key), msg.astap.missingWcsKey('en', key));
    expect(msg.astap.missingWcsKey('fr', key)).toContain(key);
    expect(msg.astap.missingWcsKey('en', key)).toContain(key);
    expect(msg.astap.missingWcsKey('fr', key).toLowerCase()).toContain('manquante');
    expect(msg.astap.missingWcsKey('en', key).toLowerCase()).toContain('missing');
  });

  it('badSolution — is bilingual and contains the distance value', () => {
    const dist = '7.2';
    assertBilingual(msg.astap.badSolution('fr', dist), msg.astap.badSolution('en', dist));
    expect(msg.astap.badSolution('fr', dist)).toContain(dist);
    expect(msg.astap.badSolution('en', dist)).toContain(dist);
  });

  it('notEnoughCatalogStars — is bilingual', () => {
    assertBilingual(msg.astap.notEnoughCatalogStars('fr'), msg.astap.notEnoughCatalogStars('en'));
    expect(msg.astap.notEnoughCatalogStars('fr')).toMatch(/étoiles|catalogue/i);
    expect(msg.astap.notEnoughCatalogStars('en').toLowerCase()).toMatch(/catalog|stars/);
  });
});

// ─── msg.api ──────────────────────────────────────────────────────────────────

describe('msg.api', () => {
  it('missingFile — is bilingual', () => {
    assertBilingual(msg.api.missingFile('fr'), msg.api.missingFile('en'));
  });

  it('noFile — is bilingual', () => {
    assertBilingual(msg.api.noFile('fr'), msg.api.noFile('en'));
  });

  it('unsupportedWcsFormat — is bilingual', () => {
    assertBilingual(msg.api.unsupportedWcsFormat('fr'), msg.api.unsupportedWcsFormat('en'));
  });

  it('noWcsData — is bilingual', () => {
    assertBilingual(msg.api.noWcsData('fr'), msg.api.noWcsData('en'));
  });

  it('noImageDimensions — is bilingual', () => {
    assertBilingual(msg.api.noImageDimensions('fr'), msg.api.noImageDimensions('en'));
  });

  it('cannotDetermineImageDimensions — is bilingual', () => {
    assertBilingual(
      msg.api.cannotDetermineImageDimensions('fr'),
      msg.api.cannotDetermineImageDimensions('en'),
    );
  });

  it('notEnoughCatalogStars — is bilingual', () => {
    assertBilingual(msg.api.notEnoughCatalogStars('fr'), msg.api.notEnoughCatalogStars('en'));
  });

  it('solveCanceled — is bilingual', () => {
    assertBilingual(msg.api.solveCanceled('fr'), msg.api.solveCanceled('en'));
  });

  it('unsupportedFormatAstap — is bilingual and includes extension', () => {
    const ext = '.tiff';
    assertBilingual(
      msg.api.unsupportedFormatAstap('fr', ext),
      msg.api.unsupportedFormatAstap('en', ext),
    );
    expect(msg.api.unsupportedFormatAstap('en', ext)).toContain(ext);
  });

  it('unsupportedFormatSolveField — is bilingual and includes extension', () => {
    const ext = '.fit';
    assertBilingual(
      msg.api.unsupportedFormatSolveField('fr', ext),
      msg.api.unsupportedFormatSolveField('en', ext),
    );
    expect(msg.api.unsupportedFormatSolveField('en', ext)).toContain(ext);
  });

  it('astapError — is bilingual and includes error text', () => {
    const detail = 'segfault';
    assertBilingual(msg.api.astapError('fr', detail), msg.api.astapError('en', detail));
    expect(msg.api.astapError('en', detail)).toContain(detail);
  });

  it('solveFieldError — is bilingual and includes error text', () => {
    const detail = 'timeout';
    assertBilingual(msg.api.solveFieldError('fr', detail), msg.api.solveFieldError('en', detail));
    expect(msg.api.solveFieldError('en', detail)).toContain(detail);
  });
});
