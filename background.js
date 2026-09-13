// Service worker: viewport capture, the right-click logging entry point, and
// first-run onboarding.

import { capturePage } from './lib/capture.js';
import { submitLog } from './lib/submit.js';

const LOG_MENU_ID = 'log-page';

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: LOG_MENU_ID,
    title: 'Log this page to Genealogy Logger',
    contexts: ['page', 'selection', 'image', 'link']
  });

  // Only on a genuine first install — not on every reload or version update.
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== LOG_MENU_ID || !tab?.id) return;

  // There is no popup in this path, so notifications are the only feedback.
  notify('Genealogy Logger', 'Reading this page…');

  try {
    const capture = await capturePage(tab);
    const result = await submitLog({ capture });
    notify(
      'Record logged',
      `Added to "${result.tab}" (row ${result.rowAdded}).`
    );
  } catch (err) {
    notify('Could not log this record', err.message);
  }
});

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message
  });
}
