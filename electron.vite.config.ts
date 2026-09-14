import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = resolve(__dirname, '.');
const shared = resolve(root, 'src/shared');

/** Extract origin for CSP, ignoring invalid values. */
function cspOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const apiOrigin = cspOrigin(process.env.VITE_LEDGE_API_URL);
const checkoutOrigin = cspOrigin(process.env.VITE_PRO_CHECKOUT_URL);
const extraConnect = [apiOrigin, checkoutOrigin].filter((v): v is string => Boolean(v));
const connectExtra = extraConnect.length > 0 ? ` ${extraConnect.join(' ')}` : '';

const rendererCspByMode = {
  serve:
    `default-src 'self' http://localhost:* ws://localhost:*${connectExtra}; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: ledge-asset:${connectExtra}; connect-src 'self' http://localhost:* ws://localhost:*${connectExtra}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`,
  build:
    `default-src 'self'${connectExtra}; script-src 'self'; style-src 'self'; img-src 'self' data: blob: file: ledge-asset:${connectExtra}; connect-src 'self'${connectExtra}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`,
} as const;

export default defineConfig(({ command }) => ({
  main: {
    ssr: {
      noExternal: ['zod'],
    },
    resolve: {
      alias: {
        '@shared': shared,
      },
    },
    build: {
      outDir: 'out/main',
      sourcemap: command === 'serve',
      minify: command === 'build',
      lib: {
        entry: resolve(root, 'src/main/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        input: resolve(root, 'src/main/index.ts'),
        output: {
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  preload: {
    ssr: {
      noExternal: ['zod'],
    },
    resolve: {
      alias: {
        '@shared': shared,
      },
    },
    build: {
      outDir: 'out/preload',
      sourcemap: command === 'serve',
      minify: command === 'build',
      lib: {
        entry: resolve(root, 'src/preload/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        input: resolve(root, 'src/preload/index.ts'),
        output: {
          entryFileNames: '[name].cjs',
        },
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(root, 'src/renderer/src'),
      },
    },
    build: {
      outDir: resolve(root, 'out/renderer'),
      minify: command === 'build',
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          quickPaste: resolve(root, 'src/renderer/quickPaste.html'),
          peekWindow: resolve(root, 'src/renderer/peekWindow.html'),
          notchDropout: resolve(root, 'src/renderer/notchDropout.html'),
        },
      },
    },
    plugins: [
      react(),
      {
        name: 'inject-renderer-csp',
        transformIndexHtml(html) {
          const csp = rendererCspByMode[command === 'serve' ? 'serve' : 'build'];
          return html.replace('__APP_CSP__', csp);
        },
      },
    ],
  },
}));
