// Render check for the built web app (apps/web/dist): serve it with `vite preview`, load it in headless
// Chromium, and require the invitation gate to render with no uncaught page error. Catches a bundle that
// builds and typechecks but renders nothing, like react-dom 19 next to react 18 (2026-11-08, caught only
// by the post-deploy smoke). Every request that is not to the local preview server is aborted: no Firebase
// sign-in, no App Check, no proxy, so no accounts are created and no model is called.
// Run after `pnpm build`: `pnpm --filter @wind-spirit/web render-check`.
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';

const TEXT = 'Your invitation';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await preview({ root, logLevel: 'warn', preview: { port: 0, strictPort: false, open: false } });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('vite preview did not report a URL');
const origin = new URL(url).origin;

const browser = await chromium.launch();
const errors = [];
let blocked = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blocked++;
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.getByText(TEXT, { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1000); // let a late render error surface
} catch (e) {
  errors.push(String(e));
} finally {
  await browser.close();
  await new Promise(r => server.httpServer.close(r));
}

if (errors.length) {
  console.error(`render check FAILED at ${url}:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`render check ok: "${TEXT}" rendered at ${url}, no page errors (${blocked} external requests blocked)`);
