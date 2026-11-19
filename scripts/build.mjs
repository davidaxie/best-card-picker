// Builds the extension into dist/ (or dist-e2e/ with BCP_E2E=1 for the Playwright suite).
// Two Vite passes: extension pages + module service worker, then the content script as a classic IIFE.
import { build } from 'vite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2e = process.env.BCP_E2E === '1';
const outDir = resolve(root, e2e ? 'dist-e2e' : 'dist');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const common = {
  configFile: false,
  logLevel: 'warn',
  root: resolve(root, 'src'),
  base: '/',
  publicDir: false,
};

await build({
  ...common,
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome120',
    minify: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(root, 'src/popup/index.html'),
        options: resolve(root, 'src/options/index.html'),
        'service-worker': resolve(root, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

await build({
  ...common,
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome120',
    minify: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { content: resolve(root, 'src/content/main.ts') },
      output: { format: 'iife', entryFileNames: 'content.js' },
    },
  },
});

// ---------- manifest ----------
const manifest = {
  manifest_version: 3,
  name: 'Best Card Picker',
  version: pkg.version,
  description: 'Private, local-only: which of your cards earns the most here. No network, no accounts.',
  minimum_chrome_version: '120',
  permissions: ['storage', 'activeTab'],
  optional_permissions: ['scripting'],
  optional_host_permissions: ['<all_urls>'],
  background: { service_worker: 'service-worker.js', type: 'module' },
  action: {
    default_title: 'Best Card Picker',
    default_popup: 'popup/index.html',
    default_icon: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' },
  },
  options_ui: { page: 'options/index.html', open_in_tab: true },
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src 'none'",
  },
};
if (e2e) {
  // Test build only: grant what the Auto mode switch would request, since a headless test cannot
  // click Chrome's permission prompt. Never use dist-e2e for real browsing.
  manifest.name += ' (e2e test build)';
  manifest.permissions.push('scripting');
  manifest.host_permissions = ['<all_urls>'];
  delete manifest.optional_permissions;
  delete manifest.optional_host_permissions;
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// ---------- icons: a rounded card with a stripe, drawn into PNGs without dependencies ----------
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const px = (x, y) => {
    const m = size * 0.08;
    const r = size * 0.14;
    const x0 = m, x1 = size - m, y0 = size * 0.2, y1 = size * 0.8;
    const inside = (() => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    })();
    if (!inside) return [0, 0, 0, 0];
    if (y > size * 0.34 && y < size * 0.46) return [20, 20, 20, 255];
    if (x > size * 0.2 && x < size * 0.42 && y > size * 0.56 && y < size * 0.68) return [232, 190, 60, 255];
    return [26, 76, 139, 255];
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x + 0.5, y + 0.5);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
mkdirSync(resolve(outDir, 'icons'), { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(resolve(outDir, `icons/${s}.png`), icon(s));

console.log(`Built ${e2e ? 'e2e test build' : 'extension'} into ${outDir}`);
