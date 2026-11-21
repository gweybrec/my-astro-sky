<template>
  <div
    ref="root"
    class="sheet-pop top-full mt-1 w-[260px] gap-4 p-5"
    :class="align === 'left' ? 'left-0' : 'right-0'"
    role="dialog"
    :aria-label="t('gallery.sheet.chooseDate')"
    data-test="date-picker"
  >
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="sheet-icon-btn !text-secondary"
        :title="t('gallery.sheet.prevMonth')"
        :aria-label="t('gallery.sheet.prevMonth')"
        data-test="prev-month"
        @click="shiftMonth(-1)"
        v-html="chevronLeftSvg"
      ></button>
      <b class="flex-1 text-center font-medium text-bright" data-test="month-title">{{
        monthTitle
      }}</b>
      <button
        type="button"
        class="sheet-icon-btn !text-secondary"
        :title="t('gallery.sheet.nextMonth')"
        :aria-label="t('gallery.sheet.nextMonth')"
        data-test="next-month"
        @click="shiftMonth(1)"
        v-html="chevronRightSvg"
      ></button>
    </div>

    <div class="grid grid-cols-7 gap-[2px] text-center text-base">
      <span v-for="name in weekdayNames" :key="name" class="leading-[26px] text-small text-label">{{
        name
      }}</span>
      <template v-for="(week, w) in weeks" :key="w">
        <button
          v-for="cell in week"
          :key="`${cell.year}-${cell.month}-${cell.day}`"
          type="button"
          class="h-[26px] p-0 rounded-sm border cursor-pointer text-base"
          :class="
            isSelected(cell)
              ? 'bg-[var(--accent-bg)] border-[var(--accent-border)] text-bright'
              : [
                  'bg-transparent border-transparent hover:bg-[var(--bg-hover)]',
                  cell.inMonth ? 'text-secondary' : 'text-muted',
                ]
          "
          :aria-pressed="isSelected(cell)"
          data-test="day"
          @click="pick(cell)"
        >
          {{ cell.day }}
        </button>
      </template>
    </div>

    <div
      v-if="!dateOnly"
      class="flex items-center gap-3 pt-4 border-t border-[var(--border-subtle)]"
    >
      <span class="flex-1 text-base text-label">{{ t('gallery.sheet.hour') }}</span>
      <select
        v-model.number="hour"
        class="sheet-input !w-auto !px-2 !border-[var(--border-input)]"
        :aria-label="t('gallery.sheet.hour')"
        data-test="hour"
      >
        <option v-for="h in 24" :key="h" :value="h - 1">{{ pad(h - 1) }}</option>
      </select>
      <span class="text-dim">:</span>
      <select
        v-model.number="minute"
        class="sheet-input !w-auto !px-2 !border-[var(--border-input)]"
        data-test="minute"
      >
        <option v-for="m in 60" :key="m" :value="m - 1">{{ pad(m - 1) }}</option>
      </select>
    </div>

    <div
      class="flex justify-end gap-3"
      :class="{ 'pt-4 border-t border-[var(--border-subtle)]': dateOnly }"
    >
      <button
        v-if="showToday"
        type="button"
        class="btn-cancel !py-2 !px-5 mr-auto"
        data-test="date-today"
        @click="pickToday"
      >
        {{ t('gallery.sheet.today') }}
      </button>
      <button
        type="button"
        class="btn-cancel !py-2 !px-5"
        data-test="date-cancel"
        @click="emit('cancel')"
      >
        {{ t('gallery.sheet.cancel') }}
      </button>
      <button
        type="button"
        class="btn-action !py-2 !px-5"
        :disabled="!selected || busy"
        data-test="date-ok"
        @click="confirm"
      >
        {{ t('gallery.sheet.validate') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { t, getLang } from '../../i18n';
import { calendarWeeks, type CalendarDay } from '../../metadata-sheet-utils';

const chevronLeftSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
const chevronRightSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

const props = defineProps<{
  /** The date as a local `YYYY-MM-DDTHH:mm` string (`YYYY-MM-DD` with `dateOnly`), or '' when there is none yet. */
  value: string;
  busy?: boolean;
  /** A day only: no hour row, and the choice is emitted as `YYYY-MM-DD`. */
  dateOnly?: boolean;
  /** Adds "Aujourd'hui", which chooses today and closes at once. */
  showToday?: boolean;
  /** The side of its line the popup lines up with (right by default). */
  align?: 'left' | 'right';
}>();
const emit = defineEmits<{ confirm: [value: string]; cancel: [] }>();

const pad = (n: number) => String(n).padStart(2, '0');

const initial = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(props.value);
const now = new Date();
const selected = ref<{ year: number; month: number; day: number } | null>(
  initial ? { year: +initial[1], month: +initial[2] - 1, day: +initial[3] } : null,
);
const hour = ref(initial?.[4] ? +initial[4] : 0);
const minute = ref(initial?.[5] ? +initial[5] : 0);
const shown = ref({
  year: selected.value?.year ?? now.getFullYear(),
  month: selected.value?.month ?? now.getMonth(),
});

const weeks = computed(() => calendarWeeks(shown.value.year, shown.value.month));
const monthTitle = computed(() =>
  new Date(shown.value.year, shown.value.month, 1).toLocaleDateString(getLang(), {
    month: 'long',
    year: 'numeric',
  }),
);
// Monday first: 5 January 2026 is a Monday.
const weekdayNames = computed(() =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 0, 5 + i).toLocaleDateString(getLang(), { weekday: 'short' }).replace('.', ''),
  ),
);

function isSelected(cell: CalendarDay): boolean {
  const s = selected.value;
  return !!s && s.year === cell.year && s.month === cell.month && s.day === cell.day;
}

function shiftMonth(delta: number) {
  const d = new Date(shown.value.year, shown.value.month + delta, 1);
  shown.value = { year: d.getFullYear(), month: d.getMonth() };
}

function pick(cell: CalendarDay) {
  selected.value = { year: cell.year, month: cell.month, day: cell.day };
  if (!cell.inMonth) shown.value = { year: cell.year, month: cell.month };
}

function confirm() {
  const s = selected.value;
  if (!s) return;
  const day = `${s.year}-${pad(s.month + 1)}-${pad(s.day)}`;
  emit('confirm', props.dateOnly ? day : `${day}T${pad(hour.value)}:${pad(minute.value)}`);
}

function pickToday() {
  const d = new Date();
  selected.value = { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  confirm();
}

// A click outside its line closes it, as Annuler does (its own calendar button toggles it already). The line is the
// photo sheet's row, else the element the popup is shown in.
const root = ref<HTMLElement>();
function onDocMouseDown(e: MouseEvent) {
  const row = root.value?.closest('.sheet-row') ?? root.value?.parentElement;
  if (row && !row.contains(e.target as Node)) emit('cancel');
}
onMounted(() => document.addEventListener('mousedown', onDocMouseDown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown));
</script>
