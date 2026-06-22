// Pure, DOM-light registry + persistence for the remappable keyboard-shortcut system.
// Vue/Pinia wiring lives in stores/shortcuts.ts and composables/useKeyboardShortcuts.ts;
// the cheat-sheet/remap UI lives in components/modals/KeyboardShortcutsModal.vue.

export const SHORTCUTS_KEY = 'keyboard-shortcuts';

export type ShortcutCategory = 'toggles' | 'navigation';

export type ShortcutActionId =
  | 'toggleStars'
  | 'toggleConstellationLines'
  | 'toggleConstellationNames'
  | 'toggleDSOs'
  | 'toggleDSOLabels'
  | 'toggleStarLabels'
  | 'toggleGrid'
  | 'togglePhotos'
  | 'togglePhotoOutlines'
  | 'togglePanel'
  | 'zoomIn'
  | 'zoomOut'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown'
  | 'openShortcuts';

export interface ShortcutAction {
  id: ShortcutActionId;
  category: ShortcutCategory;
  /** Default normalized key strings. First entry is the primary; extras are aliases. */
  defaultKeys: string[];
  /** i18n key for the human-readable label (reuses existing display./dso. keys where possible). */
  labelKey: string;
}

/** Ordered registry — drives both dispatch and the cheat-sheet UI. */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'toggleStars',              category: 'toggles',    defaultKeys: ['s'],          labelKey: 'display.showStars' },
  { id: 'toggleConstellationLines', category: 'toggles',    defaultKeys: ['c'],          labelKey: 'display.constellationLines' },
  { id: 'toggleConstellationNames', category: 'toggles',    defaultKeys: ['v'],          labelKey: 'display.constellationNames' },
  { id: 'toggleDSOs',               category: 'toggles',    defaultKeys: ['d'],          labelKey: 'dso.showDSOs' },
  { id: 'toggleDSOLabels',          category: 'toggles',    defaultKeys: ['shift+d'],    labelKey: 'display.dsoLabels' },
  { id: 'toggleStarLabels',         category: 'toggles',    defaultKeys: ['shift+s'],    labelKey: 'display.starLabels' },
  { id: 'toggleGrid',               category: 'toggles',    defaultKeys: ['e'],          labelKey: 'display.raDecGrid' },
  { id: 'togglePhotos',             category: 'toggles',    defaultKeys: ['p'],          labelKey: 'display.showPhotos' },
  { id: 'togglePhotoOutlines',      category: 'toggles',    defaultKeys: ['shift+p'],    labelKey: 'display.photoOutlines' },
  { id: 'togglePanel',              category: 'navigation', defaultKeys: ['h'],          labelKey: 'shortcuts.action.togglePanel' },
  { id: 'zoomIn',                   category: 'navigation', defaultKeys: ['+', '='],     labelKey: 'shortcuts.action.zoomIn' },
  { id: 'zoomOut',                  category: 'navigation', defaultKeys: ['-'],          labelKey: 'shortcuts.action.zoomOut' },
  { id: 'panLeft',                  category: 'navigation', defaultKeys: ['arrowleft'],  labelKey: 'shortcuts.action.panLeft' },
  { id: 'panRight',                 category: 'navigation', defaultKeys: ['arrowright'], labelKey: 'shortcuts.action.panRight' },
  { id: 'panUp',                    category: 'navigation', defaultKeys: ['arrowup'],    labelKey: 'shortcuts.action.panUp' },
  { id: 'panDown',                  category: 'navigation', defaultKeys: ['arrowdown'],  labelKey: 'shortcuts.action.panDown' },
  { id: 'openShortcuts',            category: 'navigation', defaultKeys: ['?'],          labelKey: 'shortcuts.action.openShortcuts' },
];

const ACTION_IDS = SHORTCUT_ACTIONS.map((a) => a.id);

/** Full binding map: every action → its currently-bound key strings. */
export type Bindings = Record<ShortcutActionId, string[]>;

/**
 * Canonicalize a keydown event into a comparable key string, e.g. "s", "shift+s",
 * "+", "arrowleft", "?". Shift is only encoded for alphabetic keys — for punctuation
 * and digits the produced character already reflects the shift state ("+" vs "="). Bare
 * modifier presses (Shift/Ctrl/Alt/Meta alone) return "".
 */
export function normalizeKey(e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): string {
  const raw = e.key;
  if (raw === 'Shift' || raw === 'Control' || raw === 'Alt' || raw === 'Meta') return '';
  const base = raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
  const isLetter = base.length === 1 && base >= 'a' && base <= 'z';
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.metaKey) mods.push('meta');
  if (e.shiftKey && isLetter) mods.push('shift');
  mods.sort();
  return [...mods, base].join('+');
}

/** Pretty, human-readable rendering of a normalized key string for the UI. */
export function formatKey(key: string): string {
  if (!key) return '';
  if (key === '+') return '+'; // the standalone "+" key collides with the modifier separator
  const arrows: Record<string, string> = {
    arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  };
  const parts = key.split('+');
  return parts
    .map((p) => {
      if (p === 'shift') return 'Shift';
      if (p === 'ctrl') return 'Ctrl';
      if (p === 'alt') return 'Alt';
      if (p === 'meta') return 'Meta';
      if (arrows[p]) return arrows[p];
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' + ');
}

export function defaultBindings(): Bindings {
  const b = {} as Bindings;
  for (const a of SHORTCUT_ACTIONS) b[a.id] = [...a.defaultKeys];
  return b;
}

/** Merge a (possibly partial / untrusted) stored map with the defaults. */
export function mergeBindings(stored: unknown): Bindings {
  const b = defaultBindings();
  if (stored && typeof stored === 'object') {
    const s = stored as Record<string, unknown>;
    for (const id of ACTION_IDS) {
      const v = s[id];
      if (Array.isArray(v) && v.every((k) => typeof k === 'string')) {
        b[id] = v.filter((k) => k.length > 0);
      }
    }
  }
  return b;
}

/** key string → list of action ids bound to it. */
export function reverseMap(b: Bindings): Map<string, ShortcutActionId[]> {
  const m = new Map<string, ShortcutActionId[]>();
  for (const id of ACTION_IDS) {
    for (const key of b[id]) {
      const list = m.get(key) ?? [];
      list.push(id);
      m.set(key, list);
    }
  }
  return m;
}

/** Set of action ids whose binding collides with another action. */
export function findConflicts(b: Bindings): Set<ShortcutActionId> {
  const conflicts = new Set<ShortcutActionId>();
  for (const ids of reverseMap(b).values()) {
    if (ids.length > 1) for (const id of ids) conflicts.add(id);
  }
  return conflicts;
}

/**
 * Assign `key` as the sole binding for `id`. Duplicates are allowed: if another action
 * already uses `key`, it keeps it (both will fire) and the clash is surfaced as a
 * conflict in the UI rather than silently stolen.
 */
export function assignKey(b: Bindings, id: ShortcutActionId, key: string): Bindings {
  return { ...b, [id]: [key] };
}

/** Reset a single action to its registry default. */
export function resetBinding(b: Bindings, id: ShortcutActionId): Bindings {
  const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
  const next: Bindings = { ...b };
  next[id] = action ? [...action.defaultKeys] : [];
  return next;
}

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY);
    if (raw) return mergeBindings(JSON.parse(raw));
  } catch { /* ignore */ }
  return defaultBindings();
}

export function saveBindings(b: Bindings): void {
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(b));
}

/**
 * Parse imported shortcut data into a valid Bindings. Accepts either a raw bindings map
 * (how the backup ZIP stores shortcuts.json) or a `{ bindings: … }` envelope.
 */
export function importBindings(data: unknown): Bindings {
  if (data && typeof data === 'object' && 'bindings' in (data as Record<string, unknown>)) {
    return mergeBindings((data as { bindings: unknown }).bindings);
  }
  return mergeBindings(data);
}
