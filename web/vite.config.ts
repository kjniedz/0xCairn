import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { FAQ } from './src/content/faq.ts';
import { SITE } from './src/site.ts';
import { seoPages } from './scripts/seo.ts';

/**
 * Content Security Policy. Also served as a response header from public/_headers;
 * the meta tag is defence in depth for mirrors that drop headers.
 * 'wasm-unsafe-eval' is required to instantiate the WebAssembly kernel.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

/** Injects the CSP meta tag and FAQPage/WebApplication JSON-LD at build time. */
function headInjection(): Plugin {
  return {
    name: 'cairn-head',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const isMain = ctx.filename.endsWith(`${path.sep}index.html`) && !/[\\/](pro|order|teams|privacy|terms)[\\/]index\.html$/.test(ctx.filename);
      if (!isMain) {
        return { html, tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }] };
      }
      const faq = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      };
      const app = {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript and WebAssembly',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isAccessibleForFree: true,
        license: `${SITE.repo}/blob/main/LICENSE`,
        codeRepository: SITE.repo,
      };
      return {
        html,
        tags: [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
          { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(app), injectTo: 'head' },
          { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(faq), injectTo: 'head' },
        ],
      };
    },
  };
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const NOT_PRECACHED = new Set(['_headers', 'sw.js', 'robots.txt', 'sitemap.xml', 'og.png']);

/**
 * Generates dist/sw.js from src/sw.js with the full list of built files so the
 * app is available offline after the first visit. The cache name is a hash of
 * every file's contents, so a new deploy always refreshes the cache.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'cairn-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
      root = c.root;
    },
    closeBundle() {
      const dist = path.resolve(root, outDir);
      // SEO pages are plain static HTML with no scripts; they are not precached so the
      // offline bundle stays small. The generator and the app routes are.
      const files = walk(dist)
        .filter((f) => !f.endsWith('.map') && !NOT_PRECACHED.has(f) && !/^(vanity|hexspeak|difficulty|guides)\//.test(f))
        .sort();
      const urls = ['/', ...files.filter((f) => f !== 'index.html').map((f) => '/' + f)];
      const hash = createHash('sha256');
      for (const f of files) {
        hash.update(f);
        hash.update(fs.readFileSync(path.join(dist, f)));
      }
      const version = hash.digest('hex').slice(0, 16);
      const template = fs.readFileSync(path.resolve(root, 'src/sw.js'), 'utf8');
      const sw = template.replace('__PRECACHE__', JSON.stringify(urls)).replace('__VERSION__', version);
      fs.writeFileSync(path.join(dist, 'sw.js'), sw);
      console.log(`[cairn-sw] precaching ${urls.length} files, version ${version}`);
    },
  };
}

export default defineConfig({
  plugins: [preact(), headInjection(), seoPages(), serviceWorker()],
  worker: { format: 'es' },
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        pro: path.resolve(__dirname, 'pro/index.html'),
        order: path.resolve(__dirname, 'order/index.html'),
        teams: path.resolve(__dirname, 'teams/index.html'),
        privacy: path.resolve(__dirname, 'privacy/index.html'),
        terms: path.resolve(__dirname, 'terms/index.html'),
      },
    },
  },
  server: {
    headers: { 'Content-Security-Policy': CSP.replace("script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'").replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") },
  },
  preview: {
    headers: { 'Content-Security-Policy': CSP },
  },
});
