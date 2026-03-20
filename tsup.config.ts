import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
  },
});
