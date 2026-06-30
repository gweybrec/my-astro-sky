import type { Photo, PoiCategory } from './types';
import { buildMetadataEditorPanel } from './metadata-editor';
import { t } from './i18n';
import { confirmPhotoDelete, confirmUnsavedChanges } from './photo-delete-confirm';
import { createLazyObserver } from './lazy-image';
import { getDSOById } from './dso-catalog';
import { createImageZoomPan } from './image-zoom';
import { buildPoiFilterGroups, poisMatchFilter, type PoiFilterGroup } from './poi';
import { poiTypeIcon } from './poi-icons';

/**
 * Smart sorting for astronomical catalog names
 * e.g., M31, M100, NGC224, NGC1976, IC1805, SH2-106
 * Ensures M100 comes after M99, not before M2
 */
export function smartSortPhotos(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    const nameA = a.originalName;
    const nameB = b.originalName;

    // Extract catalog prefix and number if present
    const parseFilename = (name: string): { catalog: string; number: number | null; rest: string } => {
      // Match patterns like M31, NGC224, IC1805, SH2-106, Sh2-106, etc.
      const match = name.match(/^([A-Za-z]+)[\s-]?(\d+)/);
      if (match) {
        const catalog = match[1].toUpperCase();
        const number = parseInt(match[2], 10);
        const rest = name.substring(match[0].length);
        return { catalog, number, rest };
      }
      return { catalog: '', number: null, rest: name };
    };

    const parsedA = parseFilename(nameA);
    const parsedB = parseFilename(nameB);

    // If both have catalog prefixes
    if (parsedA.number !== null && parsedB.number !== null) {
      // First sort by catalog name (M before NGC before IC, etc.)
      const catalogCompare = parsedA.catalog.localeCompare(parsedB.catalog);
      if (catalogCompare !== 0) return catalogCompare;

      // Then by catalog number
      if (parsedA.number !== parsedB.number) {
        return parsedA.number - parsedB.number;
      }

      // Finally by the rest of the filename
      return parsedA.rest.localeCompare(parsedB.rest);
    }

    // If only one has a catalog prefix, it comes first
    if (parsedA.number !== null) return -1;
    if (parsedB.number !== null) return 1;

    // Neither has catalog prefix, use simple alphabetical
    return nameA.localeCompare(nameB);
  });
}


export class Gallery {
  private container: HTMLElement;
  private hero: HTMLElement;
  private grid: HTMLElement;
  private photos: Photo[] = [];
  private filteredPhotos: Photo[] = [];
  private filterByDSOTypes: string[] | null = null;
  private filterByDSOCatalogs: string[] | null = null;
  private filterByLabels: string[] | null = null;
  // Two-level POI filter: categoryId → set of selected names (empty set ⇒ whole
  // category). null ⇒ no POI filter (every photo passes).
  private filterByPois: Map<string, Set<string>> | null = null;
  private poiCategories: PoiCategory[] = [];
  private searchQuery: string = '';
  private lazyObserver: IntersectionObserver;
  private carouselTimer: ReturnType<typeof setInterval> | null = null;
  private _carouselAdvance: (() => void) | null = null;
  onNavigateToMap: ((photo: Photo) => void) | null = null;
  onPhotoMetadataUpdated: ((photo: Photo) => void) | null = null;
  onDeletePhoto: ((photo: Photo) => void) | null = null;

  constructor() {
    this.container = document.getElementById('gallery-container')!;
    this.hero = document.getElementById('gallery-hero')!;
    this.grid = document.getElementById('gallery-grid')!;
    this.lazyObserver = createLazyObserver({
      scrollRoot: this.container,
      rootMargin: '400px 0px',
      onVisible: (el) => {
        const img = el.querySelector<HTMLImageElement>('img');
        if (img && !img.src) img.src = img.dataset.src ?? '';
      },
    });
  }

  loadPhotos(photos: Photo[]) {
    this.photos = smartSortPhotos(photos);
    this.renderCarousel();
    this.applyFilters();
  }

  setDSOTypeFilter(types: string[]) {
    this.filterByDSOTypes = types.length > 0 ? types : null;
    this.applyFilters();
  }

  setDSOCatalogFilter(catalogs: string[]) {
    this.filterByDSOCatalogs = catalogs.length > 0 ? catalogs : null;
    this.applyFilters();
  }

  setLabelFilter(labels: string[] | null) {
    this.filterByLabels = (labels && labels.length > 0) ? labels : null;
    this.applyFilters();
  }

  setSearchQuery(query: string) {
    this.searchQuery = query.toLowerCase().trim();
    this.applyFilters();
  }

  /** Provide the live category list so POI chips/filters resolve names + orphans. */
  setPoiCategories(categories: PoiCategory[]) {
    this.poiCategories = categories;
    this.applyFilters();
  }

  /** Two-level POI filter; an empty map (or null) disables it. */
  setPoiFilter(selected: Map<string, Set<string>> | null) {
    this.filterByPois = selected && selected.size > 0 ? selected : null;
    this.applyFilters();
  }

  /** POI filter groups (category → distinct names with per-photo counts). */
  getAllPois(): PoiFilterGroup[] {
    return buildPoiFilterGroups(this.photos.map(p => p.pointsOfInterest ?? []), this.poiCategories);
  }

  /** The photos currently passing the active filters, in display (smart-sorted) order. */
  getFilteredPhotos(): Photo[] {
    return [...this.filteredPhotos];
  }

  getAllLabels(): { label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const p of this.photos) {
      const labels = p.labels.length ? p.labels : ['(no label)'];
      for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private applyFilters() {
    let filtered = [...this.photos];

    // Filter by search query — filename, dsoIds, labels, notes
    if (this.searchQuery) {
      const q = this.searchQuery;
      filtered = filtered.filter(photo =>
        photo.originalName.toLowerCase().includes(q) ||
        photo.dsoIds.some(id => id.toLowerCase().includes(q)) ||
        photo.labels.some(l => l.toLowerCase().includes(q)) ||
        (photo.pointsOfInterest ?? []).some(p => p.name.toLowerCase().includes(q)) ||
        photo.notes.toLowerCase().includes(q)
      );
    }

    // Filter by labels — null means no filter; (no label) sentinel controls unlabelled photos
    if (this.filterByLabels !== null) {
      const sel = this.filterByLabels;
      filtered = filtered.filter(photo =>
        photo.labels.length === 0
          ? sel.includes('(no label)')
          : photo.labels.some(l => sel.includes(l))
      );
    }

    // Filter by DSO types — photos with no DSO always pass; others need at least one match
    if (this.filterByDSOTypes && this.filterByDSOTypes.length > 0) {
      const sel = this.filterByDSOTypes;
      filtered = filtered.filter(photo =>
        photo.dsoIds.length === 0 ||
        photo.dsoIds.some(id => {
          const dso = getDSOById(id);
          return dso && sel.includes(dso.type);
        })
      );
    }

    // Filter by DSO catalogs — check dsoIds if present, fall back to originalName
    if (this.filterByDSOCatalogs && this.filterByDSOCatalogs.length > 0) {
      const sel = this.filterByDSOCatalogs;
      const matchesCatalog = (name: string): boolean => {
        const upper = name.toUpperCase();
        return sel.some(cat => {
          const p = cat.toUpperCase();
          return upper.startsWith(p + ' ') ||
            upper.startsWith(p + '-') ||
            upper === p ||
            (upper.startsWith(p) && upper.length > p.length && /[\d\s\-]/.test(upper[p.length]));
        });
      };
      filtered = filtered.filter(photo =>
        photo.dsoIds.length > 0
          ? photo.dsoIds.some(id => matchesCatalog(id))
          : matchesCatalog(photo.originalName)
      );
    }

    // Two-level POI filter — only photos with ≥1 selected POI pass (positive selection).
    if (this.filterByPois) {
      filtered = filtered.filter(photo =>
        poisMatchFilter(photo.pointsOfInterest ?? [], this.poiCategories, this.filterByPois)
      );
    }

    this.filteredPhotos = filtered;
    this.renderMosaic();
  }

  private buildChips(dsoIds: string[], labels: string[], pois: import('./types').PointOfInterest[] = []): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'gallery-item-chips';
    for (const poi of pois) {
      const cat = this.poiCategories.find(c => c.id === poi.categoryId);
      const icon = poiTypeIcon(poi.categoryId);
      const chip = document.createElement('span');
      chip.className = icon ? 'tag-chip poi-chip poi-chip--icon' : 'tag-chip poi-chip';
      chip.style.setProperty('--poi-color', cat?.color ?? '#888888');
      if (cat) chip.title = cat.name;
      if (icon) {
        const marker = document.createElement('span');
        marker.className = 'poi-marker';
        marker.innerHTML = icon;
        chip.appendChild(marker);
      }
      chip.appendChild(document.createTextNode(poi.name));
      wrap.appendChild(chip);
    }
    for (const label of labels) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip label-chip';
      chip.textContent = label;
      wrap.appendChild(chip);
    }
    for (const id of dsoIds) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = id;
      wrap.appendChild(chip);
    }
    return wrap;
  }

  private renderCarousel() {
    this.stopCarouselTimer();
    this._carouselAdvance = null;
    this.hero.innerHTML = '';
    if (this.photos.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gallery-empty';
      const title = document.createElement('div');
      title.className = 'gallery-empty-title';
      title.textContent = t('gallery.noPhotos') || 'No photos yet';
      const sub = document.createElement('div');
      sub.className = 'gallery-empty-sub';
      sub.textContent = t('gallery.noPhotosHint') || 'Add your first astrophoto from the Sky Map panel';
      empty.appendChild(title);
      empty.appendChild(sub);
      this.hero.appendChild(empty);
      return;
    }
    this.hero.appendChild(this.buildCarousel());
    if (this.container.style.display !== 'none') {
      this.startCarouselTimer();
    }
  }

  private renderMosaic() {
    this.lazyObserver.disconnect();
    this.grid.innerHTML = '';

    if (this.photos.length === 0) return;

    if (this.filteredPhotos.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gallery-empty';
      const title = document.createElement('div');
      title.className = 'gallery-empty-title';
      title.textContent = t('gallery.noMatches') || 'No matching photos';
      empty.appendChild(title);
      this.grid.appendChild(empty);
      return;
    }

    // ── Mosaic: filtered photos in sorted order ───────────────────────────────
    const mosaic = document.createElement('div');
    mosaic.className = 'gallery-mosaic';

    for (const photo of this.filteredPhotos) {
      const item = document.createElement('div');
      item.className = 'gallery-item';

      const img = document.createElement('img');
      const src = photo.thumbFilename
        ? `/uploads/${photo.thumbFilename}`
        : `/uploads/${photo.filename}`;
      img.dataset.src = src;
      img.alt = photo.originalName;
      img.style.visibility = 'hidden';

      const placeholder = document.createElement('div');
      placeholder.className = 'gallery-img-placeholder';

      img.onload = () => { img.style.visibility = ''; placeholder.remove(); };

      const caption = document.createElement('div');
      caption.className = 'gallery-item-caption';

      const nameEl = document.createElement('div');
      nameEl.className = 'gallery-item-name';
      nameEl.textContent = photo.originalName;
      caption.appendChild(nameEl);

      if (photo.dsoIds.length > 0 || photo.labels.length > 0 || (photo.pointsOfInterest?.length ?? 0) > 0) {
        caption.appendChild(this.buildChips(photo.dsoIds, photo.labels, photo.pointsOfInterest ?? []));
      }

      item.appendChild(img);
      item.appendChild(placeholder);
      item.appendChild(caption);

      // Parallax tilt on hover
      item.addEventListener('mousemove', (e) => {
        const r = item.getBoundingClientRect();
        const rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
        const ry = ((e.clientX - r.left) / r.width - 0.5) * 6;
        item.style.setProperty('--rx', `${rx}deg`);
        item.style.setProperty('--ry', `${ry}deg`);
        item.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      });
      item.addEventListener('mouseleave', () => {
        item.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg)';
      });

      item.addEventListener('click', () => this.openDetailModal(photo));
      mosaic.appendChild(item);
      this.lazyObserver.observe(item);
    }

    this.grid.appendChild(mosaic);

    const checkChipOverflow = () => {
      mosaic.querySelectorAll<HTMLElement>('.gallery-item-chips').forEach(chips => {
        chips.classList.toggle('gallery-item-chips--overflows', chips.scrollHeight > chips.clientHeight);
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(checkChipOverflow));
    setTimeout(checkChipOverflow, 150);
  }

  private buildCarousel(): HTMLElement {
    const photos = [...this.photos];
    // Fisher-Yates shuffle for discovery surprise
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }

    let index = 0;
    const total = photos.length;

    const wrap = document.createElement('div');
    wrap.className = 'gallery-carousel';

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'gallery-carousel-img-wrap';

    const imgEl = document.createElement('img');
    imgEl.className = 'gallery-carousel-img';
    imgEl.draggable = false;

    const captionEl = document.createElement('div');
    captionEl.className = 'gallery-hero-caption';

    const nameEl = document.createElement('div');
    nameEl.className = 'gallery-hero-name';
    captionEl.appendChild(nameEl);

    const chipsEl = document.createElement('div');
    chipsEl.className = 'gallery-hero-chips';
    captionEl.appendChild(chipsEl);

    const updateCaption = (photo: Photo) => {
      nameEl.textContent = photo.originalName;
      chipsEl.innerHTML = '';
      for (const label of photo.labels) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip label-chip';
        chip.textContent = label;
        chipsEl.appendChild(chip);
      }
      for (const id of photo.dsoIds) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = id;
        chipsEl.appendChild(chip);
      }
    };

    let counterEl: HTMLElement | null = null;

    const goTo = (i: number, animate = true) => {
      index = ((i % total) + total) % total;
      const photo = photos[index];
      if (animate) {
        imgEl.style.opacity = '0';
        setTimeout(() => {
          imgEl.src = `/uploads/${photo.filename}`;
          imgEl.alt = photo.originalName;
          updateCaption(photo);
          imgEl.style.opacity = '';
        }, 250);
      } else {
        imgEl.src = `/uploads/${photo.filename}`;
        imgEl.alt = photo.originalName;
        updateCaption(photo);
      }
      if (counterEl) counterEl.textContent = `${index + 1} / ${total}`;
    };

    if (total > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'gallery-carousel-btn gallery-carousel-prev';
      prevBtn.innerHTML = '&#8249;';
      prevBtn.title = 'Previous';
      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); goTo(index - 1); this.resetCarouselTimer(); });

      const nextBtn = document.createElement('button');
      nextBtn.className = 'gallery-carousel-btn gallery-carousel-next';
      nextBtn.innerHTML = '&#8250;';
      nextBtn.title = 'Next';
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); goTo(index + 1); this.resetCarouselTimer(); });

      counterEl = document.createElement('div');
      counterEl.className = 'gallery-carousel-counter';
      counterEl.textContent = `1 / ${total}`;

      imgWrapper.appendChild(prevBtn);
      imgWrapper.appendChild(nextBtn);
      imgWrapper.appendChild(counterEl);

      wrap.setAttribute('tabindex', '0');
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); this.resetCarouselTimer(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); this.resetCarouselTimer(); }
      });

      this._carouselAdvance = () => goTo(index + 1);
    }

    goTo(0, false);

    imgWrapper.addEventListener('click', () => this.openDetailModal(photos[index]));
    imgWrapper.appendChild(imgEl);
    wrap.appendChild(imgWrapper);
    wrap.appendChild(captionEl);

    return wrap;
  }

  private openDetailModal(photo: Photo) {
    const overlay = document.createElement('div');
    overlay.className = 'gallery-cinematic-overlay';

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    let zoom: ReturnType<typeof createImageZoomPan> | null = null;
    let metaPanelTeardown: (() => void) | null = null;
    let metaPanelIsDirty: (() => boolean) | null = null;

    const rawClose = () => {
      document.removeEventListener('keydown', onKey);
      zoom?.destroy();
      metaPanelTeardown?.();
      overlay.remove();
    };

    const close = async (): Promise<boolean> => {
      if (metaPanelIsDirty?.()) {
        const discard = await confirmUnsavedChanges();
        if (!discard) return false;
      }
      rawClose();
      return true;
    };

    // ── Arrow-key navigation to the adjacent photo in the gallery ─────────────
    const navigate = async (delta: number) => {
      // Navigate within the active filtered list when the photo belongs to it,
      // otherwise fall back to the full set (e.g. opened from the carousel).
      const list = this.filteredPhotos.some(p => p.id === photo.id)
        ? this.filteredPhotos
        : this.photos;
      if (list.length < 2) return;
      const curIdx = list.findIndex(p => p.id === photo.id);
      if (curIdx === -1) return;
      const next = list[((curIdx + delta) % list.length + list.length) % list.length];
      if (next.id === photo.id) return;
      if (metaPanelIsDirty?.()) {
        const discard = await confirmUnsavedChanges();
        if (!discard) return;
      }
      rawClose();
      this.openDetailModal(next);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      // Don't hijack arrow keys while typing in the metadata editor fields.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
    };
    document.addEventListener('keydown', onKey);

    // ── Image ────────────────────────────────────────────────────────────────
    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;padding-right:340px;box-sizing:border-box;';

    const img = document.createElement('img');
    img.src = `/uploads/${photo.filename}`;
    img.alt = photo.originalName;
    img.className = 'gallery-cinematic-img';
    img.draggable = false;
    img.addEventListener('dragstart', (e) => e.preventDefault());
    img.style.userSelect = 'none';
    (img as any).style.webkitUserDrag = 'none';

    imgWrap.appendChild(img);

    // ── Close button ─────────────────────────────────────────────────────────
    const closeBtn = document.createElement('button');
    closeBtn.className = 'gallery-cinematic-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', close);

    // ── Metadata pane (slides in from right) ─────────────────────────────────
    const meta = document.createElement('div');
    meta.className = 'gallery-cinematic-meta visible';

    const header = document.createElement('div');
    header.className = 'gallery-detail-header';

    const nameRow = document.createElement('div');
    nameRow.className = 'gallery-detail-name-row';

    const photoName = document.createElement('div');
    photoName.className = 'gallery-detail-name';
    photoName.textContent = photo.originalName;

    const metaCloseBtn = document.createElement('button');
    metaCloseBtn.className = 'gallery-detail-close';
    metaCloseBtn.innerHTML = '&times;';
    metaCloseBtn.addEventListener('click', close);

    nameRow.appendChild(photoName);
    nameRow.appendChild(metaCloseBtn);

    const showOnMapBtn = document.createElement('button');
    showOnMapBtn.className = 'btn-action';
    showOnMapBtn.textContent = t('gallery.showOnMap');
    showOnMapBtn.addEventListener('click', async () => {
      if (await close()) this.onNavigateToMap?.(photo);
    });

    header.appendChild(nameRow);
    header.appendChild(showOnMapBtn);
    meta.appendChild(header);

    const formContainer = document.createElement('div');
    formContainer.className = 'gallery-detail-form';
    const metaPanel = buildMetadataEditorPanel(formContainer, photo, (updated) => {
      const idx = this.photos.findIndex(p => p.id === updated.id);
      if (idx !== -1) this.photos[idx] = updated;
      this.renderCarousel();
      this.applyFilters();
      this.onPhotoMetadataUpdated?.(updated);
    }, rawClose,
    [...new Set(this.photos.flatMap(p => p.labels))],
    [...new Set(this.photos.flatMap(p => (p.integrations ?? []).map(r => r.filter)).filter(Boolean))]);
    metaPanelTeardown = metaPanel.teardown;
    metaPanelIsDirty = metaPanel.isDirty;
    meta.appendChild(formContainer);

    // Action row: save + delete
    const actionRow = document.createElement('div');
    actionRow.className = 'gallery-detail-actions';

    const builtBtnRow = formContainer.querySelector<HTMLElement>('.meta-editor-btns');
    const saveBtn = formContainer.querySelector<HTMLButtonElement>('.btn-confirm[type="button"]');
    const cancelBtn = formContainer.querySelector<HTMLButtonElement>('.btn-cancel[type="button"]');
    cancelBtn?.remove();
    if (saveBtn) {
      saveBtn.classList.add('gallery-detail-save');
      actionRow.appendChild(saveBtn);
    }
    builtBtnRow?.remove();

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = t('photos.deleteThisPhoto');
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await confirmPhotoDelete(photo.originalName);
      if (!confirmed) return;
      rawClose();
      this.onDeletePhoto?.(photo);
    });
    actionRow.appendChild(deleteBtn);
    meta.appendChild(actionRow);

    // ── Zoom / pan ────────────────────────────────────────────────────────────
    zoom = createImageZoomPan(img, imgWrap);
    const zoomControls = zoom.controls;

    imgWrap.style.cursor = 'grab';
    imgWrap.addEventListener('pointerdown', () => { imgWrap.style.cursor = 'grabbing'; });
    imgWrap.addEventListener('pointerup',   () => { imgWrap.style.cursor = 'grab'; });
    imgWrap.addEventListener('pointercancel', () => { imgWrap.style.cursor = 'grab'; });

    // ── Auto-hide zoom controls after 3s of inactivity ───────────────────────
    const scheduleHide = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        zoomControls.classList.add('hidden');
      }, 3000);
    };

    const showChrome = () => {
      zoomControls.classList.remove('hidden');
      scheduleHide();
    };

    overlay.addEventListener('mousemove', showChrome);
    scheduleHide();

    // Show meta panel when mouse enters right 30% of screen
    overlay.addEventListener('mousemove', (e) => {
      if (e.clientX > window.innerWidth * 0.7) {
        meta.classList.add('visible');
      }
    });

    // ── Assemble ─────────────────────────────────────────────────────────────
    overlay.appendChild(imgWrap);
    overlay.appendChild(closeBtn);
    overlay.appendChild(meta);
    overlay.appendChild(zoomControls);
    document.body.appendChild(overlay);
  }

  private startCarouselTimer() {
    if (!this._carouselAdvance) return;
    this.stopCarouselTimer();
    this.carouselTimer = setInterval(this._carouselAdvance, 20_000);
  }

  private stopCarouselTimer() {
    if (this.carouselTimer !== null) {
      clearInterval(this.carouselTimer);
      this.carouselTimer = null;
    }
  }

  private resetCarouselTimer() {
    this.startCarouselTimer();
  }

  show() {
    this.container.style.display = 'block';
    this.startCarouselTimer();
  }

  hide() {
    this.container.style.display = 'none';
    this.stopCarouselTimer();
  }
}
