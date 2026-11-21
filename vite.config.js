import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createApi } from './server/api.mjs';
import { createRuntimeStore } from './server/runtime-store.mjs';
function accountsApi() {
  async function attach(server) {
    const api = createApi({ store: await createRuntimeStore() });
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api/')) void api.handle(req, res);
      else next();
    });
    server.httpServer?.once('close', () => { void api.close(); });
  }
  return { name: 'pingspace-accounts-api', configureServer: attach, configurePreviewServer: attach };
}
export default defineConfig({ server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/.test-data/**', '**/*.sqlite*'] } }, plugins: [accountsApi(), react(), tailwindcss()], resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } } });
