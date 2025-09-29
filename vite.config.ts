import { defineConfig } from 'vite';

export default defineConfig({
  base: '/chart/',
  build: {
    target: 'es2018',
    rollupOptions: {
      treeshake: {
        propertyReadSideEffects: false,
      },
    },
  },
  optimizeDeps: {
    include: [
      '@pixi/app',
      '@pixi/graphics',
      '@pixi/text',
      'd3-array',
      'd3-scale',
    ],
  },
});
