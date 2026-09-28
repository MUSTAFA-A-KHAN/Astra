/**
 * Telegram Mini App integration and landscape orientation prompt.
 */

export function isTelegramMiniApp(win = window) {
  const tg = win.Telegram?.WebApp;
  if (!tg) return false;
  // Check initData string or initDataUnsafe object or platform parameter in URL
  const hasInitData = typeof tg.initData === 'string' && tg.initData.length > 0;
  const hasInitDataUnsafe = tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object' && Object.keys(tg.initDataUnsafe).length > 0;
  const hasTgParam = win.location?.search?.includes('tgWebApp') || win.location?.hash?.includes('tgWebApp');
  const hasPlatform = typeof tg.platform === 'string' && tg.platform !== '' && tg.platform !== 'unknown';

  return !!(hasInitData || hasInitDataUnsafe || hasTgParam || hasPlatform);
}

export function setupTelegramOrientation(win = window, doc = document) {
  const tg = win.Telegram?.WebApp;
  const isTg = isTelegramMiniApp(win);

  if (!isTg) return { isTelegram: false };

  // Notify Telegram WebApp that the app is ready and expand it
  try { tg.ready?.(); } catch {}
  try { tg.expand?.(); } catch {}

  const overlay = doc.getElementById('telegram-orientation-overlay');

  function updateOrientationOverlay() {
    const isPortrait = win.innerHeight > win.innerWidth;
    if (overlay) {
      overlay.hidden = !isPortrait;
    }
  }

  updateOrientationOverlay();

  win.addEventListener('resize', updateOrientationOverlay);
  win.addEventListener('orientationchange', updateOrientationOverlay);

  try {
    tg.onEvent?.('viewportChanged', updateOrientationOverlay);
  } catch {}

  return {
    isTelegram: true,
    updateOrientationOverlay
  };
}
