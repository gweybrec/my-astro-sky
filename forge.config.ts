import path from 'path';
import fs from 'fs';

// These are CJS packages with __esModule:true; jiti resolves `import x from pkg`
// to module.exports.default which is the constructor directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import MakerZIP from '@electron-forge/maker-zip';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import MakerDeb from '@electron-forge/maker-deb';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import MakerSquirrel from '@electron-forge/maker-squirrel';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import MakerDMG from '@electron-forge/maker-dmg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import VitePlugin from '@electron-forge/plugin-vite';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import AutoUnpackNativesPlugin from '@electron-forge/plugin-auto-unpack-natives';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'MyAstroSky',
    executableName: 'MyAstroSky',
    icon: 'build/icons/icon',
    // Remove devDependencies before packaging to avoid copying large dev-only modules.
    prune: true,
    // Ensure packager uses npm (consistent with CI/dev environment)
    packageManager: 'npm',
    // electron-forge/plugin-vite always outputs CJS for the main process bundle.
    // Our package.json has "type":"module" which makes Node treat .js as ESM,
    // causing "require is not defined" at startup.  Remove "type" from the
    // packaged copy so Node falls back to the default (CommonJS).
    afterCopy: [
      (buildPath: string, _ev: string, _pl: string, _ar: string, cb: (err?: Error) => void) => {
        try {
          const pkgPath = path.join(buildPath, 'package.json');
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          delete pkg.type;
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
          cb();
        } catch (err) {
          cb(err as Error);
        }
      },
    ],
    asar: {
      // Unpack native binaries and shared libraries from the asar.
      // .node files: native addons (better-sqlite3, sharp).
      // .so / .so.*: bundled shared libs (e.g. sharp's libvips-cpp.so.x.y.z) —
      //   the OS dynamic linker cannot load .so files from inside an asar archive.
      // stars.14.json: catalog read with fs.readFileSync at runtime (cannot be read from inside asar).
      // *.dll: Windows shared libs (sharp, better-sqlite3) that cannot be loaded from inside asar.
      unpack: '**/{*.node,*.so,*.so.*,*.dll,stars.14.json}',
    },
    // Include runtime dependencies and frontend assets in the packaged app.
    // @electron-forge/plugin-vite's default ignore function keeps only
    // `/.vite` and strips everything else. That breaks native modules
    // (sharp, better-sqlite3) and the static frontend output in `dist/`.
    ignore: (file) => {
      if (!file)
        return false;
      // Exclude swagger.json from production builds (dev-only file)
      if (file === '/public/swagger.json')
        return true;
      // Vite copies public/data/* into dist/data/ at build time — exclude the
      // originals so they are not bundled twice in the asar archive.
      if (file === '/public/data' || file.startsWith('/public/data/'))
        return true;
      return !(
        file === '/package.json' ||
        file === '/node_modules' ||
        file.startsWith('/node_modules/') ||
        file === '/.vite' ||
        file.startsWith('/.vite/') ||
        file === '/dist' ||
        file.startsWith('/dist/') ||
        file === '/public' ||
        file.startsWith('/public/') ||
        // Gear catalog JSON files (PDFs in the same dir are excluded by this pattern)
        file === '/resources' ||
        (file.startsWith('/resources/') && file.endsWith('.json'))
      );
    },
  },
  rebuildConfig: {
    // Force rebuild of native modules (better-sqlite3, sharp) for Electron's ABI.
    // Host Node.js ABI != Electron ABI; without this the app segfaults on launch.
    force: true,
  },
  makers: [
    new MakerSquirrel({
      // Produces MyAstroSkySetup.exe in out/make/squirrel.windows/x64/.
      // Run `npm run electron:make` on Windows to build.
      name: 'MyAstroSky',
      setupExe: 'MyAstroSkySetup.exe',
      setupIcon: 'build/icons/icon.ico',
      description: 'Overlay astrophotos onto an interactive sky map with automatic plate solving.',
    }, ['win32']),
    new MakerZIP({}, ['win32']),
    new MakerZIP({}, ['linux']),
    // macOS: zip the .app (universal-safe, no extra tooling) and a drag-to-install DMG.
    // process.arch is arm64 on macos-14 runners and x64 on macos-13 — embedding it in the
    // DMG name keeps the two matrix builds' filenames unique when attached to one Release
    // (without it both default to MyAstroSky.dmg and collide).
    new MakerZIP({}, ['darwin']),
    new MakerDMG({ name: `MyAstroSky-${process.arch}` }, ['darwin']),
    new MakerDeb({
      options: {
        // Must match packagerConfig.executableName. Otherwise electron-installer-debian
        // defaults `bin` to the sanitized package.json "name" (my-astro-sky) and fails
        // with "could not find the Electron app binary at .../my-astro-sky".
        bin: 'MyAstroSky',
        icon: 'build/icons/icon.png',
        categories: ['Education', 'Science'],
        description: 'Overlay astrophotos onto an interactive sky map with automatic plate solving.',
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.main.config.ts',
          target: 'preload',
        },
      ],
      // No renderer entry — the BrowserWindow loads http://localhost from Express,
      // which serves the Vite-built frontend from dist/.
      renderer: [],
    }),
  ],
};

export default config;
