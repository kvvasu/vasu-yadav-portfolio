const { chromium } = require('playwright');
const path = require('path');

const ROOT = '/home/ozzy/freebuff-work/vasu-yadav-portfolio';
const EM = '/home/ozzy/freebuff-work/emily-design-design/screens/scroll/scroll-000.png';

async function samplePng(browser, file) {
  const page = await browser.newPage();
  await page.goto('file://' + file);
  const res = await page.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    const c = document.createElement('canvas');
    const scale = Math.min(1, 600 / img.naturalWidth);
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const counts = {};
    for (let i = 0; i < d.length; i += 4) {
      const key = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => ({ rgb: k.split(',').map((v) => (v << 3) + 4), pct: +(100 * n / (d.length / 4)).toFixed(1) }));
    // darkest frequent cluster = text
    let text = null, best = 1e9;
    for (const [k, n] of Object.entries(counts)) {
      if (n < d.length / 400) continue;
      const [r, g, b] = k.split(',').map((v) => (v << 3) + 4);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l < best) { best = l; text = [r, g, b]; }
    }
    return { dominant: sorted, darkest: text };
  });
  await page.close();
  return res;
}

(async () => {
  const browser = await chromium.launch();

  const em = await samplePng(browser, EM);
  const mine = await samplePng(browser, path.join(ROOT, 'qa-1280x800-light.png'));
  const hx = (a) => '#' + a.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

  console.log('--- Emily scroll-000 dominant colors ---');
  em.dominant.forEach((c) => console.log(`  ${hx(c.rgb)}  ${c.pct}%`));
  console.log(`  text cluster: ${hx(em.darkest)}`);
  console.log('--- My site (light, 1280px) dominant colors ---');
  mine.dominant.forEach((c) => console.log(`  ${hx(c.rgb)}  ${c.pct}%`));
  console.log(`  text cluster: ${hx(mine.darkest)}`);

  // computed-style fidelity on my page
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  const styles = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const h1 = document.querySelector('h1');
    const btn = document.querySelector('.btn-primary');
    const li = document.querySelector('.record li');
    return {
      bodyFont: cs(document.body).fontFamily,
      bodySize: cs(document.body).fontSize,
      h1Font: cs(h1).fontFamily,
      h1Size: cs(h1).fontSize,
      bg: cs(document.body).backgroundColor,
      ink: cs(document.body).color,
      btnBg: cs(btn).backgroundColor,
      liMarker: cs(li, '::before').backgroundColor,
      accentVar: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    };
  });
  console.log('--- My site computed styles ---');
  Object.entries(styles).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // "before" screenshots from the backup for the PR
  const before = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await before.goto('http://localhost:8080/before.html', { waitUntil: 'networkidle' });
  await before.screenshot({ path: path.join(ROOT, 'pr-before-light.png'), fullPage: true });
  await before.click('#themeToggle');
  await before.screenshot({ path: path.join(ROOT, 'pr-before-dark.png'), fullPage: true });
  const after = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await after.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  await after.screenshot({ path: path.join(ROOT, 'pr-after-light.png'), fullPage: true });
  await after.click('#themeToggle');
  await after.screenshot({ path: path.join(ROOT, 'pr-after-dark.png'), fullPage: true });

  await browser.close();
  console.log('BEFORE/AFTER SCREENSHOTS SAVED');
})().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(1); });
