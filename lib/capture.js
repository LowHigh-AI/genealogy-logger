// Page capture pipeline, shared by the popup and the background worker.
//
// Lives here rather than in popup.js so the context-menu entry point can log a
// page without a popup ever being opened.

/** Text the content script can't reach is not worth failing over. */
const FRAME_SEPARATOR = '\n\n--- Additional Frame Context ---\n\n';

/**
 * Scrapes a tab: full-page text across all frames, plus the best available
 * document image (embedded, high-res print URL, or a viewport screenshot).
 *
 * @param {{id: number, windowId: number}} tab
 * @returns {Promise<{rawText: string, media: object, sourceUrl: string}>}
 */
export async function capturePage(tab) {
  const tabId = tab.id;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content.js']
  });

  // Records often live inside iframes, so gather every frame's text.
  const textResults = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => document.documentElement.innerText.replace(/\s+/g, ' ').trim()
  });

  const rawText = textResults
    .map((r) => r.result)
    .filter((t) => t && t.length > 0)
    .join(FRAME_SEPARATOR);

  // Promise form: a rejection here propagates to the caller's try/catch, which
  // the old callback-based version could not do.
  const response = await chrome.tabs.sendMessage(tabId, { action: 'scrape_data' });
  if (!response || !response.success) {
    throw new Error(response?.error || 'Could not read this page.');
  }

  const media = response.media || {};

  if (media.needsBackgroundCapture) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 85
      });
      media.fileBase64 = dataUrl.split(',')[1];
      media.mimeType = 'image/jpeg';
      media.label = 'Screenshot of visible area';
    } catch (err) {
      console.warn('Genealogy Logger: viewport capture failed', err);
      media.label = 'No image captured';
    }
  } else if (media.fileBase64) {
    media.label = `Image extracted (${media.mimeType || 'image/jpeg'})`;
  } else if (media.printUrl) {
    // Fetched here, in the user's session, because these URLs are often behind a
    // login — Apps Script fetching them server-side would get a redirect instead.
    try {
      media.fileBase64 = await fetchAsBase64(media.printUrl);
      media.label = `High-resolution image (${media.mimeType || 'image/jpeg'})`;
    } catch (err) {
      console.warn('Genealogy Logger: could not fetch printUrl locally', err);
      media.label = 'Image found (will be fetched by the script)';
    }
  } else {
    media.label = 'No image found';
  }

  return { rawText, media, sourceUrl: response.sourceUrl };
}

async function fetchAsBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
