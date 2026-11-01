import { computed, ref, type Ref } from 'vue';
import { isoToUtcParts, utcPartsToIso } from '@myastrosky/core/asteroid-identify';

/**
 * A UTC date input and a UTC time input as a view onto one ISO string (the
 * identification modals' observation and start/end times). The ISO stays ''
 * while there is no date, so a time typed first is held as a draft and used
 * when the date arrives, instead of being dropped for midnight.
 */
export function useUtcDateTime(iso: Ref<string>) {
  const timeDraft = ref(isoToUtcParts(iso.value).time);

  const timeStr = computed({
    get: () => (iso.value ? isoToUtcParts(iso.value).time : timeDraft.value),
    set: (v: string) => {
      timeDraft.value = v;
      const date = isoToUtcParts(iso.value).date;
      if (date) iso.value = utcPartsToIso(date, v);
    },
  });
  const dateStr = computed({
    get: () => isoToUtcParts(iso.value).date,
    set: (v: string) => {
      const time = timeStr.value;
      timeDraft.value = time;
      iso.value = utcPartsToIso(v, time);
    },
  });

  return { dateStr, timeStr };
}
