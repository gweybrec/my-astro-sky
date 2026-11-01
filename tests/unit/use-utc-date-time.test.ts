import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useUtcDateTime } from '../../src/composables/useUtcDateTime';

describe('useUtcDateTime', () => {
  it('splits the ISO into UTC date and time, and writes each back', () => {
    const iso = ref('2025-11-07T18:42:00.000Z');
    const { dateStr, timeStr } = useUtcDateTime(iso);
    expect([dateStr.value, timeStr.value]).toEqual(['2025-11-07', '18:42']);
    timeStr.value = '21:05';
    expect(iso.value).toBe('2025-11-07T21:05:00.000Z');
    dateStr.value = '2025-11-08';
    expect(iso.value).toBe('2025-11-08T21:05:00.000Z');
  });

  it('keeps a time typed before the date and combines it with the date typed next', () => {
    const iso = ref('');
    const { dateStr, timeStr } = useUtcDateTime(iso);
    timeStr.value = '18:42';
    expect(iso.value).toBe('');
    expect(timeStr.value).toBe('18:42');
    dateStr.value = '2025-11-07';
    expect(iso.value).toBe('2025-11-07T18:42:00.000Z');
  });

  it('keeps the time when the date is cleared and set again', () => {
    const iso = ref('2025-11-07T18:42:00.000Z');
    const { dateStr, timeStr } = useUtcDateTime(iso);
    dateStr.value = '';
    expect(iso.value).toBe('');
    expect(timeStr.value).toBe('18:42');
    dateStr.value = '2025-11-09';
    expect(iso.value).toBe('2025-11-09T18:42:00.000Z');
  });

  it('uses midnight when no time was ever given', () => {
    const iso = ref('');
    const { dateStr } = useUtcDateTime(iso);
    dateStr.value = '2025-11-07';
    expect(iso.value).toBe('2025-11-07T00:00:00.000Z');
  });
});
