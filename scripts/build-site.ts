// Bundles the page (src/app) and the service worker (src/sw.ts) into public/, which is
// the whole site as GitHub Pages serves it.
//
//   node scripts/build-site.ts            one build
//   node scripts/build-site.ts --serve    rebuild on change and serve public/ on :8765

import * as esbuild from 'esbuild';

const serve = process.argv.includes('--serve');
const port = Number(process.env.PORT ?? 8765);

const options: esbuild.BuildOptions = {
  entryPoints: [
    { in: 'src/app/main.ts', out: 'assets/app' },
    { in: 'src/sw.ts', out: 'sw' },
  ],
  outdir: 'public',
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari15', 'firefox100'],
  minify: !serve,
  sourcemap: 'linked',
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { hosts } = await ctx.serve({ servedir: 'public', host: '127.0.0.1', port });
  console.log(`Serving http://${hosts[0]}:${port}`);
} else {
  await esbuild.build(options);
}
