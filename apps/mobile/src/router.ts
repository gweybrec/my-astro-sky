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
];

export default createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });
