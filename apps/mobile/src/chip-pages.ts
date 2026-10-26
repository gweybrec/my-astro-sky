/**
 * The pages of a wrapped row of chips (board "Ciel, photo sélectionnée"): at most `lines` lines on a page, cut where the
 * chips wrap. `tops` are the chips' tops in the laid-out row, in the order of `items`; a chip whose top is within a pixel
 * of a line's is on that line.
 */
export function pagesByLine<T>(items: readonly T[], tops: readonly number[], lines = 2): T[][] {
  const pages: T[][] = [];
  let lineTop = Number.NEGATIVE_INFINITY;
  let line = -1;
  items.forEach((item, i) => {
    const top = tops[i] ?? lineTop;
    if (Math.abs(top - lineTop) > 1) {
      line += 1;
      lineTop = top;
    }
    const page = Math.floor(line / lines);
    (pages[page] ??= []).push(item);
  });
  return pages;
}
