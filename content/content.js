// content.js - Genealogy Logger Scraper

function scrapePageText() {
  const rawText = document.body.innerText;
  return rawText.replace(/\s+/g, ' ').trim();
}

function capturePrimaryMedia() {
  let mediaInfo = {
    fileBase64: null,
    printUrl: null,
    mimeType: null,
    needsBackgroundCapture: false
  };

  // 1. Check for dedicated Print/Download/Full-Res buttons (e.g. MyHeritage, FamilySearch)
  const downloadLink = document.querySelector('a[download], a[title*="Download"], a[title*="Print"], a.download, a.print');
  if (downloadLink && downloadLink.href) {
    mediaInfo.printUrl = downloadLink.href;
    // We assume JPEG for generic print URLs unless it's obviously a PDF
    mediaInfo.mimeType = downloadLink.href.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    return mediaInfo;
  }

  // 2. Check for PDF embeds or iframes
  const pdfEmbed = document.querySelector('embed[type="application/pdf"], iframe[src*=".pdf"]');
  if (pdfEmbed) {
    mediaInfo.printUrl = pdfEmbed.src;
    mediaInfo.mimeType = 'application/pdf';
    return mediaInfo;
  }

  // 3. Find primary visible document image or canvas
  // Focus on elements likely to contain the actual record (main content area)
  const mainImage = document.querySelector('main img, #main-content img, .document-image, img.viewer-image, img[src*="image"]');
  
  if (mainImage) {
    // If it's a cross-origin image, canvas.toDataURL will throw a security error (tainted canvas)
    try {
      const canvas = document.createElement('canvas');
      canvas.width = mainImage.naturalWidth || mainImage.width;
      canvas.height = mainImage.naturalHeight || mainImage.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(mainImage, 0, 0);
      mediaInfo.fileBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
      mediaInfo.mimeType = 'image/jpeg';
    } catch (e) {
      console.warn("Genealogy Logger: Tainted canvas error, falling back to background capture.", e);
      mediaInfo.needsBackgroundCapture = true;
    }
    return mediaInfo;
  }

  // 4. Check for canvas viewers (e.g., DeepZoom)
  const canvases = document.querySelectorAll('canvas');
  if (canvases.length > 0) {
    // Assuming the largest canvas is the document viewer
    let largestCanvas = canvases[0];
    for (let i = 1; i < canvases.length; i++) {
      if (canvases[i].width * canvases[i].height > largestCanvas.width * largestCanvas.height) {
        largestCanvas = canvases[i];
      }
    }
    try {
      mediaInfo.fileBase64 = largestCanvas.toDataURL('image/jpeg').split(',')[1];
      mediaInfo.mimeType = 'image/jpeg';
    } catch (e) {
      console.warn("Genealogy Logger: Tainted canvas error on DeepZoom viewer, falling back to background capture.", e);
      mediaInfo.needsBackgroundCapture = true;
    }
    return mediaInfo;
  }

  // Fallback to background capture if nothing else was found but we want a screenshot
  mediaInfo.needsBackgroundCapture = true;
  return mediaInfo;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrape_data") {
    try {
      const rawText = scrapePageText();
      const media = capturePrimaryMedia();
      sendResponse({
        success: true,
        rawText: rawText,
        media: media,
        sourceUrl: window.location.href
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }
  return true; // Keep message channel open for async response if needed
});
