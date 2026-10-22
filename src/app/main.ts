// FotMob Draft League: renders data.json (built by scripts/build-data.ts) with
// fotmob.com's look. Bundled into public/assets/app.js by scripts/build-site.ts.

import { applyTheme, bindChrome, readRoute } from './chrome.ts';
import { card, empty } from './components.ts';
import { esc } from './format.ts';
import { applyLatestLive, loadData, loadSeasons, pollLive, pollTransfers, refresh, scheduleRefresh } from './live-scores.ts';
import { renderAll, seasonChip, statusChips } from './render.ts';
import { live } from './state.ts';

async function init() {
  applyTheme();
  bindChrome();
  navigator.serviceWorker?.register('sw.js').catch(() => {}); // makes it installable; optional
  try {
    await loadSeasons();
    await loadData();
  } catch (err) {
    document.getElementById('app')!.innerHTML = card({
      body: empty(
        `Could not load data.json (${esc((err as Error).message)}). Build it with <code>npm run data</code> and serve public/ over HTTP.`,
      ),
    });
    return;
  }
  applyLatestLive();
  readRoute();
  renderAll();
  scheduleRefresh();
  pollLive();
  pollTransfers();
  setInterval(() => {
    const side = document.querySelector('.poster-side');
    if (side && !document.hidden) side.innerHTML = statusChips() + seasonChip();
  }, 30 * 1000);
  document.addEventListener('visibilitychange', () => {
    refresh();
    if (!document.hidden && live) pollLive();
    if (!document.hidden) pollTransfers();
  });
}

init();
