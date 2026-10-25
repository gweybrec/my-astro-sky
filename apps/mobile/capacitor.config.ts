import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gweybrec.myastrosky.app',
  appName: 'MyAstroSky',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // The frame reads the system bars through env(safe-area-inset-*), never through the --safe-area-inset-* variables
    // that Capacitor's default 'css' mode injects (it logged "Error injecting safe area CSS" at every start, before the
    // page has a body). 'native' keeps the insets handling and only skips that injection.
    SystemBars: {
      insetsHandling: 'native',
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
