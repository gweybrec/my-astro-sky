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
  // The pages pushed from the Réglages tab: full screen, without the tab bar (boards "Réglages, setups", "Équipement,
  // modifier le setup", "Réglages, lieu d'observation", "Réglages, exporter et importer").
  // The page pushed from the Cibles tab: full screen, without the tab bar (board "Cibles, régions du ciel").
  { path: '/targets/regions', component: () => import('./pages/RegionsPage.vue') },
  { path: '/settings/setups', component: () => import('./pages/SetupsPage.vue') },
  { path: '/settings/setups/:id', component: () => import('./pages/SetupEditPage.vue') },
  { path: '/settings/location', component: () => import('./pages/LocationPage.vue') },
  { path: '/settings/backup', component: () => import('./pages/BackupPage.vue') },
];

// The gallery of the shared components, for the checks: development builds only (the condition is replaced at build
// time, so the page and its route are not in the production bundle).
if (import.meta.env.DEV) {
  routes.push({
    path: '/dev/components',
    component: () => import('./pages/DevComponentsPage.vue'),
  });
}

export default createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });
