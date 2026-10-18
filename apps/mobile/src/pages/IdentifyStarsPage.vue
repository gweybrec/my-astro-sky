<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { findDSOsInImage } from '@myastrosky/core/catalog/dso-registry';
import { fitPhotoAffine, getCorrRaDec } from '@myastrosky/core/photo-placement';
import { project } from '@myastrosky/core/projection';
import { raDecFromSexagesimal, starDisplayLabel } from '@myastrosky/core/star-identify';
import type { StarSearchResult } from '@myastrosky/core/domain/stars';
import type { PhotoCorrespondence } from '@myastrosky/core/types';
import { searchStarsAPI, uploadPhoto } from '@myastrosky/app-state/api';
import { catalogsReady } from '../catalogs';
import { fittedSize, usePhotoZoom, type Size } from '../composables/usePhotoZoom';
import { useBackClose } from '../composables/useBackClose';
import { useErrorToast } from '../composables/useErrorToast';
import { skyPhotoFocus } from '../composables/useSkySelection';
import { pendingPhotoFile, removePendingPhoto } from '../pending-photos';
import { skyStarPick } from '../sky-modes';
import {
  clearPointStar,
  endIdentify,
  identifyPoints,
  type IdentifyPoint,
  type PhotoPoint,
} from '../star-identify-session';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import checkIcon from '@icons/check.svg?raw';
import mapIcon from '../icons/map.svg?raw';

// The boards "Identifier les étoiles", "…, choisir une étoile" and "…, RA/Déc", as the desktop's star identification
// does it (`openManualIdentifyModal`): a tap on the photo puts the next point on a star, and each point is named by a
// star's name, a star chosen on the map, or its coordinates. A point is dragged to move it, with a magnifier above the
// finger. Valider, once two points are named, stores the photo with these matches and the objects that fall in it.
const route = useRoute();
const router = useRouter();
const { showError } = useErrorToast();

const pendingId = String(route.params.id);
const points = identifyPoints(pendingId);

const file = shallowRef<File | null>(null);
const url = ref('');
const size = ref<Size | null>(null);
const saving = ref(false);

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');
const title = computed(() =>
  t('modal.manualIdentifyTitle', { name: file.value ? stripExtension(file.value.name) : '' }),
);

onMounted(async () => {
  file.value = await pendingPhotoFile(pendingId);
  if (!file.value) {
    await router.replace('/tabs/gallery');
    return;
  }
  url.value = URL.createObjectURL(file.value);
});
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value);
});

function onLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  size.value = { width: img.naturalWidth, height: img.naturalHeight };
}

// ── The points ───────────────────────────────────────────────────────────────────────────────────
// As on the desktop, the point a tap places is the first one not named yet: a placed point that is not named moves
// to the new tap, the next one waits.

const named = (p: IdentifyPoint) => p.star !== null;
const active = computed(() => points.findIndex((p) => !named(p)));
const namedCount = computed(() => points.filter(named).length);

// ── The photo on its stage: zoom, and where a point of the picture is on the screen ────────────────────────────

const area = ref<HTMLElement | null>(null);
const box = reactive({ width: 0, height: 0 });
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!area.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(([entry]) => {
    box.width = entry.contentRect.width;
    box.height = entry.contentRect.height;
  });
  observer.observe(area.value);
});
onBeforeUnmount(() => observer?.disconnect());

const { zoom, transform, handlers } = usePhotoZoom(
  area,
  () => size.value ?? { width: 0, height: 0 },
  { onTap: placeAt },
);

/** Screen pixels per picture pixel. */
function pixelScale(): number {
  if (!size.value) return 0;
  return (fittedSize(size.value, box).width / size.value.width) * zoom.value.scale;
}

/** Where a point of the picture is in the photo's area (px from its top left). */
function onScreen(p: PhotoPoint): PhotoPoint {
  const k = pixelScale();
  const { width, height } = size.value ?? { width: 0, height: 0 };
  return {
    x: box.width / 2 + zoom.value.tx + (p.x - width / 2) * k,
    y: box.height / 2 + zoom.value.ty + (p.y - height / 2) * k,
  };
}

/** The point of the picture under a screen position, kept on the picture. */
function onPicture(clientX: number, clientY: number): PhotoPoint | null {
  const rect = area.value?.getBoundingClientRect();
  const k = pixelScale();
  if (!rect || !size.value || k <= 0) return null;
  const { width, height } = size.value;
  return {
    x: (clientX - rect.left - box.width / 2 - zoom.value.tx) / k + width / 2,
    y: (clientY - rect.top - box.height / 2 - zoom.value.ty) / k + height / 2,
  };
}
const onThePicture = (p: PhotoPoint) =>
  !!size.value && p.x >= 0 && p.y >= 0 && p.x <= size.value.width && p.y <= size.value.height;

function placeAt(clientX: number, clientY: number) {
  if (active.value < 0) return;
  const p = onPicture(clientX, clientY);
  if (p && onThePicture(p)) points[active.value].at = p;
}

const markers = computed(() =>
  points.flatMap((p, i) => (p.at ? [{ index: i, ...onScreen(p.at) }] : [])),
);

// ── Dragging a point, with the magnifier ───────────────────────────────────────────────────────────
// The finger hides the star: the magnifier above it shows the picture under the point, larger, with a crosshair.

/** How much larger the magnifier shows the picture than the screen does. */
const MAGNIFY = 3;
const drag = shallowRef<{ index: number; pointer: number; dx: number; dy: number } | null>(null);

function grab(index: number, event: PointerEvent) {
  const at = points[index].at;
  const rect = area.value?.getBoundingClientRect();
  if (!at || !rect) return;
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  const s = onScreen(at);
  drag.value = {
    index,
    pointer: event.pointerId,
    dx: event.clientX - rect.left - s.x,
    dy: event.clientY - rect.top - s.y,
  };
}
function dragMove(event: PointerEvent) {
  const d = drag.value;
  if (!d || d.pointer !== event.pointerId || !size.value) return;
  const p = onPicture(event.clientX - d.dx, event.clientY - d.dy);
  if (!p) return;
  points[d.index].at = {
    x: Math.min(size.value.width, Math.max(0, p.x)),
    y: Math.min(size.value.height, Math.max(0, p.y)),
  };
}
function release(event: PointerEvent) {
  if (drag.value?.pointer === event.pointerId) drag.value = null;
}

const magnifier = computed(() => {
  const d = drag.value;
  const at = d ? points[d.index].at : null;
  if (!at || !size.value) return null;
  const m = pixelScale() * MAGNIFY;
  const cross = 'linear-gradient(var(--text-bright), var(--text-bright))';
  // The picture's point at the magnifier's centre (inside its 2px ring).
  const centre = 'calc(var(--mobile-touch-min) - 2px';
  return {
    index: d!.index,
    // Above the finger, or under it when the point is near the top of the photo.
    below: onScreen(at).y < box.height / 3,
    background: [
      `${cross} center / 1px 100% no-repeat`,
      `${cross} center / 100% 1px no-repeat`,
      `url("${url.value}") ${centre} - ${at.x * m}px) ${centre} - ${at.y * m}px) / ${size.value.width * m}px ${size.value.height * m}px no-repeat`,
      'var(--bg-deep)',
    ].join(', '),
  };
});

// ── Naming a point by a star's name ────────────────────────────────────────────────────────────────
// While a name is typed, the stars found are listed above its field (the keyboard is under it), alone in the panel.

const SEARCH_DELAY_MS = 250;
const typing = ref<number | null>(null);
const results = shallowRef<StarSearchResult[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let blurTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => (typing.value === null ? '' : points[typing.value].query),
  (query) => {
    clearTimeout(searchTimer);
    if (!query) {
      results.value = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      const found = await searchStarsAPI(query);
      if (typing.value !== null && points[typing.value].query === query) results.value = found;
    }, SEARCH_DELAY_MS);
  },
);
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  clearTimeout(blurTimer);
});

function onFocus(index: number) {
  clearTimeout(blurTimer);
  typing.value = index;
}
// As the desktop's list, it closes a moment after the field loses the focus, so that a tap on a star still counts.
function onBlur(index: number) {
  blurTimer = setTimeout(() => {
    if (typing.value === index) typing.value = null;
  }, 200);
}
const suggesting = computed(() =>
  typing.value !== null && results.value.length > 0 ? typing.value : null,
);

function chooseStar(index: number, result: StarSearchResult) {
  points[index].star = { starHip: result.hip, starName: result.label.split(' – ')[0].trim() };
  points[index].query = '';
  results.value = [];
  typing.value = null;
  (document.activeElement as HTMLElement | null)?.blur();
}

// ── Naming a point on the map ──────────────────────────────────────────────────────────────────────

function pickOnMap(index: number) {
  skyStarPick.value = {
    point: index + 1,
    done: (star) => {
      if (star) points[index].star = { starHip: star.hip, starName: starDisplayLabel(star) };
    },
    returnTo: route.fullPath,
  };
  // The map replaces this page and opens it again once the star is chosen: the points wait in the session.
  void router.replace('/tabs/sky');
}

// ── Naming a point by its coordinates ──────────────────────────────────────────────────────────────

function setCoordinates(index: number) {
  const p = raDecFromSexagesimal(points[index].coords);
  if (!p) {
    void showError(new Error(t('modal.invalidCoordinates')));
    return;
  }
  points[index].star = {
    starHip: 0,
    starRa: p.ra,
    starDec: p.dec,
    starName: t('modal.raDecSet', { ra: p.ra.toFixed(2), dec: p.dec.toFixed(2) }),
  };
}

// ── Annuler, Valider ─────────────────────────────────────────────────────────────────────────────

// The photo stays waiting in the gallery, where the identification was asked (this page may have been opened again by
// the map, so going back is not always going to the gallery).
function cancel() {
  endIdentify(pendingId);
  void router.replace('/tabs/gallery');
}
useBackClose(() => true, cancel);

async function validate() {
  if (!file.value || !size.value || namedCount.value < 2 || saving.value) return;
  saving.value = true;
  try {
    const correspondences: PhotoCorrespondence[] = points.flatMap((p, i) =>
      p.at && p.star ? [{ pointIndex: i, photoX: p.at.x, photoY: p.at.y, ...p.star }] : [],
    );
    // The stars' positions and the objects that fall in the photo need the catalogues.
    await catalogsReady();
    const { width, height } = size.value;
    const photoPoints: PhotoPoint[] = [];
    const projPoints: PhotoPoint[] = [];
    for (const c of correspondences) {
      const sky = getCorrRaDec(c);
      if (!sky) continue;
      photoPoints.push({ x: c.photoX, y: c.photoY });
      projPoints.push(project(sky.ra, sky.dec));
    }
    let dsoIds: string[] = [];
    try {
      dsoIds = findDSOsInImage(fitPhotoAffine(photoPoints, projPoints), width, height).map(
        (dso) => dso.id,
      );
    } catch {
      // Points on one line give no placement to look in: the photo is stored without objects.
    }
    const photo = await uploadPhoto(file.value, correspondences, undefined, undefined, {
      dsoIds,
      displayName: stripExtension(file.value.name),
    });
    await removePendingPhoto(pendingId);
    endIdentify(pendingId);
    // As the hand placement: the map shows the photo where it now is.
    skyPhotoFocus.value = photo.id;
    await router.replace('/tabs/sky');
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-map-mode mob-identify-frame">
        <header class="mob-topbar">
          <PhoneBackButton :action="cancel" />
          <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
        </header>
        <main class="mob-stage mob-photo-stage" v-on="handlers">
          <div ref="area" class="mob-photo-area">
            <img
              v-if="url"
              class="mob-photo-view"
              :src="url"
              :alt="file?.name"
              :style="{ transform }"
              draggable="false"
              @load="onLoad"
            />
            <!-- A point of the photo: its marker, and the magnifier while it is dragged, are centred on it by layout. -->
            <div
              v-for="m in markers"
              :key="m.index"
              class="mob-identify-anchor"
              :style="{ left: `${m.x}px`, top: `${m.y}px` }"
            >
              <button
                type="button"
                class="mob-marker"
                :class="{ 'mob-marker--active': m.index === active }"
                :aria-label="t('mobile.identify.point', { n: m.index + 1 })"
                @pointerdown.stop="grab(m.index, $event)"
                @pointermove="dragMove"
                @pointerup="release"
                @pointercancel="release"
              >
                <span class="mob-marker-dot m-secondary">{{ m.index + 1 }}</span>
              </button>
              <div
                v-if="magnifier?.index === m.index"
                class="mob-magnifier"
                :class="magnifier.below ? 'mob-identify-below' : 'mob-identify-above'"
                :style="{ background: magnifier.background }"
              />
            </div>
          </div>
        </main>
        <section class="mob-panel mob-identify-panel" :aria-label="t('mobile.identify.points')">
          <!-- The points scroll when the panel is short (landscape, keyboard); Annuler and Valider stay under them. -->
          <div class="mob-identify-points mob-scroll">
            <div
              v-show="suggesting !== null"
              id="star-suggest"
              role="listbox"
              :aria-label="t('mobile.identify.suggestions')"
            >
              <button
                v-for="r in results"
                :key="r.hip"
                type="button"
                class="mob-row"
                role="option"
                :aria-selected="false"
                @pointerdown.prevent
                @click="suggesting !== null && chooseStar(suggesting, r)"
              >
                <span class="mob-row-body">
                  <span class="mob-row-title m-body">{{ r.label }}</span>
                </span>
                <span class="mob-row-trail m-secondary">mag {{ r.mag.toFixed(1) }}</span>
              </button>
            </div>
            <!-- The list, the other points, the instructions and the buttons are hidden, not removed, while stars are listed:
                 a row moved by Vue would lose the focus of its field, and the list would close. -->
            <div
              v-for="(p, i) in points"
              v-show="suggesting === null || suggesting === i"
              :key="i"
              class="mob-identify-point"
            >
              <!-- Named: a tap names it again (the desktop's tap on a named point). -->
              <button v-if="p.star" type="button" class="mob-row" @click="clearPointStar(p)">
                <span class="mob-row-lead m-body-strong">{{ i + 1 }}</span>
                <span class="mob-row-body">
                  <span class="mob-row-title m-body">{{ p.star.starName }}</span>
                </span>
                <span class="mob-row-trail mob-row-trail--cell mob-status--success">
                  <AppIcon :svg="checkIcon" />
                </span>
              </button>
              <div v-else-if="p.at && p.entry === 'star'" class="mob-row">
                <span class="mob-row-lead m-body-strong">{{ i + 1 }}</span>
                <span class="mob-row-body">
                  <PhoneSearch
                    v-model="p.query"
                    field
                    clearable
                    :placeholder="t('mobile.identify.starPlaceholder')"
                    :label="t('mobile.identify.starName', { n: i + 1 })"
                    @focus="onFocus(i)"
                    @blur="onBlur(i)"
                  />
                </span>
                <PhoneButton icon :aria-label="t('modal.mapPickTooltip')" @click="pickOnMap(i)">
                  <AppIcon :svg="mapIcon" />
                </PhoneButton>
                <PhoneButton :title="t('modal.raDecTooltip')" @click="p.entry = 'radec'">
                  {{ t('modal.raDecMode') }}
                </PhoneButton>
              </div>
              <div
                v-else-if="p.at"
                class="mob-coord"
                role="group"
                :aria-label="t('mobile.identify.point', { n: i + 1 })"
              >
                <span class="mob-row-lead m-body-strong">{{ i + 1 }}</span>
                <span class="mob-coord-label m-body">{{ t('modal.raLabel') }}</span>
                <div class="mob-coord-fields">
                  <PhoneField
                    v-model="p.coords.raHours"
                    bare
                    inputmode="decimal"
                    :aria-label="t('modal.raHours')"
                  />
                  <span class="mob-coord-unit m-body" aria-hidden="true">h</span>
                  <PhoneField
                    v-model="p.coords.raMinutes"
                    bare
                    inputmode="decimal"
                    :aria-label="t('modal.raMinutes')"
                  />
                  <span class="mob-coord-unit m-body" aria-hidden="true">m</span>
                  <PhoneField
                    v-model="p.coords.raSeconds"
                    bare
                    inputmode="decimal"
                    :aria-label="t('modal.raSeconds')"
                  />
                  <span class="mob-coord-unit m-body" aria-hidden="true">s</span>
                </div>
                <span class="mob-coord-label m-body">{{ t('modal.decLabel') }}</span>
                <div class="mob-coord-fields">
                  <!-- The degrees may be negative: a number keyboard with its minus sign. -->
                  <PhoneField
                    v-model="p.coords.decDegrees"
                    bare
                    type="number"
                    :aria-label="t('modal.decDegrees')"
                  />
                  <span class="mob-coord-unit m-body" aria-hidden="true">°</span>
                  <PhoneField
                    v-model="p.coords.decMinutes"
                    bare
                    inputmode="decimal"
                    :aria-label="t('modal.decMinutes')"
                  />
                  <span class="mob-coord-unit m-body" aria-hidden="true">'</span>
                  <PhoneField
                    v-model="p.coords.decSeconds"
                    bare
                    inputmode="decimal"
                    :aria-label="t('modal.decSeconds')"
                  />
                  <span class="mob-coord-unit m-body" aria-hidden="true">"</span>
                </div>
                <div class="mob-coord-actions">
                  <PhoneButton :title="t('modal.starModeTooltip')" @click="p.entry = 'star'">
                    {{ t('modal.starMode') }}
                  </PhoneButton>
                  <PhoneButton @click="setCoordinates(i)">OK</PhoneButton>
                </div>
              </div>
              <div v-else class="mob-row">
                <span class="mob-row-lead m-body-strong">{{ i + 1 }}</span>
                <span class="mob-row-body">
                  <span class="mob-row-title m-secondary">
                    {{ i === active ? t('mobile.identify.tapPhoto') : t('modal.waiting') }}
                  </span>
                </span>
              </div>
            </div>
            <PhoneHelper v-show="suggesting === null">{{
              t('mobile.gallery.identifyStarsSub')
            }}</PhoneHelper>
          </div>
          <div v-show="suggesting === null" class="mob-sheet-footer">
            <PhoneButton size="lg" @click="cancel">{{ t('modal.cancel') }}</PhoneButton>
            <PhoneButton
              variant="confirm"
              size="lg"
              :disabled="namedCount < 2 || !size || saving"
              @click="validate"
            >
              {{ saving ? t('manual.processing') : t('modal.validate') }}
            </PhoneButton>
          </div>
        </section>
      </div>
    </IonContent>
  </IonPage>
</template>
