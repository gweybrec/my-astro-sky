import { t } from './i18n';
import type { SkyMap } from './sky-map';
import { useSkyRegionsStore } from './stores/sky-regions';
import { confirmSkyRegionDelete } from './photo-delete-confirm';
import { showToast } from './toast';
import { reportUnknownRendererError } from './error-reporter';
import trashSvg from './icons/trash.svg?raw';

const DEFAULT_REGION_COLOR = '#4ea1ff';

/** Name/color modal shown once a freehand region has been drawn, before saving it. */
function buildSaveRegionModal(
  points: { azDeg: number; altDeg: number }[],
  onSaved: () => void,
  onCancel: () => void,
): void {
  let closed = false;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const close = (cancelled: boolean): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    if (cancelled) onCancel();
  };

  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h2');
  title.textContent = t('targets.skyRegion.saveTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => close(true));
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body modal-form-body';

  const nameRow = document.createElement('div');
  nameRow.className = 'flex flex-col gap-1';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'text-small text-label';
  nameLabel.textContent = t('targets.skyRegion.nameLabel');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'dialog-input';
  nameInput.placeholder = t('targets.skyRegion.namePlaceholder');
  const nameError = document.createElement('span');
  nameError.className = 'input-error-msg hidden';
  nameError.textContent = t('targets.skyRegion.nameRequired');
  nameInput.addEventListener('input', () => {
    nameInput.classList.remove('input-error');
    nameError.classList.add('hidden');
  });
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  nameRow.appendChild(nameError);

  const colorRow = document.createElement('div');
  colorRow.className = 'flex items-center gap-2';
  const colorLabel = document.createElement('label');
  colorLabel.className = 'text-small text-label';
  colorLabel.textContent = t('targets.skyRegion.colorLabel');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'w-8 h-8 flex-none cursor-pointer bg-transparent border-none p-0';
  colorInput.value = DEFAULT_REGION_COLOR;
  colorRow.appendChild(colorLabel);
  colorRow.appendChild(colorInput);

  body.appendChild(nameRow);
  body.appendChild(colorRow);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('targets.gear.cancel');
  cancelBtn.addEventListener('click', () => close(true));

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-confirm';
  saveBtn.textContent = t('targets.gear.save');
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('input-error');
      nameError.classList.remove('hidden');
      nameInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await useSkyRegionsStore().create(name, colorInput.value, points);
      closed = true;
      backdrop.remove();
      onSaved();
    } catch (err) {
      reportUnknownRendererError('sky_region_save', err);
      showToast({ message: t('targets.skyRegion.saveError'), type: 'error' });
      saveBtn.disabled = false;
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => nameInput.focus());
}

/**
 * Starts the "draw a new sky region" flow: forces Local Sky mode on the map, captures
 * a freehand Alt/Az polygon, then opens a name/color modal to save it. No-ops with a
 * toast if no observer location is set (same guard as Local Sky mode itself).
 */
export function openDrawRegionFlow(skyMap: SkyMap, onDone?: () => void): void {
  const started = skyMap.enterRegionDrawMode(
    (points) => {
      buildSaveRegionModal(
        points,
        () => onDone?.(),
        () => onDone?.(),
      );
    },
    () => onDone?.(),
  );
  if (!started) {
    showToast({ message: t('horizon.error.noLocation'), type: 'error' });
  }
}

/**
 * Lists saved regions with view/delete actions, plus a "draw new" entry point.
 * `onFullyClosed` fires once when the user is done with the whole region-management
 * flow (including any draw/manage round-trips) — not on the transient close that
 * happens while switching into draw mode. Callers use it to restore whatever else
 * was hidden to make room for this modal (e.g. the Targets search overlay).
 */
export function openManageRegionsModal(skyMap: SkyMap, onFullyClosed?: () => void): void {
  const store = useSkyRegionsStore();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const closeModalOnly = (): void => {
    skyMap.setActiveRegionOverlay(null);
    backdrop.remove();
  };
  const close = (): void => {
    closeModalOnly();
    onFullyClosed?.();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const modal = document.createElement('div');
  modal.className = 'modal settings-modal';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h2');
  title.textContent = t('targets.skyRegion.manageTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body modal-form-body--scroll';

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-2';
  body.appendChild(list);

  function renderList(): void {
    list.innerHTML = '';
    if (store.regions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-muted text-base px-2 py-2';
      empty.textContent = t('targets.skyRegion.noneSaved');
      list.appendChild(empty);
      return;
    }
    for (const region of store.regions) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';

      const swatch = document.createElement('span');
      swatch.className = 'w-4 h-4 rounded-full flex-none';
      swatch.style.background = region.color;
      row.appendChild(swatch);

      const nameEl = document.createElement('span');
      nameEl.className = 'flex-1 min-w-0 truncate';
      nameEl.textContent = region.name;
      row.appendChild(nameEl);

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'display-controls-btn text-small';
      viewBtn.textContent = t('targets.skyRegion.view');
      viewBtn.addEventListener('click', () => {
        skyMap.setActiveRegionOverlay({ color: region.color, points: region.points });
      });
      row.appendChild(viewBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'integration-row-trash';
      deleteBtn.title = t('targets.skyRegion.delete');
      deleteBtn.innerHTML = trashSvg;
      deleteBtn.addEventListener('click', async () => {
        if (!(await confirmSkyRegionDelete(region.name))) return;
        try {
          await store.remove(region.id);
          renderList();
        } catch (err) {
          reportUnknownRendererError('sky_region_delete', err);
          showToast({ message: t('targets.skyRegion.deleteError'), type: 'error' });
        }
      });
      row.appendChild(deleteBtn);

      list.appendChild(row);
    }
  }

  store.ensureLoaded().then(renderList);
  renderList();

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const drawBtn = document.createElement('button');
  drawBtn.type = 'button';
  drawBtn.className = 'display-controls-btn mr-auto';
  drawBtn.textContent = t('targets.skyRegion.drawNew');
  drawBtn.addEventListener('click', () => {
    closeModalOnly();
    openDrawRegionFlow(skyMap, () => openManageRegionsModal(skyMap, onFullyClosed));
  });
  footer.appendChild(drawBtn);

  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.type = 'button';
  closeFooterBtn.className = 'btn-cancel';
  closeFooterBtn.textContent = t('modal.cancel');
  closeFooterBtn.addEventListener('click', close);
  footer.appendChild(closeFooterBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
