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

  // Register Service Worker for 100% offline iPad PWA support
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration skipped:', err);
    });
  }
});
