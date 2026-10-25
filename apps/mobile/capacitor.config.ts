import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gweybrec.myastrosky.app',
  appName: 'MyAstroSky',
  webDir: 'dist',
  // Capacitor's own logs (on by default in debug builds) print every native call with its options, so the astrometry
  // key sent through CapacitorHttp would show in the WebView console and logcat. The app's own console output is
  // still visible over the WebView debugging connection.
  loggingBehavior: 'none',
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
