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
  window.addEventListener('beforeunload', e => {
    e.preventDefault();
    e.returnValue = '';
  });

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
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration skipped:', err);
    });
  }
});
