import { CatanGame } from './game.js';
import { CatanUI } from './ui.js';

window.addEventListener('DOMContentLoaded', () => {
  const game = new CatanGame();
  const ui = new CatanUI(game);

  const loaded = game.loadFromStorage();
  if (!loaded) {
    game.startNewGame();
  } else {
    ui.render();
  }

  // Expose on window for easy debugging if needed
  window.catanGame = game;
  window.catanUI = ui;

  // 1. Warn before accidental browser reload/navigation during offline flight play
  let allowUnload = false;
  window.addEventListener('beforeunload', e => {
    if (allowUnload) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Helper to force-refresh the installed iPad Home Screen PWA (clears SW cache while keeping saved game in localStorage)
  window.forceRefreshApp = async () => {
    allowUnload = true;
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    window.location.replace(url.toString());
  };

  // 2. Keep iPad Screen Awake (Screen Wake Lock API supported on iPadOS 16.4+)
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLockSentinel && !wakeLockSentinel.released) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    } catch (_) {
      // Ignore if battery saver or unsupported context blocks wake lock
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });
  window.addEventListener('pointerdown', requestWakeLock, { passive: true });
  requestWakeLock();

  // 3. Register Service Worker for offline PWA support where allowed
  if (
    'serviceWorker' in navigator &&
    (location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1')
  ) {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        });
      })
      .catch(err => {
        console.warn('Service worker registration skipped:', err);
      });
  }
});
