import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const gatewayProxyTarget = process.env.COWD_VITE_GATEWAY_URL || 'http://127.0.0.1:8642';
const workspaceManifest = readFileSync(new URL('../../Cargo.toml', import.meta.url), 'utf8');
const edgeVersion = workspaceManifest.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/)?.[1] || 'unknown';
const webuiRoot = dirname(fileURLToPath(import.meta.url));
const i18nModules = new Set([
  resolve(webuiRoot, 'src/i18n/index.ts'),
  resolve(webuiRoot, 'src/i18n/locale.ts'),
  resolve(webuiRoot, 'src/i18n/messages/en-US.ts'),
  resolve(webuiRoot, 'src/i18n/messages/zh-CN.ts'),
]);

export default defineConfig({
  plugins: [vue()],
  define: {
    __COWD_EDGE_VERSION__: JSON.stringify(edgeVersion),
  },
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets/app',
    // Capability workbenches are intentionally lazy. Avoid rewriting every
    // dynamic edge into eager module-preload hints and keep the critical chat
    // entry independent from closed companion and management surfaces.
    modulePreload: false,
    rollupOptions: {
      input: 'index.dev.html',
      output: {
        entryFileNames: 'assets/app/[name]-[hash].js',
        chunkFileNames: 'assets/app/[name]-[hash].js',
        assetFileNames: 'assets/app/[name]-[hash][extname]',
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/');
          if (
            normalized.includes('/node_modules/vue/')
            || normalized.includes('/node_modules/vue-router/')
            || normalized.includes('/node_modules/pinia/')
          ) {
            return 'vendor-vue';
          }
          if (normalized.includes('/node_modules/lucide-vue-next/')) {
            return 'vendor-icons';
          }
          if (normalized.includes('/node_modules/markdown-it/')) {
            return 'vendor-markdown';
          }
          if (i18nModules.has(id)) {
            return 'app-i18n';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': gatewayProxyTarget,
      '/healthz': gatewayProxyTarget,
      '/readyz': gatewayProxyTarget,
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/api': gatewayProxyTarget,
      '/healthz': gatewayProxyTarget,
      '/readyz': gatewayProxyTarget,
    },
  },
});
