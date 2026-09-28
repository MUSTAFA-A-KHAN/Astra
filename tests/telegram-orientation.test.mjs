import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelegramMiniApp, setupTelegramOrientation } from '../telegram.js';

test('isTelegramMiniApp returns false when not running in Telegram WebApp', () => {
  const mockWin = {
    Telegram: undefined,
    location: { search: '', hash: '' }
  };
  assert.equal(isTelegramMiniApp(mockWin), false);
});

test('isTelegramMiniApp returns true when Telegram.WebApp initData exists', () => {
  const mockWin = {
    Telegram: { WebApp: { initData: 'query_id=123&user=%7B%22id%22%3A1%7D' } },
    location: { search: '', hash: '' }
  };
  assert.equal(isTelegramMiniApp(mockWin), true);
});

test('isTelegramMiniApp returns true when URL has tgWebApp parameter', () => {
  const mockWin = {
    Telegram: { WebApp: {} },
    location: { search: '?tgWebAppVersion=7.0&tgWebAppPlatform=ios', hash: '' }
  };
  assert.equal(isTelegramMiniApp(mockWin), true);
});

test('isTelegramMiniApp returns true when platform is specified', () => {
  const mockWin = {
    Telegram: { WebApp: { platform: 'android' } },
    location: { search: '', hash: '' }
  };
  assert.equal(isTelegramMiniApp(mockWin), true);
});

test('setupTelegramOrientation invokes Telegram WebApp ready and expand and updates orientation overlay', () => {
  let readyCalled = false;
  let expandCalled = false;

  const mockOverlay = { hidden: true };
  const mockDoc = {
    getElementById: (id) => (id === 'telegram-orientation-overlay' ? mockOverlay : null)
  };

  const listeners = {};
  const mockWin = {
    Telegram: {
      WebApp: {
        initData: 'query_id=123',
        ready: () => { readyCalled = true; },
        expand: () => { expandCalled = true; },
        onEvent: (event, fn) => { listeners[event] = fn; }
      }
    },
    innerWidth: 300,
    innerHeight: 600, // Portrait
    addEventListener: (event, fn) => { listeners[event] = fn; },
    location: { search: '', hash: '' }
  };

  const result = setupTelegramOrientation(mockWin, mockDoc);

  assert.equal(result.isTelegram, true);
  assert.equal(readyCalled, true);
  assert.equal(expandCalled, true);
  // In portrait, overlay should be visible (hidden = false)
  assert.equal(mockOverlay.hidden, false);

  // Simulate rotation to landscape
  mockWin.innerWidth = 800;
  mockWin.innerHeight = 400;
  listeners.resize();
  assert.equal(mockOverlay.hidden, true);
});
