import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works on Vercel, GitHub Pages and itch.io
  // (itch.io serves the game from a nested path and breaks on absolute URLs).
  base: './',
  server: {
    // Bind IPv4 explicitly. Vite's default resolves to ::1 on Windows, and
    // browsers that look up `localhost` as 127.0.0.1 then get a refused
    // connection on an otherwise healthy dev server.
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
