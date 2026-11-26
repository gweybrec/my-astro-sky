// The live plan in the desktop's plan section (the phone's boards "Plan, détail, ce soir" and "Plan, en direct"): the
// start button and the alerts of tonight's plan; once started, the live card (what is imaged now, until when, what
// comes next, Passer / +10 min / Arrêter), the alerts, the night, setup and location locked, and the row of the
// target being imaged lit. Everything here is refreshed in place: rebuilding the plans view would fold every plan.

import { t } from './i18n';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { liveCard, type LiveOptions } from '@myastrosky/core/targets/live-plan';
import type { Plan } from '@myastrosky/core/domain/plans';
import { useLivePlanStore } from '@myastrosky/app-state/stores/live-plan';
import { pinia } from './pinia-instance';
import { showToast } from './toast';

/** The classes that light the row of the target being imaged. */
const CURRENT_ROW = [
  'bg-[var(--accent-fill-sm)]',
  'outline',
  'outline-1',
  'outline-[var(--border-accent)]',
];
/** The classes of a control locked while the plan is live. */
const LOCKED = ['opacity-50', 'cursor-not-allowed'];
const MERIDIAN_MINUTES = [5, 10, 15, 20, 25, 30];

const clock = (ms: number) => formatClock24(new Date(ms));

export interface LivePlanPanel {
  el: HTMLElement;
  refresh(): void;
}

function button(
  label: string,
  onClick: () => void,
  className = 'display-controls-btn',
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** The section "Alertes": the reminder, the meridian alert and its minutes. */
function buildAlerts(): HTMLElement {
  const live = useLivePlanStore(pinia);
  const options = (): LiveOptions => live.state?.options ?? live.lastOptions;
  const set = <K extends keyof LiveOptions>(key: K, value: LiveOptions[K]) =>
    live.setOptions({ ...options(), [key]: value });

  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-small text-dim uppercase tracking-wide';
  head.textContent = t('live.alerts');
  const row = document.createElement('div');
  row.className = 'flex flex-wrap items-center gap-x-8 gap-y-2';

  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
    const l = document.createElement('label');
    l.className = 'flex items-center gap-1.5 text-base text-dim cursor-pointer w-fit';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'gear-manage-checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    const span = document.createElement('span');
    span.textContent = label;
    l.append(cb, span);
    return l;
  };
  const minutes = document.createElement('label');
  minutes.className = 'flex items-center gap-2 text-base text-dim';
  const minutesText = document.createElement('span');
  minutesText.textContent = t('live.meridianMinutes');
  const select = document.createElement('select');
  select.className = 'targets-select !min-w-0 !flex-none w-auto';
  for (const m of MERIDIAN_MINUTES) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = String(m);
    select.appendChild(opt);
  }
  select.value = String(options().meridianMinutes);
  select.addEventListener('change', () => set('meridianMinutes', Number(select.value)));
  minutes.append(minutesText, select);

  row.append(
    check(t('live.remind'), options().remindBeforeEnd, (v) => set('remindBeforeEnd', v)),
    check(t('live.meridian'), options().meridianFlip, (v) => set('meridianFlip', v)),
    minutes,
  );
  wrap.append(head, row);
  return wrap;
}

/**
 * The live panel of a plan section. `locked` are the controls frozen while the plan runs (night, setup, location): a
 * click or a key on them says why instead. `rows` finds the plan's rows by their item id (`data-item-id`).
 */
export function buildLivePlanPanel(
  plan: Plan,
  locked: HTMLElement,
  rows: () => HTMLElement[],
): LivePlanPanel {
  const live = useLivePlanStore(pinia);
  const el = document.createElement('div');
  el.className = 'flex flex-col gap-3';

  const sayLocked = (e: Event) => {
    if (live.state?.planId !== plan.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'click') showToast({ message: t('live.locked'), type: 'info' });
  };
  for (const type of ['click', 'keydown', 'pointerdown', 'mousedown'])
    locked.addEventListener(type, sayLocked, true);

  let shown: 'start' | 'live' | 'none' | null = null;
  let card: {
    title: HTMLElement;
    line: HTMLElement;
    bar: HTMLElement;
    track: HTMLElement;
    next: HTMLElement;
    actions: HTMLElement;
  } | null = null;

  const start = () => {
    const other = live.plan;
    if (live.isLive && other && other.id !== plan.id) {
      showToast({ message: t('live.otherLive', { name: other.name }), type: 'info' });
      return;
    }
    live.start(plan.id);
  };

  const buildCard = () => {
    const box = document.createElement('div');
    box.className =
      'flex flex-col gap-1.5 rounded-md px-4 py-3 border border-solid border-[var(--border-accent)]';
    const head = document.createElement('div');
    head.className = 'text-small text-dim uppercase tracking-wide';
    head.textContent = t('live.section');
    const title = document.createElement('div');
    title.className = 'text-bright text-sub font-medium';
    const line = document.createElement('div');
    line.className = 'text-base text-dim';
    const track = document.createElement('div');
    track.className = 'h-1 rounded-full bg-[var(--border-subtle)] overflow-hidden my-1';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const bar = document.createElement('div');
    bar.className = 'h-full bg-[var(--accent-color)] origin-left';
    track.appendChild(bar);
    const next = document.createElement('div');
    next.className = 'text-base text-dim';
    const actions = document.createElement('div');
    actions.className = 'flex flex-wrap gap-2 pt-1';
    box.append(head, title, line, track, next, actions);
    card = { title, line, bar, track, next, actions };
    return box;
  };

  const fillCard = () => {
    if (!card) return;
    const c = liveCard(live.status, live.slots, live.now, t, clock);
    card.title.textContent = c.title;
    card.line.textContent = c.line;
    card.line.hidden = !c.line;
    card.track.hidden = c.progress === null;
    if (c.progress !== null) {
      card.bar.style.transform = `scaleX(${c.progress})`;
      card.track.setAttribute('aria-valuenow', String(Math.round(c.progress * 100)));
    }
    card.next.textContent = c.next;
    card.next.hidden = !c.next;
    const imaging = live.status.kind === 'active';
    const wanted = imaging ? 'skip,extend,stop' : 'stop';
    if (card.actions.dataset.shown !== wanted) {
      card.actions.dataset.shown = wanted;
      card.actions.replaceChildren(
        ...(imaging
          ? [
              button(t('live.skip'), () => live.skip()),
              button(t('live.extend'), () => live.extend()),
            ]
          : []),
        button(t('live.stop'), () => live.stop()),
      );
    }
  };

  const refresh = () => {
    const isLive = live.state?.planId === plan.id;
    const want = isLive ? 'live' : live.canStart(plan) ? 'start' : 'none';
    if (want !== shown) {
      shown = want;
      card = null;
      if (want === 'live') el.replaceChildren(buildCard(), buildAlerts());
      else if (want === 'start')
        el.replaceChildren(button(t('live.start'), start, 'btn-confirm self-start'), buildAlerts());
      else el.replaceChildren();
      el.hidden = want === 'none';
    }
    fillCard();
    locked.classList.toggle(LOCKED[0], isLive);
    locked.classList.toggle(LOCKED[1], isLive);
    locked.setAttribute('aria-disabled', isLive ? 'true' : 'false');
    locked.title = isLive ? t('live.locked') : '';
    const current = isLive && live.status.kind === 'active' ? live.status.current.itemId : null;
    for (const row of rows()) {
      const lit = !!current && row.dataset.itemId === current;
      for (const c of CURRENT_ROW) row.classList.toggle(c, lit);
    }
  };

  refresh();
  return { el, refresh };
}
