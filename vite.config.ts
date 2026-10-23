import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the game from a subpath (wolfienet.com/Mathteriod/);
  // the deploy workflow sets BASE_PATH. Local dev and LAN previews stay at "/".
  base: process.env.BASE_PATH || '/',
  // Expose the dev server on the LAN so the kids can playtest from their own devices.
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
