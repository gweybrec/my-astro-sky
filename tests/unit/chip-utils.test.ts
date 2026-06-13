import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createFilterBadge, buildIntegrationFilterField } from '../../src/chip-utils';

vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

// ─── createFilterBadge ────────────────────────────────────────────────────────

describe('createFilterBadge', () => {
  it.each([
    ['Ha',  'filter-ha'],
    ['OIII','filter-oiii'],
    ['SII', 'filter-sii'],
    ['L',   'filter-l'],
    ['R',   'filter-r'],
    ['G',   'filter-g'],
    ['B',   'filter-b'],
    ['RGB', 'filter-rgb'],
  ])('known filter %s → CSS class %s', (name, cls) => {
    const badge = createFilterBadge(name);
    expect(badge.className).toContain('target-filter-badge');
    expect(badge.className).toContain(cls);
    expect(badge.textContent).toBe(name);
  });

  it('unknown filter → filter-custom class', () => {
    const badge = createFilterBadge('MyCustomFilter');
    expect(badge.className).toContain('filter-custom');
    expect(badge.className).not.toMatch(/filter-mycustomfilter/);
    expect(badge.textContent).toBe('MyCustomFilter');
  });

  it('case-insensitive matching for known filters', () => {
    expect(createFilterBadge('ha').className).toContain('filter-ha');
    expect(createFilterBadge('HA').className).toContain('filter-ha');
    expect(createFilterBadge('oIII').className).toContain('filter-oiii');
  });
});

// ─── buildIntegrationFilterField helpers ────────────────────────────────────

function makeMap(labels: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of labels) m.set(l.toLowerCase(), l);
  return m;
}

function build(opts: {
  initialValue?: string;
  labels?: string[];
  onSelect?: (v: string) => void;
  onCommit?: (v: string) => void;
}) {
  const onSelect = opts.onSelect ?? vi.fn();
  const onCommit = opts.onCommit ?? vi.fn();
  const result = buildIntegrationFilterField({
    initialValue: opts.initialValue ?? '',
    knownFilterMap: makeMap(opts.labels ?? ['Ha', 'OIII', 'SII', 'L', 'R', 'G', 'B', 'RGB']),
    placeholder: 'Filter',
    tooltip: 'Choose filter',
    onSelect,
    onCommit,
  });
  document.body.appendChild(result.el);
  return { ...result, onSelect, onCommit };
}

function getInput(el: HTMLElement) {
  return el.querySelector('.integration-filter-input') as HTMLInputElement;
}
function getBadgeDisplay(el: HTMLElement) {
  return el.querySelector('.integration-filter-selected') as HTMLElement;
}
function getSuggestions(el: HTMLElement) {
  return el.querySelectorAll('.tag-suggest-item');
}
function getClearBtn(el: HTMLElement) {
  return el.querySelector('.integration-filter-clear') as HTMLButtonElement;
}

// ─── Initial state ────────────────────────────────────────────────────────────

describe('buildIntegrationFilterField – initial state', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('empty initialValue → shows input, hides badge display', () => {
    const { el } = build({ initialValue: '' });
    const input = getInput(el);
    const badge = getBadgeDisplay(el);
    expect(input.classList.contains('hidden')).toBe(false);
    expect(badge.classList.contains('hidden')).toBe(true);
  });

  it('non-empty initialValue → shows badge, hides input', () => {
    const { el } = build({ initialValue: 'Ha' });
    const input = getInput(el);
    const badge = getBadgeDisplay(el);
    expect(input.classList.contains('hidden')).toBe(true);
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(badge.textContent).toContain('Ha');
  });

  it('getValue() returns initialValue', () => {
    const { getValue } = build({ initialValue: 'OIII' });
    expect(getValue()).toBe('OIII');
  });

  it('getValue() returns empty string when no initialValue', () => {
    const { getValue } = build({ initialValue: '' });
    expect(getValue()).toBe('');
  });
});

// ─── Typing / onSelect ───────────────────────────────────────────────────────

describe('buildIntegrationFilterField – typing', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('typing calls onSelect with current value on each keystroke', () => {
    const { el, onSelect } = build({});
    const input = getInput(el);
    input.value = 'H';
    input.dispatchEvent(new Event('input'));
    expect(onSelect).toHaveBeenCalledWith('H');
    input.value = 'Ha';
    input.dispatchEvent(new Event('input'));
    expect(onSelect).toHaveBeenCalledWith('Ha');
  });

  it('typing updates getValue() immediately', () => {
    const { el, getValue } = build({});
    const input = getInput(el);
    input.value = 'SII';
    input.dispatchEvent(new Event('input'));
    expect(getValue()).toBe('SII');
  });

  it('typing filters dropdown suggestions', () => {
    const { el } = build({ labels: ['Ha', 'OIII', 'Halpha'] });
    const input = getInput(el);
    input.value = 'ha';
    input.dispatchEvent(new Event('input'));
    const items = getSuggestions(el);
    // Should only show entries containing 'ha'
    for (const item of items) {
      expect(item.textContent!.toLowerCase()).toContain('ha');
    }
  });

  it('empty query on focus shows all suggestions (up to 8)', () => {
    const labels = ['Ha', 'OIII', 'SII', 'L', 'R', 'G', 'B', 'RGB', 'Extra'];
    const { el } = build({ labels });
    const input = getInput(el);
    input.dispatchEvent(new Event('focus'));
    const items = getSuggestions(el);
    expect(items.length).toBe(8); // capped at 8
  });
});

// ─── Suggestion click (mousedown) ────────────────────────────────────────────

describe('buildIntegrationFilterField – suggestion click', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clicking suggestion calls onSelect and onCommit with label', () => {
    const { el, onSelect, onCommit } = build({ labels: ['OIII'] });
    const input = getInput(el);
    input.dispatchEvent(new Event('focus'));
    const item = getSuggestions(el)[0] as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('OIII');
    expect(onCommit).toHaveBeenCalledWith('OIII');
  });

  it('clicking suggestion shows badge with correct label', () => {
    const { el } = build({ labels: ['OIII'] });
    const input = getInput(el);
    input.dispatchEvent(new Event('focus'));
    const item = getSuggestions(el)[0] as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const badge = getBadgeDisplay(el);
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(badge.textContent).toContain('OIII');
  });

  it('clicking suggestion hides input', () => {
    const { el } = build({ labels: ['OIII'] });
    const input = getInput(el);
    input.dispatchEvent(new Event('focus'));
    const item = getSuggestions(el)[0] as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(input.classList.contains('hidden')).toBe(true);
  });

  it('after suggestion click, input.value is cleared (prevents blur overwrite)', () => {
    const { el } = build({ labels: ['OIII'] });
    const input = getInput(el);
    input.value = 'o'; // partial typed text
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('focus'));
    const item = getSuggestions(el)[0] as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // input.value must be cleared so that the blur triggered by hiding the input
    // does not overwrite the selection with the partial "o"
    expect(input.value).toBe('');
  });

  it('getValue() returns selected label after suggestion click', () => {
    const { el, getValue } = build({ labels: ['Ha', 'OIII'] });
    const input = getInput(el);
    input.dispatchEvent(new Event('focus'));
    // Click second suggestion (OIII)
    const items = getSuggestions(el);
    (items[1] as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(getValue()).toBe('OIII');
  });
});

// ─── Enter key ───────────────────────────────────────────────────────────────

describe('buildIntegrationFilterField – Enter key', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('Enter on non-empty input commits value and shows badge', () => {
    const { el, onSelect, onCommit } = build({});
    const input = getInput(el);
    input.value = 'MyFilter';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('MyFilter');
    expect(onCommit).toHaveBeenCalledWith('MyFilter');
    expect(getBadgeDisplay(el).classList.contains('hidden')).toBe(false);
  });

  it('Enter on empty input does nothing', () => {
    const { el, onSelect } = build({});
    const input = getInput(el);
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(getBadgeDisplay(el).classList.contains('hidden')).toBe(true);
  });

  it('Escape hides dropdown without committing', () => {
    const { el, onCommit } = build({});
    const input = getInput(el);
    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const suggest = el.querySelector('.tag-suggest') as HTMLElement;
    expect(suggest.classList.contains('hidden')).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// ─── Blur ─────────────────────────────────────────────────────────────────────

describe('buildIntegrationFilterField – blur', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => vi.useRealTimers());

  it('blur with non-empty input calls onCommit synchronously', () => {
    const { el, onCommit } = build({});
    const input = getInput(el);
    input.value = 'SII';
    input.dispatchEvent(new Event('blur'));
    expect(onCommit).toHaveBeenCalledWith('SII');
  });

  it('blur with empty input does not call onCommit', () => {
    const { el, onCommit } = build({});
    const input = getInput(el);
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('after blur timeout, onSelect is called and badge shown', () => {
    const { el, onSelect } = build({});
    const input = getInput(el);
    input.value = 'SII';
    input.dispatchEvent(new Event('blur'));
    vi.runAllTimers();
    expect(onSelect).toHaveBeenCalledWith('SII');
    expect(getBadgeDisplay(el).classList.contains('hidden')).toBe(false);
  });

  it('blur with empty input does not show badge after timeout', () => {
    const { el } = build({});
    const input = getInput(el);
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    vi.runAllTimers();
    expect(getBadgeDisplay(el).classList.contains('hidden')).toBe(true);
  });

  it('onCommit fires before timeout (synchronous) so next field focus sees new entry', () => {
    const committed: string[] = [];
    const { el } = build({ onCommit: (v) => committed.push(v) });
    const input = getInput(el);
    input.value = 'CustomDB';
    input.dispatchEvent(new Event('blur'));
    // At this point, before timers run, onCommit must have already been called
    expect(committed).toContain('CustomDB');
  });
});

// ─── Clear button ─────────────────────────────────────────────────────────────

describe('buildIntegrationFilterField – clear button', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clear button calls onSelect with empty string', () => {
    const { el, onSelect } = build({ initialValue: 'Ha' });
    const clearBtn = getClearBtn(el);
    clearBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('clear button hides badge and shows input', () => {
    const { el } = build({ initialValue: 'Ha' });
    const clearBtn = getClearBtn(el);
    clearBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(getBadgeDisplay(el).classList.contains('hidden')).toBe(true);
    expect(getInput(el).classList.contains('hidden')).toBe(false);
  });

  it('clear button resets getValue() to empty', () => {
    const { el, getValue } = build({ initialValue: 'Ha' });
    getClearBtn(el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(getValue()).toBe('');
  });
});

// ─── Badge click re-enters edit mode ─────────────────────────────────────────

describe('buildIntegrationFilterField – badge click re-enters edit mode', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clicking the badge shows input and hides badge area', () => {
    const { el } = build({ initialValue: 'OIII' });
    const badge = getBadgeDisplay(el).querySelector('.target-filter-badge') as HTMLElement;
    badge.click();
    expect(getInput(el).classList.contains('hidden')).toBe(false);
    expect(getBadgeDisplay(el).classList.contains('hidden')).toBe(true);
  });

  it('after re-entering edit mode, input value equals current value', () => {
    const { el } = build({ initialValue: 'OIII' });
    const badge = getBadgeDisplay(el).querySelector('.target-filter-badge') as HTMLElement;
    badge.click();
    expect(getInput(el).value).toBe('OIII');
  });
});

// ─── Custom filter becomes autocomplete entry ─────────────────────────────────

describe('buildIntegrationFilterField – custom filter autocomplete persistence', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('onCommit is called with custom typed value so caller can add it to the map', () => {
    const committed: string[] = [];
    const { el } = build({ labels: [], onCommit: (v) => committed.push(v) });
    const input = getInput(el);
    input.value = 'Narrowband';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(committed).toContain('Narrowband');
  });

  it('after adding custom filter to map, it appears in dropdown on next focus', () => {
    const map = makeMap(['Ha']);
    const { el } = buildIntegrationFilterField({
      initialValue: '',
      knownFilterMap: map,
      placeholder: 'Filter',
      tooltip: '',
      onSelect: vi.fn(),
      onCommit: (v) => map.set(v.toLowerCase(), v),
    });
    document.body.appendChild(el);

    const input = getInput(el);
    // Type and commit custom value
    input.value = 'CustomDB';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Now focus again — CustomDB should appear in dropdown
    input.classList.remove('hidden');
    input.value = '';
    input.dispatchEvent(new Event('focus'));
    const labels = Array.from(getSuggestions(el)).map(i => i.textContent ?? '');
    expect(labels.some(l => l.includes('CustomDB'))).toBe(true);
  });
});
