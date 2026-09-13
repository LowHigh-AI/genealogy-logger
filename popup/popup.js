// popup.js
import { capturePage } from '../lib/capture.js';
import { submitLog } from '../lib/submit.js';

let capture = null;

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('status-badge');
  const urlPreview = document.getElementById('url-preview');
  const mediaPreview = document.getElementById('media-preview');
  const textPreview = document.getElementById('text-preview');
  const notesInput = document.getElementById('notes-input');

  const sendLogBtn = document.getElementById('send-log-btn');
  const retryBtn = document.getElementById('retry-btn');
  const copyGeminiBtn = document.getElementById('copy-gemini-btn');
  const messageArea = document.getElementById('message-area');
  const familyLineSelect = document.getElementById('family-line-select');
  const addLinesLink = document.getElementById('add-lines-link');
  const settingsBtn = document.getElementById('settings-btn');

  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  addLinesLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

  function setStatus(text, kind) {
    statusBadge.textContent = text;
    statusBadge.className = kind ? `badge ${kind}` : 'badge';
  }

  function showMessage(html, type) {
    messageArea.innerHTML = html;
    messageArea.className = `message ${type}`;
  }

  // --- Family line picker -------------------------------------------------
  try {
    const { familyLines = [], activeFamilyLine = '' } =
      await chrome.storage.sync.get(['familyLines', 'activeFamilyLine']);

    if (familyLines.length === 0) {
      // An empty disabled dropdown told the user nothing; point them at Settings.
      familyLineSelect.classList.add('hidden');
      addLinesLink.classList.remove('hidden');
    } else {
      familyLines.forEach((line) => {
        const option = document.createElement('option');
        option.value = line;
        option.textContent = line;
        familyLineSelect.appendChild(option);
      });
      familyLineSelect.value = familyLines.includes(activeFamilyLine) ? activeFamilyLine : '';
    }
  } catch (e) {
    console.warn('Genealogy Logger: failed to load family lines', e);
  }

  familyLineSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ activeFamilyLine: familyLineSelect.value }).catch((e) => {
      console.warn('Genealogy Logger: failed to persist family line selection', e);
    });
  });

  // --- Capture ------------------------------------------------------------
  async function runCapture() {
    setStatus('Reading…', 'loading');
    retryBtn.classList.add('hidden');
    messageArea.className = 'message hidden';
    mediaPreview.textContent = 'Scanning…';
    textPreview.textContent = 'Scanning…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error('Chrome blocks extensions on this page. Open a record first.');
      }

      urlPreview.textContent = tab.url;
      capture = await capturePage(tab);

      mediaPreview.textContent = capture.media.label || 'No image found';
      const chars = capture.rawText.length;
      textPreview.textContent = chars
        ? `${chars.toLocaleString()} characters captured`
        : 'No text found on this page';

      sendLogBtn.disabled = false;
      copyGeminiBtn.disabled = false;
      setStatus('Ready');
    } catch (error) {
      capture = null;
      sendLogBtn.disabled = true;
      copyGeminiBtn.disabled = true;
      mediaPreview.textContent = '–';
      textPreview.textContent = '–';
      setStatus('Failed', 'error');
      showMessage(escapeHtml(error.message), 'error');
      retryBtn.classList.remove('hidden');
    }
  }

  retryBtn.addEventListener('click', runCapture);
  await runCapture();

  // --- Send ---------------------------------------------------------------
  sendLogBtn.addEventListener('click', async () => {
    if (!capture) return;

    sendLogBtn.disabled = true;
    sendLogBtn.textContent = 'Sending…';
    setStatus('Sending', 'loading');
    messageArea.className = 'message hidden';

    try {
      const result = await submitLog({
        capture,
        notes: notesInput.value.trim(),
        familyLine: familyLineSelect.value || ''
      });

      // The webhook tells us exactly where the row landed — show it.
      const links = [];
      if (result.spreadsheetUrl) links.push(`<a href="${result.spreadsheetUrl}" target="_blank">Open sheet</a>`);
      if (result.scanUrl) links.push(`<a href="${result.scanUrl}" target="_blank">View scan</a>`);

      showMessage(
        `Logged to <strong>${escapeHtml(result.tab)}</strong> · row ${result.rowAdded}` +
        (links.length ? `<div class="message-links">${links.join('')}</div>` : ''),
        'success'
      );
      setStatus('Logged', 'success');
      notesInput.value = '';
    } catch (e) {
      showMessage(escapeHtml(e.message), 'error');
      setStatus('Failed', 'error');
    } finally {
      sendLogBtn.disabled = false;
      sendLogBtn.textContent = 'Send to Log';
    }
  });

  copyGeminiBtn.addEventListener('click', () => {
    if (!capture) return;
    const notes = notesInput.value.trim();
    const prompt =
      `LOG\n\nURL: ${capture.sourceUrl}\n\n` +
      (notes ? `NOTES:\n${notes}\n\n` : '') +
      `RAW TEXT:\n${capture.rawText}`;

    navigator.clipboard.writeText(prompt)
      .then(() => showMessage('Copied to clipboard.', 'success'))
      .catch(() => showMessage('Could not copy to clipboard.', 'error'));
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
