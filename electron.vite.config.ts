import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = resolve(__dirname, '.');
const shared = resolve(root, 'src/shared');
const rendererCspByMode = {
  serve:
    "default-src 'self' http://localhost:* ws://localhost:* https://*.convex.cloud wss://*.convex.cloud; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: ledge-asset: https://*.convex.cloud; connect-src 'self' http://localhost:* ws://localhost:* https://*.convex.cloud wss://*.convex.cloud; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';",
  build:
    "default-src 'self' https://*.convex.cloud wss://*.convex.cloud; script-src 'self'; style-src 'self'; img-src 'self' data: blob: file: ledge-asset: https://*.convex.cloud; connect-src 'self' https://*.convex.cloud wss://*.convex.cloud; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';",
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
