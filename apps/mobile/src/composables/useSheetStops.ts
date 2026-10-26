import { ref } from 'vue';

/**
 * Where Ionic's sheet gesture stops a sheet, as parts of the sheet's height (`breakpoints`, 0 closed), the one it opens
 * at, the sheet's height when it is fixed (null: the height of its content, at most `max`), and how much of the sheet
 * shows once it has opened (`opens`, px).
 */
export interface SheetStops {
  breakpoints: number[];
  initial: number;
  height: number | null;
  max: number | null;
  opens: number;
}

/**
 * The stops of a sheet whose content is `natural` px tall in a room `room` px tall, `under` px above the bottom of the
 * screen (Ionic measures a sheet from there: the modal reaches it, and the strip under the sheet is part of it). A
 * sheet held to a third (`third`, portrait only) whose content is taller than that third is two thirds tall (or its
 * content's height, if less) and opens at the third: Ionic's gesture takes it up to its full height and back. Any
 * other sheet opens at its full height, its content's, and only closes.
 */
export function sheetStops(natural: number, room: number, third: boolean, under = 0): SheetStops {
  const share = third ? room / 3 : room;
  if (natural <= share || !third) {
    return {
      breakpoints: [0, 1],
      initial: 1,
      height: null,
      max: share,
      opens: Math.min(natural, share),
    };
  }
  const height = Math.min(natural, (2 * room) / 3);
  const mid = (share + under) / (height + under);
  return {
    breakpoints: [0, mid, 1],
    initial: mid,
    height: height + under,
    max: height,
    opens: share,
  };
}

/**
 * The stops of a sheet whose content says where to stop (`marks`, px from the sheet's top, see `sheetMarks`): one at
 * each mark, then the whole content, at most the room's height (its body scrolls past that). It opens at the first
 * mark. Marks past the whole are left out; with none left, the sheet opens whole and only closes. `under` as for
 * `sheetStops`.
 */
export function contentStops(
  natural: number,
  room: number,
  marks: readonly number[],
  under = 0,
): SheetStops {
  const height = Math.min(natural, room);
  const shown = [...new Set(marks.map((m) => Math.round(m)))]
    .filter((m) => m > 0 && m < height - 1)
    .sort((a, b) => a - b);
  if (!shown.length) {
    return { breakpoints: [0, 1], initial: 1, height: null, max: room, opens: height };
  }
  const total = height + under;
  const points = shown.map((m) => (m + under) / total);
  return {
    breakpoints: [0, ...points, 1],
    initial: points[0],
    height: total,
    max: height,
    opens: shown[0],
  };
}

/**
 * Where a sheet's content asks it to stop, in px from the sheet's top: under the line of an element marked
 * `data-sheet-stop` (the bottom of the tallest of the elements beside it on that line), or just above an element marked
 * `data-sheet-stop="before"`.
 */
export function sheetMarks(sheet: HTMLElement): number[] {
  const top = sheet.getBoundingClientRect().top;
  return [...sheet.querySelectorAll<HTMLElement>('[data-sheet-stop]')].map((el) => {
    const box = el.getBoundingClientRect();
    if (el.dataset.sheetStop === 'before') return box.top - top;
    const line = [...(el.parentElement?.children ?? [])]
      .map((sibling) => sibling.getBoundingClientRect())
      .filter((b) => Math.abs(b.top - box.top) < 1);
    return Math.max(box.bottom, ...line.map((b) => b.bottom)) - top;
  });
}

/**
 * Where the rows of a sheet's body end, in px from the sheet's top: its children and theirs (a list of facts ends a
 * line at each of its facts), sorted.
 */
export function sheetRows(sheet: HTMLElement): number[] {
  const top = sheet.getBoundingClientRect().top;
  const body = sheet.querySelector('.mob-sheet-body');
  if (!body) return [];
  const rows = [...body.children].flatMap((row) => [row, ...row.children]);
  return rows.map((row) => row.getBoundingClientRect().bottom - top).sort((a, b) => a - b);
}

/** The height `height` moved up to the end of the last row it holds whole (`rows`, see `sheetRows`), if one ends. */
export function underLastRow(height: number, rows: readonly number[]): number {
  const whole = rows.filter((bottom) => bottom <= height);
  return whole.length ? whole[whole.length - 1] : height;
}

const portrait = () => !(window.matchMedia?.('(orientation: landscape)').matches ?? false);

/**
 * The stops of a sheet on Ionic's modal, measured before it opens (Ionic reads them when it presents the sheet): its
 * content (`sheet`, mounted while closed) at its natural height, in its room (`room`, an element as tall as the room),
 * `under()` px above the bottom of the screen. With `marks`, a content that marks where to stop (`sheetMarks`) sets
 * the stops (`contentStops`); without marks, `sheetStops` does, its third and two thirds moved up to the end of the last
 * row they hold whole, so that no stop cuts a row. The style puts the fixed height on the modal and the content's limit
 * on the sheet.
 */
export function useSheetStops(
  room: () => HTMLElement | undefined,
  sheet: () => HTMLElement | undefined,
  third: () => boolean,
  under: () => number = () => 0,
  marks = false,
) {
  const stops = ref<SheetStops | null>(null);
  function measure(): SheetStops {
    const roomEl = room();
    const sheetEl = sheet();
    if (!roomEl || !sheetEl)
      return (stops.value = { breakpoints: [0, 1], initial: 1, height: null, max: null, opens: 0 });
    sheetEl.classList.add('mob-sheet--measuring');
    // Rounded up: a sheet a fraction of a pixel short of its content would scroll by that fraction, and show a scroll
    // bar while all of it is in view.
    const natural = Math.ceil(sheetEl.getBoundingClientRect().height);
    // A stop shows the sheet's bottom padding (the system's navigation bar) under what it holds.
    const pad = parseFloat(getComputedStyle(sheetEl).paddingBottom) || 0;
    const found = (marks ? sheetMarks(sheetEl) : []).map((mark) => mark + pad);
    const rows = sheetRows(sheetEl).map((bottom) => bottom + pad);
    sheetEl.classList.remove('mob-sheet--measuring');
    const roomHeight = roomEl.clientHeight;
    if (found.length) return (stops.value = contentStops(natural, roomHeight, found, under()));
    const plain = sheetStops(natural, roomHeight, third() && portrait(), under());
    if (plain.breakpoints.length < 3) return (stops.value = plain);
    const shares = [roomHeight / 3, (2 * roomHeight) / 3].map((h) => underLastRow(h, rows));
    return (stops.value = contentStops(natural, roomHeight, shares, under()));
  }
  return { stops, measure };
}
