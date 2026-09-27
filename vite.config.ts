import { defineConfig } from 'vite';

export default defineConfig({
  // Expose the dev server on the LAN so the kids can playtest from their own devices.
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
