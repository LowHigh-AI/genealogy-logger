// popup.js

let scrapedData = null;

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('status-badge');
  const urlPreview = document.getElementById('url-preview');
  const mediaPreview = document.getElementById('media-preview');
  const textPreview = document.getElementById('text-preview');
  
  const sendLogBtn = document.getElementById('send-log-btn');
  const copyGeminiBtn = document.getElementById('copy-gemini-btn');
  const messageArea = document.getElementById('message-area');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
      throw new Error("Cannot scrape this page.");
    }
    
    urlPreview.textContent = tab.url;

    // Inject content script if not already injected (MV3 scripting)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });

    // Send message to content script to scrape data
    chrome.tabs.sendMessage(tab.id, { action: "scrape_data" }, async (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        throw new Error(chrome.runtime.lastError?.message || response?.error || "Failed to scrape page.");
      }

      scrapedData = response;
      
      // Update UI
      textPreview.textContent = response.rawText.substring(0, 100) + "...";
      
      // Handle Background Capture if needed
      if (response.media.needsBackgroundCapture) {
        mediaPreview.textContent = "Capturing viewport...";
        try {
          const captureResponse = await chrome.runtime.sendMessage({ action: "captureViewportForTab" });
          if (captureResponse && captureResponse.success) {
            response.media.fileBase64 = captureResponse.dataUrl.split(',')[1];
            response.media.mimeType = 'image/jpeg';
            mediaPreview.textContent = "Viewport Captured (JPEG)";
          } else {
            mediaPreview.textContent = "Viewport Capture Failed";
          }
        } catch (e) {
          mediaPreview.textContent = "Viewport Capture Error";
        }
      } else if (response.media.fileBase64) {
        mediaPreview.textContent = "Image Extracted (" + response.media.mimeType + ")";
      } else if (response.media.printUrl) {
        mediaPreview.textContent = "Print URL Found (" + response.media.mimeType + ")";
      } else {
        mediaPreview.textContent = "No primary media found";
      }

      sendLogBtn.disabled = false;
      copyGeminiBtn.disabled = false;
      statusBadge.textContent = "Ready";
    });

  } catch (error) {
    statusBadge.textContent = "Error";
    statusBadge.className = "badge error";
    urlPreview.textContent = "Error";
    mediaPreview.textContent = "-";
    textPreview.textContent = error.message;
  }

  // --- Actions ---

  function showMessage(msg, type) {
    messageArea.textContent = msg;
    messageArea.className = `message ${type}`;
  }

  sendLogBtn.addEventListener('click', async () => {
    if (!scrapedData) return;
    
    sendLogBtn.disabled = true;
    sendLogBtn.textContent = "Sending...";
    statusBadge.textContent = "Sending";
    statusBadge.className = "badge loading";
    messageArea.className = "message hidden";

    try {
      // Retrieve settings (webAppUrl, apiKey) from storage
      const settings = await chrome.storage.sync.get(['webAppUrl', 'apiKey']);
      if (!settings.webAppUrl) {
        throw new Error("Web App URL not set in extension options.");
      }

      const payload = {
        rawText: scrapedData.rawText,
        fileBase64: scrapedData.media.fileBase64,
        mimeType: scrapedData.media.mimeType,
        sourceUrl: scrapedData.sourceUrl,
        printUrl: scrapedData.media.printUrl,
        apiKey: settings.apiKey || ""
      };

      const response = await fetch(settings.webAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'x-api-key': payload.apiKey
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        showMessage("Successfully logged!", "success");
        statusBadge.textContent = "Success";
        statusBadge.className = "badge success";
      } else {
        throw new Error(result.message || "Unknown server error");
      }
    } catch (e) {
      showMessage(e.message, "error");
      statusBadge.textContent = "Failed";
      statusBadge.className = "badge error";
    } finally {
      sendLogBtn.disabled = false;
      sendLogBtn.textContent = "Send to Log";
    }
  });

  copyGeminiBtn.addEventListener('click', () => {
    if (!scrapedData) return;
    
    const prompt = `LOG\n\nURL: ${scrapedData.sourceUrl}\n\nRAW TEXT:\n${scrapedData.rawText}`;
    navigator.clipboard.writeText(prompt).then(() => {
      showMessage("Copied to clipboard!", "success");
    }).catch(err => {
      showMessage("Failed to copy.", "error");
    });
  });
});
