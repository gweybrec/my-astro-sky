import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import TabsPage from './pages/TabsPage.vue';

// The five top-level tabs, in the order of the tab bar. A screen opened from a tab is added under it by the
// card that builds that screen.
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/tabs/sky' },
  {
    path: '/tabs/',
    component: TabsPage,
    children: [
      { path: '', redirect: '/tabs/sky' },
      { path: 'sky', component: () => import('./pages/SkyPage.vue') },
      { path: 'gallery', component: () => import('./pages/GalleryPage.vue') },
      { path: 'targets', component: () => import('./pages/TargetsPage.vue') },
      { path: 'plans', component: () => import('./pages/PlansPage.vue') },
      { path: 'settings', component: () => import('./pages/SettingsPage.vue') },
    ],
  },
  // The pages pushed from the Ciel tab: full screen, without the tab bar (boards "Ciel, recherche", "Ciel, ordre
  // d'affichage").
  { path: '/sky/search', component: () => import('./pages/SkySearchPage.vue') },
  { path: '/sky/draw-order', component: () => import('./pages/SkyDrawOrderPage.vue') },
  // The pages pushed from the Réglages tab: full screen, without the tab bar (boards "Réglages, setups", "Équipement,
  // modifier le setup", "Réglages, lieu d'observation", "Réglages, exporter et importer").
  // The pages pushed from the Galerie tab: full screen, without the tab bar (boards "Importer des photos" and
  // "Photo, détail").
  { path: '/gallery/import', component: () => import('./pages/ImportPhotosPage.vue') },
  { path: '/gallery/photo/:id', component: () => import('./pages/PhotoPage.vue') },
  { path: '/gallery/photo/:id/edit', component: () => import('./pages/PhotoEditPage.vue') },
  // A waiting photo placed by naming 2 or 3 of its stars (board "Identifier les étoiles").
  { path: '/gallery/identify/:id', component: () => import('./pages/IdentifyStarsPage.vue') },
  // The page pushed from the Cibles tab: full screen, without the tab bar (board "Cibles, régions du ciel").
  { path: '/targets/regions', component: () => import('./pages/RegionsPage.vue') },
  // The pages pushed from the Plans tab: full screen, without the tab bar (boards "Détail du plan" and "Plan, détail d'une cible").
  { path: '/plans/:id', component: () => import('./pages/PlanDetailPage.vue') },
  { path: '/plans/:id/:entryId', component: () => import('./pages/PlanEntryPage.vue') },
  { path: '/settings/setups', component: () => import('./pages/SetupsPage.vue') },
  { path: '/settings/setups/:id', component: () => import('./pages/SetupEditPage.vue') },
  { path: '/settings/location', component: () => import('./pages/LocationPage.vue') },
  {
    path: '/settings/astrometry-key',
    component: () => import('./pages/AstrometryKeyPage.vue'),
  },
  { path: '/settings/backup', component: () => import('./pages/BackupPage.vue') },
];

// The gallery of the shared components, for the checks: development builds and the alignment check's build (mode
// "check") only. Both conditions are replaced at build time, so the page and its route are not in the app's bundle.
if (import.meta.env.DEV || import.meta.env.MODE === 'check') {
  routes.push({
    path: '/dev/components',
    component: () => import('./pages/DevComponentsPage.vue'),
  });
}

export default createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });
