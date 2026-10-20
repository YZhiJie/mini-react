import { build } from 'esbuild';

/**
 * 把 examples/main.ts 打成可直接在浏览器打开的 IIFE。
 * 产物落在 examples/dist/main.js，配套页面是 examples/counter.html。
 */
await build({
  entryPoints: ['examples/main.ts'],
  bundle: true,
  outfile: 'examples/dist/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  logLevel: 'info',
});

console.log('\n✅ 构建完成：直接双击打开 examples/counter.html 即可（无需起服务器）');
