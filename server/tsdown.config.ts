import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  dts: false,
  clean: true,
  // Bundle every dependency so plugin users need no npm install.
  deps: { alwaysBundle: [/.*/] },
  outExtensions: () => ({ js: '.js' }),
});
