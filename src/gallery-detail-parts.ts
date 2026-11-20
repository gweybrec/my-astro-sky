/**
 * Small controls of the gallery's photo panel, built as plain DOM like the rest of the photo view: the pen beside
 * the photo's name (renames it in place) and the "⋯" button with its menu (the rarely used actions, delete first).
 */
import { t } from './i18n';
import penSvg from './icons/pen.svg?raw';
import checkSvg from './icons/check.svg?raw';
import closeSvg from './icons/close-x.svg?raw';
import moreSvg from './icons/more-horizontal.svg?raw';

function iconBtn(svg: string, label: string, className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svg;
  return btn;
}

/**
 * A pen after the photo's name: pressed, the name becomes a field with ✓ and ✕ (Enter, Esc). `save` stores the new
 * name and gives true once saved; the name then shows it. An empty name is not taken.
 */
export function attachRenameControl(
  nameEl: HTMLElement,
  save: (name: string) => Promise<boolean>,
): HTMLButtonElement {
  const pen = iconBtn(penSvg, t('gallery.sheet.rename'), 'sheet-icon-btn');
  pen.dataset.test = 'rename-photo';

  const editor = document.createElement('div');
  editor.className = 'hidden flex-1 min-w-0 flex items-center gap-1';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sheet-input';
  input.setAttribute('aria-label', t('gallery.sheet.rename'));
  const ok = iconBtn(checkSvg, t('gallery.sheet.validate'), 'sheet-ok');
  const cancel = iconBtn(closeSvg, t('gallery.sheet.cancel'), 'sheet-cancel');
  editor.append(input, ok, cancel);
  nameEl.after(pen, editor);

  const show = (editing: boolean) => {
    nameEl.classList.toggle('hidden', editing);
    pen.classList.toggle('hidden', editing);
    editor.classList.toggle('hidden', !editing);
  };
  const close = () => {
    show(false);
    pen.focus();
  };
  const commit = async () => {
    const name = input.value.trim();
    if (!name || name === nameEl.textContent) {
      close();
      return;
    }
    ok.disabled = true;
    try {
      if (await save(name)) {
        nameEl.textContent = name;
        nameEl.title = name;
        close();
      }
    } finally {
      ok.disabled = false;
    }
  };

  pen.addEventListener('click', () => {
    input.value = nameEl.textContent ?? '';
    show(true);
    input.focus();
    input.select();
  });
  ok.addEventListener('click', () => void commit());
  cancel.addEventListener('click', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      // Closes the field only, not the photo view.
      e.stopPropagation();
      close();
    }
  });
  return pen;
}

export interface MoreMenuItem {
  label: string;
  icon?: string;
  /** Drawn in the danger colour (delete). */
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The "⋯" button and its menu, opening upwards from the bottom of the panel. The menu closes on a choice, a click
 * elsewhere or Esc. `wrap` holds both: put it where the button goes.
 */
export function buildMoreMenu(items: MoreMenuItem[]): {
  wrap: HTMLElement;
  button: HTMLButtonElement;
  teardown: () => void;
} {
  const wrap = document.createElement('div');
  wrap.className = 'relative flex-none';
  const button = iconBtn(
    moreSvg,
    t('gallery.sheet.moreActions'),
    'btn-icon !w-[32px] !h-[32px] !p-0 [&>svg]:w-[16px] [&>svg]:h-[16px]',
  );
  button.dataset.test = 'more-actions';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'sheet-pop hidden right-0 bottom-full mb-2 min-w-[220px]';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', 'menuitem');
    entry.className = item.danger
      ? 'sheet-pop-item !text-[var(--status-error-text)]'
      : 'sheet-pop-item';
    if (item.icon) entry.innerHTML = item.icon;
    entry.append(item.label);
    entry.addEventListener('click', () => {
      setOpen(false);
      item.onSelect();
    });
    menu.appendChild(entry);
  }
  wrap.append(menu, button);

  function setOpen(open: boolean) {
    menu.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('btn-icon--active', open);
  }
  const isOpen = () => !menu.classList.contains('hidden');
  button.addEventListener('click', () => setOpen(!isOpen()));

  const onDocMouseDown = (e: MouseEvent) => {
    if (isOpen() && !wrap.contains(e.target as Node)) setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen()) {
      // Closes the menu only, not the photo view.
      e.stopPropagation();
      setOpen(false);
      button.focus();
    }
  };
  document.addEventListener('mousedown', onDocMouseDown);
  wrap.addEventListener('keydown', onKey);

  return {
    wrap,
    button,
    teardown: () => document.removeEventListener('mousedown', onDocMouseDown),
  };
}
