import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const gatewayProxyTarget = process.env.COWD_VITE_GATEWAY_URL || 'http://127.0.0.1:8642';
const workspaceManifest = readFileSync(new URL('../../Cargo.toml', import.meta.url), 'utf8');
const edgeVersion = workspaceManifest.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/)?.[1] || 'unknown';
const webuiRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@cowd/webui-host', replacement: resolve(webuiRoot, 'src/apps/host.ts') },
      { find: /^@cowd\/app-mfg-webui$/, replacement: resolve(webuiRoot, '.cowd/apps/mfg/webui/src/index.ts') },
      { find: /^@cowd\/app-mfg-webui\/(.+)$/, replacement: resolve(webuiRoot, '.cowd/apps/mfg/webui/src/$1') },
    ],
  },
  define: {
    __COWD_EDGE_VERSION__: JSON.stringify(edgeVersion),
  },
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets/app',
    rollupOptions: {
      input: 'index.dev.html',
      output: {
        entryFileNames: 'assets/app/[name]-[hash].js',
        chunkFileNames: 'assets/app/[name]-[hash].js',
        assetFileNames: 'assets/app/[name]-[hash][extname]',
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-icons': ['lucide-vue-next'],
          'vendor-markdown': ['markdown-it'],
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
});
