import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

const output = new URL('./dist/', import.meta.url);
await mkdir(output, { recursive: true });
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
await writeFile(new URL('index.html', output), html
  .replace('<script src="/app.js" defer></script>', '<script>window.FUNDUS_FRONTEND_ONLY = true;</script>\n  <script src="/app.js" defer></script>')
  .replace('Research workspace', 'Frontend preview'));
for (const filename of ['app.js', 'style.css', 'theme.js']) {
  await copyFile(new URL(filename, import.meta.url), new URL(filename, output));
}
console.log('Frontend Vercel siap: dist/ (backend belum terhubung).');
