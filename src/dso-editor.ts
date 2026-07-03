import type { DSO, DSOType, DSOUserOverride } from './types';
import { upsertDsoOverride, deleteDsoOverride } from './api';
import {
  applyAndStoreSingleOverride,
  resetDsoToBaseValues,
  getDSOCatalogBaseValues,
  getUserOverride,
} from './dso-catalog';
import { t, getLang } from './i18n';
import { showToast } from './toast';

interface ConstellationOption {
  id: string;
  name: string;
}

/**
 * Returns true when a dropdown selection should be persisted as an override.
 * Empty selection or a value matching the catalog base is treated as "no change",
 * which causes any previous override for that field to be removed on save.
 */
export function shouldOverrideConstellation(
  selected: string,
  baseConstellation: string | null | undefined,
): boolean {
  return !!selected && selected !== (baseConstellation ?? '');
}

export function shouldOverrideType(selected: string, baseType: string | null | undefined): boolean {
  return !!selected && selected !== (baseType ?? '');
}

// Pre-load constellation list at module init so the data is ready before the user opens the modal.
const constellationListPromise: Promise<ConstellationOption[]> = fetch('/data/constellations.json')
  .then((r) => r.json())
  .then((json) => {
    const lang = getLang();
    const seen = new Set<string>();
    return (json.features as any[])
      .filter((f) => !seen.has(f.id) && seen.add(f.id)) // deduplicate Serpens (two features, same id)
      .map((f) => ({
        id: f.id as string,
        name: (f.properties[lang] ?? f.properties.name ?? f.id) as string,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })
  .catch(() => [] as ConstellationOption[]);

/**
 * Opens a modal for editing DSO metadata at runtime.
 * Changes are saved to the server and applied in-memory immediately.
 */
export async function openDSOEditModal(dso: DSO, onSaved?: () => void): Promise<void> {
  const constellations = await constellationListPromise;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal dso-editor-modal';

  // Header
  const header = document.createElement('div');
  header.className = 'modal-header';
  const titleEl = document.createElement('h2');
  titleEl.textContent = t('dso.editModalTitle');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => backdrop.remove());
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'modal-body dso-editor-body';

  // DSO id subtitle
  const idLabel = document.createElement('div');
  idLabel.className = 'dso-editor-id';
  idLabel.textContent = dso.catalogs[0] ?? dso.id;
  body.appendChild(idLabel);

  function makeField(
    labelText: string,
    value: string | number | null,
    type: 'text' | 'number' = 'text',
    hint?: string,
  ): { wrapper: HTMLDivElement; input: HTMLInputElement } {
    const wrapper = document.createElement('div');
    wrapper.className = 'dso-editor-field';
    const lbl = document.createElement('label');
    lbl.className = 'dso-editor-label';
    lbl.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.value = value !== null && value !== undefined ? String(value) : '';
    input.className = 'tag-input';
    if (type === 'number') {
      input.step = 'any';
    }
    if (hint) input.placeholder = hint;
    wrapper.appendChild(lbl);
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  // Name fields: value = existing override only, placeholder = base catalog value as hint
  const base = getDSOCatalogBaseValues(dso.id);
  const existingOverride = getUserOverride(dso.id);

  const { wrapper: frWrapper, input: frInput } = makeField(
    t('dso.editNameFr'),
    existingOverride?.names?.fr ?? '',
    'text',
    base?.nameFr ?? '',
  );
  const { wrapper: enWrapper, input: enInput } = makeField(
    t('dso.editNameEn'),
    existingOverride?.names?.en ?? '',
    'text',
    base?.nameEn ?? '',
  );
  const { wrapper: esWrapper, input: esInput } = makeField(
    t('dso.editNameEs'),
    existingOverride?.names?.es ?? '',
    'text',
    base?.nameEs ?? '',
  );
  const { wrapper: deWrapper, input: deInput } = makeField(
    t('dso.editNameDe'),
    existingOverride?.names?.de ?? '',
    'text',
    base?.nameDe ?? '',
  );
  const { wrapper: raWrapper, input: raInput } = makeField(
    t('dso.editRa'),
    existingOverride?.ra !== undefined ? String(existingOverride.ra) : '',
    'number',
    String(base?.ra ?? dso.ra),
  );
  const { wrapper: decWrapper, input: decInput } = makeField(
    t('dso.editDec'),
    existingOverride?.dec !== undefined ? String(existingOverride.dec) : '',
    'number',
    String(base?.dec ?? dso.dec),
  );
  const { wrapper: ratingWrapper, input: ratingInput } = makeField(
    t('dso.editRating'),
    existingOverride?.rating !== undefined ? String(existingOverride.rating) : '',
    'number',
    base?.rating != null ? String(base.rating) : '',
  );
  const { wrapper: diffWrapper, input: diffInput } = makeField(
    t('dso.editDifficulty'),
    existingOverride?.difficulty !== undefined ? String(existingOverride.difficulty) : '',
    'number',
    base?.difficulty != null ? String(base.difficulty) : '',
  );

  ratingInput.min = '1';
  ratingInput.max = '5';
  ratingInput.step = '1';
  diffInput.min = '1';
  diffInput.max = '5';
  diffInput.step = '1';

  // Type select — all valid DSOType codes with human-readable labels
  const typeWrapper = document.createElement('div');
  typeWrapper.className = 'dso-editor-field dso-editor-full-col';
  const typeLbl = document.createElement('label');
  typeLbl.className = 'dso-editor-label';
  typeLbl.textContent = t('dso.editType');
  const typeSelect = document.createElement('select');
  typeSelect.className = 'tag-input';

  const baseType = base?.type ?? null;
  const DSO_TYPE_OPTIONS: DSOType[] = [
    'Gx',
    'GxS',
    'GxE',
    'GxI',
    'OC',
    'GC',
    'EN',
    'RN',
    'PN',
    'SNR',
    'DN',
    '?',
  ];
  for (const code of DSO_TYPE_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = code;
    const isDefault = code === baseType;
    opt.textContent = isDefault
      ? `${code} — ${t('dso.types.' + code)}${t('dso.editConstellationDefaultSuffix')}`
      : `${code} — ${t('dso.types.' + code)}`;
    if (isDefault) {
      opt.style.fontStyle = 'italic';
      opt.style.color = 'grey';
    }
    typeSelect.appendChild(opt);
  }
  // Pre-select the override type; fall back to the catalog base type
  typeSelect.value = existingOverride?.type ?? baseType ?? '';

  typeWrapper.appendChild(typeLbl);
  typeWrapper.appendChild(typeSelect);

  // Constellation select
  const constWrapper = document.createElement('div');
  constWrapper.className = 'dso-editor-field dso-editor-full-col';
  const constLbl = document.createElement('label');
  constLbl.className = 'dso-editor-label';
  constLbl.textContent = t('dso.editConstellation');
  const constSelect = document.createElement('select');
  constSelect.className = 'tag-input';

  const baseConstellation = base?.constellation ?? null;

  for (const c of constellations) {
    const opt = document.createElement('option');
    opt.value = c.id;
    const isDefault = c.id === baseConstellation;
    opt.textContent = isDefault
      ? `${c.name} (${c.id})${t('dso.editConstellationDefaultSuffix')}`
      : `${c.name} (${c.id})`;
    if (isDefault) {
      opt.style.fontStyle = 'italic';
      opt.style.color = 'grey';
    }
    constSelect.appendChild(opt);
  }
  constSelect.value = existingOverride?.constellation ?? baseConstellation ?? '';

  constWrapper.appendChild(constLbl);
  constWrapper.appendChild(constSelect);

  // Names section
  const namesSection = document.createElement('div');
  namesSection.className = 'dso-editor-grid';
  namesSection.appendChild(frWrapper);
  namesSection.appendChild(enWrapper);
  namesSection.appendChild(esWrapper);
  namesSection.appendChild(deWrapper);
  body.appendChild(namesSection);

  // Coords + meta section
  const metaSection = document.createElement('div');
  metaSection.className = 'dso-editor-grid';
  metaSection.appendChild(raWrapper);
  metaSection.appendChild(decWrapper);
  metaSection.appendChild(constWrapper);
  metaSection.appendChild(ratingWrapper);
  metaSection.appendChild(diffWrapper);
  metaSection.appendChild(typeWrapper);
  body.appendChild(metaSection);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'dso-editor-footer';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'display-controls-btn dso-editor-reset-btn';
  resetBtn.textContent = t('dso.editReset');

  const rightBtns = document.createElement('div');
  rightBtns.className = 'dso-editor-btn-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('modal.cancel');

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-confirm';
  saveBtn.textContent = t('dso.save');

  // When true, the form was cleared via "Reset to defaults" and Save should
  // delete the override rather than upsert with catalog values.
  let isReset = false;

  cancelBtn.addEventListener('click', () => backdrop.remove());

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    resetBtn.disabled = true;
    saveBtn.textContent = '…';
    try {
      if (isReset) {
        // User clicked "Reset to defaults" and confirmed via Save
        await deleteDsoOverride(dso.id);
        resetDsoToBaseValues(dso.id);
        showToast({ message: t('dso.editSaved'), type: 'info' });
        backdrop.remove();
        onSaved?.();
        return;
      }
      const override: DSOUserOverride = {};
      const names: DSOUserOverride['names'] = {};
      if (frInput.value.trim()) names.fr = frInput.value.trim();
      if (enInput.value.trim()) names.en = enInput.value.trim();
      if (esInput.value.trim()) names.es = esInput.value.trim();
      if (deInput.value.trim()) names.de = deInput.value.trim();
      if (Object.keys(names).length > 0) override.names = names;

      const ra = parseFloat(raInput.value);
      const dec = parseFloat(decInput.value);
      if (!isNaN(ra)) {
        if (ra < 0 || ra >= 360) throw new Error(t('dso.editErrorRa'));
        if (ra !== dso.ra) override.ra = ra;
      }
      if (!isNaN(dec)) {
        if (dec < -90 || dec > 90) throw new Error(t('dso.editErrorDec'));
        if (dec !== dso.dec) override.dec = dec;
      }
      if (shouldOverrideConstellation(constSelect.value, baseConstellation)) {
        override.constellation = constSelect.value;
      }

      const rating = parseInt(ratingInput.value, 10);
      if (!isNaN(rating) && rating >= 1 && rating <= 5) override.rating = rating;
      const difficulty = parseInt(diffInput.value, 10);
      if (!isNaN(difficulty) && difficulty >= 1 && difficulty <= 5)
        override.difficulty = difficulty;
      if (shouldOverrideType(typeSelect.value, baseType)) {
        override.type = typeSelect.value as DSOType;
      }

      await upsertDsoOverride(dso.id, override);
      applyAndStoreSingleOverride(dso.id, override);
      showToast({ message: t('dso.editSaved'), type: 'info' });
      backdrop.remove();
      onSaved?.();
    } catch (err: any) {
      showToast({ message: err.message ?? 'Error saving override', type: 'error' });
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      resetBtn.disabled = false;
      saveBtn.textContent = t('dso.edit');
    }
  });

  resetBtn.addEventListener('click', () => {
    frInput.value = '';
    enInput.value = '';
    esInput.value = '';
    deInput.value = '';
    raInput.value = '';
    decInput.value = '';
    constSelect.value = baseConstellation ?? '';
    ratingInput.value = '';
    diffInput.value = '';
    typeSelect.value = baseType ?? '';
    isReset = true;
    resetBtn.classList.add('used');
    resetBtn.disabled = true;
  });

  rightBtns.appendChild(cancelBtn);
  rightBtns.appendChild(saveBtn);
  footer.appendChild(resetBtn);
  footer.appendChild(rightBtns);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
