import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gweybrec.myastrosky.app',
  appName: 'MyAstroSky',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Lets chrome://inspect attach to the WebView; the Gradle debug build only (release builds ignore it).
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
