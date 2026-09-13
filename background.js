// Service worker: the right-click logging entry point and first-run onboarding.

import { capturePage } from './lib/capture.js';
import { submitLog } from './lib/submit.js';
import {
  logOrQueue, peek, shift, bumpAttempts, queueSize, scheduleDrain, showQueueBadge, MIN_ALARM_SECONDS
} from './lib/queue.js';

const LOG_MENU_ID = 'log-page';
const RELOAD_MENU_ID = 'reload-extension';

// Theme colours, matching styles/theme.css
const BADGE_WORKING = '#b07d2b';
const BADGE_SUCCESS = '#2e6b4f';
const BADGE_ERROR = '#a33a2a';
const BADGE_QUEUED = '#6b6358';

const DRAIN_ALARM = 'drain-queue';
// A capture that keeps failing should not cycle forever.
const MAX_ATTEMPTS = 5;

// Chrome injects update_url into the manifest for Web Store installs, so its absence
// means we are running unpacked. Lets the dev-only reload stay out of the shipped build
// without needing the "management" permission to ask.
const IS_UNPACKED = !('update_url' in chrome.runtime.getManifest());

chrome.runtime.onInstalled.addListener((details) => {
  // removeAll first: create() throws on a duplicate id, which would abort the whole
  // handler and leave the menu missing entirely.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: LOG_MENU_ID,
      title: 'Log this page to Genealogy Logger',
      contexts: ['page', 'selection', 'image', 'link']
    });

    if (IS_UNPACKED) {
      chrome.contextMenus.create({
        id: RELOAD_MENU_ID,
        title: '🔄 Reload Extension (dev)',
        contexts: ['action']
      });
    }
  });

  // Only on a genuine first install — not on every reload or version update.
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === RELOAD_MENU_ID) {
    chrome.runtime.reload();
    return;
  }
  if (info.menuItemId !== LOG_MENU_ID) return;

  if (!tab?.id) {
    notify('Could not log this record', 'No active tab to read.');
    return;
  }

  // The badge is the reliable channel: notifications are silently dropped when the OS
  // has them switched off for Chrome, which makes a successful log look like a no-op.
  console.info('[Genealogy Logger] logging', tab.url);
  await setBadge(tab.id, '…', BADGE_WORKING);
  notify('Genealogy Logger', 'Reading this page…');

  try {
    const capture = await capturePage(tab);
    const outcome = await logOrQueue({ capture });

    if (outcome.status === 'queued') {
      await setBadge(tab.id, '⋯', BADGE_QUEUED);
      notify(
        'Record queued',
        `Gemini is rate limited. This page is saved and will be logged automatically ` +
        `(${outcome.size} waiting).`
      );
    } else {
      console.info(`[Genealogy Logger] logged to "${outcome.result.tab}" row ${outcome.result.rowAdded}`);
      await setBadge(tab.id, '✓', BADGE_SUCCESS);
      notify('Record logged', `Added to "${outcome.result.tab}" (row ${outcome.result.rowAdded}).`);
      clearBadgeLater(tab.id);
    }
  } catch (err) {
    console.error('[Genealogy Logger] failed:', err);
    await setBadge(tab.id, '!', BADGE_ERROR);
    notify('Could not log this record', err.message);
  }
});

// --- Queue -------------------------------------------------------------------------



/**
 * Sends one queued capture. Called on an alarm, so each run is short and the worker
 * is free to shut down in between.
 */
async function drainQueue() {
  const item = await peek();
  if (!item) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  try {
    const result = await submitLogDirect(item);
    await shift();
    console.info(`[Genealogy Logger] queued record logged to "${result.tab}" row ${result.rowAdded}`);
    notify('Queued record logged', `Added to "${result.tab}" (row ${result.rowAdded}).`);
  } catch (err) {
    const attempts = await bumpAttempts();

    if (!err.retryable || attempts >= MAX_ATTEMPTS) {
      // Permanent, or we have tried long enough - drop it rather than retry forever.
      await shift();
      console.error(`[Genealogy Logger] giving up on queued record:`, err);
      notify('Could not log a queued record', err.message);
    } else {
      console.warn(`[Genealogy Logger] attempt ${attempts} failed, will retry:`, err.message);
      await scheduleDrain(err.retryAfter);
      await showQueueBadge();
      return;
    }
  }

  const remaining = await queueSize();
  await showQueueBadge();
  if (remaining > 0) await scheduleDrain(MIN_ALARM_SECONDS);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DRAIN_ALARM) drainQueue();
});

// Pick the queue back up after a browser restart.
chrome.runtime.onStartup.addListener(async () => {
  if (await queueSize()) {
    await showQueueBadge();
    await scheduleDrain(MIN_ALARM_SECONDS);
  }
});

function submitLogDirect(item) {
  return submitLog({ capture: item.capture, notes: item.notes, familyLine: item.familyLine });
}

async function setBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (err) {
    // The tab can close mid-flight; never let badge trouble mask the real outcome.
    console.warn('[Genealogy Logger] could not set badge:', err);
  }
}

// Best effort: the service worker may be torn down before this fires, in which case the
// tick simply stays until the next log on that tab.
function clearBadgeLater(tabId) {
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }, 8000);
}

function notify(title, message) {
  chrome.notifications.create(
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message
    },
    () => {
      // Surfaces the "notifications are blocked" case, which otherwise looks like
      // nothing happened at all.
      if (chrome.runtime.lastError) {
        console.warn('[Genealogy Logger] notification suppressed:', chrome.runtime.lastError.message);
      }
    }
  );
}
