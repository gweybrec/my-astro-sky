import { describe, expect, it } from 'vitest';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';

describe('sortDsoIdsByImportance', () => {
  it('puts Messier first, then NGC, IC and the other catalogues in their order', () => {
    expect(
      sortDsoIdsByImportance([
        'LBN270',
        'IC434',
        'Barnard 33',
        'SH2-112',
        'NGC2023',
        'M42',
        'XYZ1',
      ]),
    ).toEqual(['M42', 'NGC2023', 'IC434', 'SH2-112', 'LBN270', 'Barnard 33', 'XYZ1']);
  });

  it('orders by number within a catalogue', () => {
    expect(sortDsoIdsByImportance(['M101', 'M42', 'M1', 'NGC7000', 'NGC224'])).toEqual([
      'M1',
      'M42',
      'M101',
      'NGC224',
      'NGC7000',
    ]);
  });

  it('leaves the list it was given unchanged', () => {
    const ids = ['NGC1', 'M1'];
    sortDsoIdsByImportance(ids);
    expect(ids).toEqual(['NGC1', 'M1']);
  });
});
