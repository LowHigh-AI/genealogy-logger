// Builds the webhook payload from saved settings and posts it.
// Shared by the popup and the background worker.

const SETTING_KEYS = [
  'webhookUrl',
  'apiKey',
  'spreadsheetId',
  'driveFolderId',
  'geminiModel',
  'activeFamilyLine'
];

/**
 * @param {{capture: object, notes?: string, familyLine?: string}} args
 * @returns {Promise<object>} the webhook's success payload (tab, rowAdded, scanUrl…)
 */
export async function submitLog({ capture, notes = '', familyLine }) {
  const settings = await chrome.storage.sync.get(SETTING_KEYS);

  if (!settings.webhookUrl) {
    throw new Error('No webhook URL set. Open Settings to finish setup.');
  }

  const payload = {
    rawText: capture.rawText,
    fileBase64: capture.media.fileBase64,
    mimeType: capture.media.mimeType,
    printUrl: capture.media.printUrl,
    sourceUrl: capture.sourceUrl,
    notes: notes,
    apiKey: settings.apiKey || '',
    spreadsheetId: settings.spreadsheetId || '',
    driveFolderId: settings.driveFolderId || '',
    geminiModel: settings.geminiModel || '',
    // The popup passes an explicit choice; background entry points fall back to
    // whatever the user last selected.
    targetFamilyLine: familyLine !== undefined ? familyLine : (settings.activeFamilyLine || '')
  };

  const response = await fetch(settings.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      'x-api-key': payload.apiKey
    },
    body: JSON.stringify(payload)
  });

  // Apps Script reports its own errors inside a 200 body, so check the payload.
  const result = await response.json();
  if (result.status !== 'success') {
    const error = new Error(result.message || 'The script returned an error.');
    // Set by the script for transient failures (rate limits, congestion). Anything
    // else is a real fault and must not be retried forever.
    error.retryable = Boolean(result.retryable);
    error.retryAfter = result.retryAfter || 0;
    throw error;
  }
  return result;
}
