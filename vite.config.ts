import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro(),
    viteReact({
      babel: { plugins: ['babel-plugin-react-compiler'] },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        // TEMP DEBUG
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          console.log('DEBUG onwarn fired:', warning.id ?? warning.message.slice(0, 80));
        }
        // Third-party UI packages (@base-ui/react, TanStack, sonner, next-themes)
        // ship RSC-only "use client" directives that are meaningless in this
        // non-RSC TanStack Start app — dropping them is expected, so silence them.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) {
          return;
        }
        warn(warning);
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true, // fails if the port is already in use (avoids surprises)
  },
});
