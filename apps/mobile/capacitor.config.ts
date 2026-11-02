import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gweybrec.myastrosky.app',
  appName: 'MyAstroSky',
  webDir: 'dist',
  // The WebView's colour before the page paints (black otherwise, between the launch screen and the app): the default
  // theme's --bg-app, the launch screen's colour (`ic_launcher_background` in the Android resources).
  backgroundColor: '#0a0e14',
  // Capacitor's own logs print every native call with its options, the astrometry key sent through CapacitorHttp
  // included. Left at its default ('debug'): on in debug builds only, never 'production', which keeps them in release.
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
