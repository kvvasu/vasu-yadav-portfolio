const { chromium } = require('playwright');

const BASE = 'http://localhost:8080';
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function lum(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(rgb1, rgb2) {
  const L1 = lum(...rgb1), L2 = lum(...rgb2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseRGB(s) {
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

(async () => {
  const browser = await chromium.launch();

  // --- 1. Viewports: screenshots, no horizontal scrollbar, no console errors ---
  for (const [w, h] of [[1280, 800], [375, 812]]) {
    const consoleErrors = [];
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `qa-${w}x${h}-light.png`, fullPage: true });
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`${w}x${h} no horizontal scrollbar`, !hscroll, `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
    check(`${w}x${h} no console errors`, consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // --- 2. Dark mode toggle + localStorage persistence ---
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx2.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const before = await page.getAttribute('html', 'data-theme');
  await page.click('#themeToggle');
  const after = await page.getAttribute('html', 'data-theme');
  check('toggle switches theme', before !== after, `${before || 'light'} -> ${after || 'light'}`);
  check('dark attr set on html', after === 'dark', `data-theme=${after}`);
  await page.screenshot({ path: 'qa-1280x800-dark.png', fullPage: true });
  const stored = await page.evaluate(() => localStorage.getItem('theme'));
  check('theme saved to localStorage', stored === 'dark', `localStorage.theme=${stored}`);
  await page.reload({ waitUntil: 'networkidle' });
  const persisted = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('dark mode persists after reload', persisted === 'dark', `data-theme=${persisted}`);
  await page.click('#themeToggle'); // back to light, clear storage
  await page.evaluate(() => localStorage.clear());
  await ctx2.close();

  // --- 3. Tap targets >= 44px (both themes' interactive elements) ---
  const ctx3 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page3 = await ctx3.newPage();
  await page3.goto(BASE, { waitUntil: 'networkidle' });
  const small = await page3.evaluate(() => {
    const out = [];
    document.querySelectorAll('a, button').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44)) {
        out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    return out;
  });
  check('tap targets >= 44px', small.length === 0, small.join(', ').slice(0, 300));
  await ctx3.close();

  // --- 4. Contrast: body + muted text in light and dark themes ---
  for (const theme of ['light', 'dark']) {
    const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page4 = await ctx4.newPage();
    if (theme === 'dark') {
      await page4.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch (e) {} });
    }
    await page4.goto(BASE, { waitUntil: 'networkidle' });
    const res = await page4.evaluate(() => {
      function bgOf(el) {
        let n = el;
        while (n && n !== document.documentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !bg.startsWith('rgba(0, 0, 0, 0)') && bg !== 'transparent') return bg;
          n = n.parentElement;
        }
        return getComputedStyle(document.documentElement).backgroundColor;
      }
      const body = document.querySelector('p.lede') || document.body;
      const muted = document.querySelector('.case-desc') || body;
      return {
        body: [getComputedStyle(body).color, bgOf(body)],
        muted: [getComputedStyle(muted).color, bgOf(muted)],
      };
    });
    const cBody = contrast(parseRGB(res.body[0]), parseRGB(res.body[1]));
    const cMuted = contrast(parseRGB(res.muted[0]), parseRGB(res.muted[1]));
    check(`${theme} body-text contrast >= 4.5:1`, cBody >= 4.5, `${cBody.toFixed(2)}:1`);
    check(`${theme} muted-text contrast >= 4.5:1`, cMuted >= 4.5, `${cMuted.toFixed(2)}:1`);
    await ctx4.close();
  }

  // --- 5. prefers-reduced-motion respected ---
  const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page5 = await ctx5.newPage();
  await page5.goto(BASE, { waitUntil: 'networkidle' });
  const motion = await page5.evaluate(() => {
    const btn = document.querySelector('.btn');
    const cs = getComputedStyle(btn);
    const transition = cs.transitionDuration.split(',').map((s) => parseFloat(s));
    const htmlSB = getComputedStyle(document.documentElement).scrollBehavior;
    return { maxTransition: Math.max(...transition), scrollBehavior: htmlSB };
  });
  check('prefers-reduced-motion: transitions collapsed', motion.maxTransition <= 0.01, `max transition ${motion.maxTransition}ms`);
  check('prefers-reduced-motion: scroll-behavior auto', motion.scrollBehavior === 'auto', `scroll-behavior=${motion.scrollBehavior}`);
  await ctx5.close();

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(1); });
