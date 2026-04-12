import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

export default defineConfig({
  adapter: node({ mode: 'standalone' }),

  vite: {
    plugins: [tailwindcss()],
    server: {
      host: true,
      allowedHosts: ['project-manager.ship'],
      watch: {
        ignored: ['**/repos/**', '**/data/**'],
      },
    },
  },
});
