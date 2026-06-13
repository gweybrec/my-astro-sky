import { t } from './i18n';
import closeXSvg from './icons/close-x.svg?raw';

export type SharedSolveState = 'solving' | 'success' | 'failed' | 'canceled' | 'waiting' | 'wcs-ready';

interface RenderSharedSolveStatusOptions {
  container: HTMLElement;
  state: SharedSolveState;
  message: string;
  subMessage?: string;
  detailsHtml?: string;
  diagnostics?: string;       // raw solver output — shown as collapsible <details> on failure
  showCancel?: boolean;
  onCancel?: () => void;
  mode: 'single' | 'batch';
}

export function renderSharedSolveStatus(options: RenderSharedSolveStatusOptions): void {
  const { container, state, message, subMessage, detailsHtml, diagnostics, showCancel, onCancel, mode } = options;

  container.innerHTML = '';

  if (mode === 'single') {
    const statusClass = state === 'canceled' ? 'failed' : state;
    container.className = `auto-solve-status visible ${statusClass}`;
  }

  const row = document.createElement('div');
  row.className = 'shared-solve-status-row';

  if (state === 'solving') {
    const spinner = document.createElement('span');
    spinner.className = 'auto-solve-spinner';
    row.appendChild(spinner);
  }

  const mainText = document.createElement('span');
  if (mode === 'batch') {
    mainText.className = 'batch-status-text';
    if (state === 'success') mainText.classList.add('batch-status-success');
    if (state === 'failed' || state === 'canceled') mainText.classList.add('batch-status-error');
    if (state === 'wcs-ready') mainText.classList.add('batch-status-wcs');
  }
  mainText.textContent = message;
  row.appendChild(mainText);

  if (state === 'solving' && showCancel && onCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'solve-cancel-btn';
    cancelBtn.title = t('modal.cancelSolve');
    cancelBtn.setAttribute('aria-label', t('modal.cancelSolve'));
    cancelBtn.innerHTML = closeXSvg;
    cancelBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onCancel();
    });
    row.appendChild(cancelBtn);
  }

  container.appendChild(row);

  if (subMessage) {
    const sub = document.createElement('div');
    sub.className = 'auto-solve-submsg';
    sub.textContent = subMessage;
    container.appendChild(sub);
  }

  if (detailsHtml) {
    const details = document.createElement('div');
    details.innerHTML = detailsHtml;
    container.appendChild(details);
  }

  if (diagnostics && (state === 'failed' || state === 'canceled')) {
    const details = document.createElement('details');
    details.style.marginTop = '8px';
    const summary = document.createElement('summary');
    summary.className = 'solve-error-summary';
    summary.textContent = t('modal.errorDetailsSummary');
    const pre = document.createElement('pre');
    pre.className = 'solve-error-pre';
    pre.textContent = diagnostics;
    details.appendChild(summary);
    details.appendChild(pre);
    container.appendChild(details);
  }
}
