import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import {
  errorReportText,
  needsErrorRef,
  userMessage,
  type ErrorTicket,
} from '@myastrosky/core/platform/error-report';
import copySvg from './icons/copy.svg?raw';

type ToastType = 'info' | 'error' | 'undo' | 'warning';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
  onExpire?: () => void;
  /** An error's code and reference, shown under the message with a button that copies them. */
  ticket?: ErrorTicket;
}

/** An error toast with a reference stays long enough to read it and copy it. */
const TICKET_TOAST_MS = 8000;

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (!container?.isConnected) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function platformName(): string {
  return window.myAstroDiagnostics ? 'Desktop' : 'Web';
}

/** The message, then the reference line with its copy button. */
function ticketBody(message: string, ticket: ErrorTicket): HTMLElement {
  const body = document.createElement('div');
  body.className = 'flex flex-col gap-1';
  const msg = document.createElement('span');
  msg.textContent = message;
  const refRow = document.createElement('div');
  // Same colour as the message (the toast's own, red for an error), smaller.
  refRow.className = 'flex items-center gap-3 text-small';
  const ref = document.createElement('span');
  ref.className = 'select-text';
  ref.dataset.testid = 'toast-ref';
  ref.textContent = `${t('errors.reference')} ${ticket.code} · ${ticket.ref}`;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn-icon !py-0.5 !px-1.5 !text-small [&>svg]:w-3.5 [&>svg]:h-3.5';
  copy.title = t('errors.copyDetails');
  copy.setAttribute('aria-label', t('errors.copyDetails'));
  copy.innerHTML = copySvg;
  copy.addEventListener('click', () => {
    const text = errorReportText(ticket, { version: __APP_VERSION__, platform: platformName() });
    navigator.clipboard
      .writeText(text)
      .then(() => showToast({ message: t('errors.detailsCopied'), duration: 2000 }))
      .catch((err: unknown) => reportError('toast: copy error details', err));
  });
  refRow.append(ref, copy);
  body.append(msg, refRow);
  return body;
}

export function showToast(opts: ToastOptions): () => void {
  const el = document.createElement('div');
  el.className = `toast toast-${opts.type || 'info'}`;
  if (opts.type === 'error') el.setAttribute('role', 'alert');

  if (opts.ticket) {
    el.appendChild(ticketBody(opts.message, opts.ticket));
  } else {
    const msgSpan = document.createElement('span');
    msgSpan.textContent = opts.message;
    el.appendChild(msgSpan);
  }

  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      opts.onAction!();
      dismiss();
    });
    el.appendChild(btn);
  }

  const parent = ensureContainer();
  parent.appendChild(el);

  const duration = opts.duration ?? (opts.ticket ? TICKET_TOAST_MS : 4000);
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expire = () => {
    expired = true;
    opts.onExpire?.();
    dismiss();
  };
  const start = () => {
    timer = setTimeout(expire, duration);
  };
  start();
  if (opts.ticket) {
    // Stays while the pointer is on it, so the reference can be read and copied.
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);
  }

  function dismiss() {
    clearTimeout(timer);
    el.classList.add('toast-fade-out');
    el.addEventListener('animationend', () => el.remove());
  }

  return () => {
    if (!expired) {
      clearTimeout(timer);
      dismiss();
    }
  };
}

/**
 * Shows a caught error: its text for the user (never the raw message of a bug; `fallbackKey`
 * then), and for a failure of the app, a server or the network, records it in the log and shows
 * its code and reference. `category` names it in the log (`fallbackKey` when absent).
 */
export function showErrorToast(
  err: unknown,
  fallbackKey: string,
  options: {
    category?: string;
    context?: Record<string, unknown>;
    duration?: number;
    /** The text to show instead of the error's own, already translated. */
    message?: string;
  } = {},
): () => void {
  const message = options.message ?? userMessage(err, fallbackKey);
  const ticket = needsErrorRef(err)
    ? reportError(options.category ?? fallbackKey, err, options.context)
    : undefined;
  return showToast({ message, type: 'error', duration: options.duration, ticket });
}
