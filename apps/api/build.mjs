// Production build: bundle the API (and the shared workspace package) with esbuild.
// Everything from node_modules stays external; @emotionfix/shared is aliased to its
// TypeScript source so it compiles into the bundle.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
  alias: {
    '@emotionfix/shared': path.join(here, '../../packages/shared/src/index.ts'),
  },
  banner: {
    // some CJS deps (pdfmake) expect require(); provide it in the ESM bundle
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('API build complete: dist/index.js');
