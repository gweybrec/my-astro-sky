import { filterFilterCandidates } from './autocomplete-utils';

/**
 * Creates a colored filter badge identical to the ones shown in the
 * "Suggested filters" section of Targets result cards.
 * The CSS class `filter-{name}` drives the color (e.g. filter-ha, filter-oiii).
 */
const KNOWN_FILTER_CSS_KEYS = new Set([
  'ha',
  'oiii',
  'sii',
  'l',
  'r',
  'g',
  'b',
  'rgb',
  'dual-band',
]);

export function createFilterBadge(name: string): HTMLSpanElement {
  const badge = document.createElement('span');
  const key = name.toLowerCase();
  const colorClass = KNOWN_FILTER_CSS_KEYS.has(key) ? `filter-${key}` : 'filter-custom';
  badge.className = `target-filter-badge ${colorClass}`;
  badge.textContent = name;
  return badge;
}

/**
 * Builds a filter input field that behaves like the DSO/label autocomplete:
 * - When empty: shows a text input; typing filters the dropdown suggestions
 * - Dropdown items show colored filter badges (same as Targets result cards)
 * - When a filter is selected: replaces the input with the colored badge + a × clear button
 * - Clicking the badge or × re-enters edit mode
 */
export function buildIntegrationFilterField(opts: {
  initialValue: string;
  knownFilterMap: Map<string, string>;
  placeholder: string;
  tooltip: string;
  onSelect: (value: string) => void;
  onCommit?: (value: string) => void;
}): { el: HTMLElement; getValue: () => string } {
  const wrap = document.createElement('div');
  wrap.className = 'tag-input-wrap integration-filter-wrap';

  // Badge display area (shown when a filter is selected)
  const badgeDisplay = document.createElement('span');
  badgeDisplay.className = 'integration-filter-selected';
  badgeDisplay.classList.add('hidden');

  // Text input + dropdown (shown when editing)
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input integration-input integration-filter-input';
  input.placeholder = opts.placeholder;
  input.title = opts.tooltip;

  const suggest = document.createElement('div');
  suggest.className = 'tag-suggest';
  suggest.classList.add('hidden');

  let currentValue = opts.initialValue;

  const showBadge = (value: string) => {
    badgeDisplay.innerHTML = '';
    const badge = createFilterBadge(value);
    badge.title = opts.tooltip;
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', () => enterEditMode());
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'integration-filter-clear';
    clearBtn.textContent = '×';
    clearBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      currentValue = '';
      opts.onSelect('');
      badgeDisplay.classList.add('hidden');
      input.classList.remove('hidden');
      input.value = '';
      input.focus();
    });
    badgeDisplay.appendChild(badge);
    badgeDisplay.appendChild(clearBtn);
    badgeDisplay.classList.remove('hidden');
    input.value = ''; // clear before hiding: prevents the hide-triggered blur from overwriting the selection
    input.classList.add('hidden');
    suggest.classList.add('hidden');
  };

  const enterEditMode = () => {
    badgeDisplay.classList.add('hidden');
    input.classList.remove('hidden');
    input.value = currentValue;
    input.focus();
    renderSuggestions();
  };

  const renderSuggestions = () => {
    suggest.innerHTML = '';
    const candidates = filterFilterCandidates(opts.knownFilterMap, input.value);
    for (const label of candidates) {
      const opt = document.createElement('div');
      opt.className = 'tag-suggest-item';
      opt.appendChild(createFilterBadge(label));
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        currentValue = label;
        opts.onSelect(label);
        opts.onCommit?.(label);
        showBadge(label);
        suggest.classList.add('hidden');
      });
      suggest.appendChild(opt);
    }
    suggest.classList.toggle('hidden', candidates.length === 0);
  };

  input.addEventListener('input', () => {
    currentValue = input.value;
    opts.onSelect(input.value);
    renderSuggestions();
  });
  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('blur', () => {
    const trimmed = input.value.trim();
    if (trimmed) {
      opts.onCommit?.(trimmed); // synchronous: map updated before next field's focus fires renderSuggestions
    }
    setTimeout(() => {
      suggest.classList.add('hidden');
      if (trimmed) {
        currentValue = trimmed;
        opts.onSelect(trimmed);
        showBadge(trimmed);
      }
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      suggest.classList.add('hidden');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.value.trim();
      if (trimmed) {
        currentValue = trimmed;
        opts.onSelect(trimmed);
        opts.onCommit?.(trimmed);
        showBadge(trimmed);
        suggest.classList.add('hidden');
      }
    }
  });

  wrap.appendChild(badgeDisplay);
  wrap.appendChild(input);
  wrap.appendChild(suggest);

  if (opts.initialValue) {
    showBadge(opts.initialValue);
  }

  return { el: wrap, getValue: () => currentValue };
}

type TargetsChipOptions = {
  extraClass?: string;
  showCheckbox?: boolean;
  checked?: boolean;
  title?: string;
};

export function createTargetsChip(
  label: string,
  options: TargetsChipOptions = {},
): HTMLLabelElement {
  const chip = document.createElement('label');
  chip.className = options.extraClass
    ? `targets-type-chip ${options.extraClass}`
    : 'targets-type-chip';
  if (options.title) chip.title = options.title;

  // Always include the checkbox so :has(input:checked) fires for the active color.
  // When showCheckbox is false, hide it visually but keep it in the DOM.
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = options.checked ?? true;
  if (options.showCheckbox === false) {
    checkbox.classList.add('hidden');
  }
  chip.appendChild(checkbox);

  const text = document.createElement('span');
  text.textContent = label;
  chip.appendChild(text);
  return chip;
}
