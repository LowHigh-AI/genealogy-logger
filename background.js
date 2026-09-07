// Genealogy Logger - Background Service Worker

// Initialize Context Menus and open setup on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }

  chrome.contextMenus.create({
    id: "log-record-cm",
    title: "Log Genealogy Record to Google Sheets",
    contexts: ["page", "selection", "image"]
  });

  chrome.contextMenus.create({
    id: "open-options-cm",
    title: "Genealogy Logger Settings",
    contexts: ["action"]
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "log-record-cm" && tab) {
    await executeLogWorkflow(tab, info.selectionText ? `Selected text: ${info.selectionText}` : "");
  } else if (info.menuItemId === "open-options-cm") {
    chrome.runtime.openOptionsPage();
  }
});

// 1. Trigger via Toolbar Action Click
chrome.action.onClicked.addListener(async (tab) => {
  await executeLogWorkflow(tab);
});

// 2. Trigger via Omnibox: typing "log" + Space/Tab in the address bar
// Supports routing e.g. "log [Smith Line] 1920 Census record"
chrome.omnibox.onInputEntered.addListener(async (rawText, disposition) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  let targetTabOverride = "";
  let userNotes = rawText.trim();

  // Parse bracketed tab syntax: e.g. "[Smith Line] check maiden name"
  const bracketMatch = userNotes.match(/^\[(.*?)\]\s*(.*)$/);
  if (bracketMatch) {
    targetTabOverride = bracketMatch[1].trim();
    userNotes = bracketMatch[2].trim();
  }

  await executeLogWorkflow(activeTab, userNotes, targetTabOverride);
});

// 3. Trigger via Keyboard Shortcut (Cmd+Shift+L / Ctrl+Shift+L)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "log-record") {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await executeLogWorkflow(activeTab);
    }
  }
});

// Concurrency lock to prevent multiple simultaneous runs on the same tab
const activeTabProcessing = new Set();

/**
 * Main workflow: extracts DOM metadata & screenshot, prompts Gemini 3.6 Flash,
 * and logs structured genealogical data to Google Sheets via Webhook.
 */
async function executeLogWorkflow(tab, userNotes = "", tabOverride = "") {
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  if (activeTabProcessing.has(tabId)) {
    await sendToast(tabId, "Already extracting record, please wait a moment...", "working", 2500);
    return;
  }
  activeTabProcessing.add(tabId);

  try {
    // 1. Resolve full tab details if tab.url is missing (e.g. from keyboard shortcuts)
    let currentTab = tab;
    if (!currentTab.url) {
      try {
        currentTab = await chrome.tabs.get(tabId);
      } catch (e) {
        console.warn("Could not fetch full tab details:", e);
      }
    }

    const currentUrl = currentTab.url || "";

    // Restrict execution on internal browser pages
    if (!currentUrl || currentUrl.startsWith("chrome://") || currentUrl.startsWith("chrome-extension://") || currentUrl.startsWith("about:")) {
      showNotification("Genealogy Logger", "Cannot run on internal or blank browser pages. Please open a genealogy website.");
      return;
    }

    // 2. Indicate working state via Badge
    await setBadge(tabId, "⏳", "#3b82f6");

    // 3. Check configuration in chrome.storage.sync
    let {
      geminiApiKey = "",
      webhookUrl = "https://script.google.com/macros/s/AKfycbw0h7QsRUeZqhwOL2FxRFu5z-xrhTubDISvzG96K6cP0WHYOKI3SKOttnL00lBggZCI/exec",
      defaultTabName = "Genealogy Log",
      saveScansToDrive = true,
      warnDuplicates = true,
      preferredModel = "gemini-3.6-flash",
      customInstructions = ""
    } = await chrome.storage.sync.get([
      "geminiApiKey",
      "webhookUrl",
      "defaultTabName",
      "saveScansToDrive",
      "warnDuplicates",
      "preferredModel",
      "customInstructions"
    ]);

    // Automatically migrate deprecated 2.5 models
    if (preferredModel === "gemini-2.5-flash" || !preferredModel) {
      preferredModel = "gemini-3.6-flash";
      chrome.storage.sync.set({ preferredModel });
    } else if (preferredModel === "gemini-2.5-pro") {
      preferredModel = "gemini-3.6-pro";
      chrome.storage.sync.set({ preferredModel });
    }

    if (!geminiApiKey || !webhookUrl) {
      await setBadge(tabId, "CFG", "#f59e0b");
      await sendToast(tabId, "Please configure your Gemini API Key and Webhook URL.", "error");
      chrome.runtime.openOptionsPage();
      return;
    }

    const targetTab = tabOverride || defaultTabName || "Genealogy Log";

    // 4. Duplicate Record Check
    if (warnDuplicates) {
      const { loggedRecordHistory = [] } = await chrome.storage.local.get("loggedRecordHistory");
      const existing = loggedRecordHistory.find(item => item.url === currentUrl);
      if (existing) {
        await sendToast(
          tabId,
          `ℹ️ Notice: You previously logged this record on ${existing.date}. Logging updated entry...`,
          "info",
          4000
        );
      }
    }

    // 5. Ensure content script is injected and extract DOM metadata
    await sendToast(tabId, `Extracting record for "${targetTab}"...`, "working", 3000);

    let extractedData = {};
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/extractor.js"]
      });

      const response = await chrome.tabs.sendMessage(tabId, { action: "extractData" });
      if (response && response.data) {
        extractedData = response.data;
      }
    } catch (scriptErr) {
      console.warn("DOM extraction fallback:", scriptErr);
      extractedData = {
        url: currentUrl,
        title: currentTab.title || "",
        siteCategory: "generic"
      };
    }

    // 6. Capture visible tab screenshot (viewport) with graceful fallback
    let base64Image = "";
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(currentTab.windowId || null, {
        format: "jpeg",
        quality: 85
      });
      if (dataUrl && dataUrl.includes(",")) {
        base64Image = dataUrl.split(",")[1];
      }
    } catch (captureErr) {
      console.warn("Visible tab screenshot capture failed, proceeding with DOM metadata:", captureErr);
    }

    // 7. Construct Gemini Prompt & Strict Schema
    const systemPrompt = `You are a professional genealogist and archivist.
Your job is to analyze the historical document image and provided page metadata to extract accurate biographical details.
Carefully review names, dates, places, relationships, and source citations.
Avoid guessing; if a field is unknown, leave it empty or note uncertainty in transcriptionOrSummary.
${customInstructions ? `Additional User Instructions: ${customInstructions}` : ""}`;

    const textPayload = {
      pageUrl: currentUrl,
      pageTitle: currentTab.title || "",
      userNotes: userNotes || undefined,
      domExtractedData: extractedData
    };

    const userPrompt = `Analyze this genealogical record and extract structured information:\n${JSON.stringify(textPayload, null, 2)}`;

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(preferredModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

    const contentParts = [{ text: userPrompt }];
    if (base64Image) {
      contentParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      });
    }

    const geminiBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          parts: contentParts
        }
      ],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: {
          type: "OBJECT",
          properties: {
            primaryPerson: {
              type: "STRING",
              description: "Full name of the primary individual in this record (e.g. 'John William Smith')."
            },
            eventType: {
              type: "STRING",
              description: "Event or record type, e.g. Birth, Death, Marriage, Census, Obituary, Military, Probate, Passenger List, etc."
            },
            eventDate: {
              type: "STRING",
              description: "Standardized date of the event, e.g. '14 Oct 1892' or 'abt 1905'."
            },
            eventPlace: {
              type: "STRING",
              description: "Normalized location, e.g. 'Boston, Suffolk, Massachusetts, United States'."
            },
            relatives: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "List of relatives with relationship, e.g. ['Father: Thomas Smith', 'Mother: Mary Clark', 'Spouse: Sarah Brown']."
            },
            collectionOrSource: {
              type: "STRING",
              description: "Name of the archive, record collection, or newspaper title."
            },
            citation: {
              type: "STRING",
              description: "Bibliographical citation or formal reference for this record."
            },
            transcriptionOrSummary: {
              type: "STRING",
              description: "Concise summary of key biographical facts, transcript snippet, or notes found in the record."
            }
          },
          required: ["primaryPerson", "eventType"]
        }
      }
    };

    let geminiReq = await fetch(geminiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody)
    });

    // Fallback: If chosen model returns 404 (e.g. deprecated/unsupported), automatically fallback to gemini-3.6-flash
    if (geminiReq.status === 404 && preferredModel !== "gemini-3.6-flash") {
      console.warn(`Model "${preferredModel}" returned 404. Falling back to gemini-3.6-flash.`);
      preferredModel = "gemini-3.6-flash";
      chrome.storage.sync.set({ preferredModel });
      const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
      geminiReq = await fetch(fallbackEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody)
      });
    }

    if (!geminiReq.ok) {
      const errText = await geminiReq.text();
      throw new Error(`Gemini API returned status ${geminiReq.status}: ${errText}`);
    }

    const geminiRes = await geminiReq.json();
    if (!geminiRes.candidates || geminiRes.candidates.length === 0) {
      throw new Error("Gemini returned no candidate responses.");
    }

    const rawJsonString = geminiRes.candidates[0].content.parts[0].text;
    let cleanedJson = rawJsonString.trim();
    if (cleanedJson.startsWith("```")) {
      cleanedJson = cleanedJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const parsedRecord = JSON.parse(cleanedJson);

    // Merge supplementary contextual fields for the spreadsheet
    let sourceHost = "";
    try {
      sourceHost = extractedData.hostname || new URL(currentUrl).hostname;
    } catch (e) {
      sourceHost = "web";
    }

    const finalPayload = {
      ...parsedRecord,
      targetTab,
      recordUrl: currentUrl,
      userNotes: userNotes || parsedRecord.userNotes || "",
      citation: parsedRecord.citation || extractedData.citation || "",
      sourceWebsite: sourceHost,
      // Include image base64 if Drive clipping saving is enabled
      imageJpegBase64: saveScansToDrive && base64Image ? base64Image : undefined
    };

    // 8. Dispatch to Google Apps Script Webhook
    const webhookReq = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(finalPayload)
    });

    if (!webhookReq.ok) {
      throw new Error(`Webhook failed with status: ${webhookReq.status}`);
    }

    // 9. Update Duplicate History in chrome.storage.local
    const { loggedRecordHistory = [] } = await chrome.storage.local.get("loggedRecordHistory");
    const today = new Date().toLocaleDateString();
    const updatedHistory = [
      { url: currentUrl, person: finalPayload.primaryPerson, date: today, timestamp: Date.now() },
      ...loggedRecordHistory.filter(item => item.url !== currentUrl)
    ].slice(0, 200); // Keep last 200 records

    await chrome.storage.local.set({ loggedRecordHistory: updatedHistory });

    // 10. Success Visual Feedback
    await setBadge(tabId, "✓", "#10b981");
    const personLabel = finalPayload.primaryPerson || "Record";
    const eventLabel = finalPayload.eventType ? `(${finalPayload.eventType})` : "";
    await sendToast(
      tabId,
      `✓ Logged ${personLabel} ${eventLabel} to "${targetTab}"!`,
      "success",
      5000
    );

    // Clear badge after 4 seconds
    setTimeout(() => {
      setBadge(tabId, "", "#000000");
    }, 4000);

  } catch (error) {
    console.error("Genealogy Logger Error:", error);
    await setBadge(tabId, "ERR", "#ef4444");
    await sendToast(tabId, `Logging failed: ${error.message || error}`, "error", 6000);
    showNotification("Genealogy Logger", `Logging failed: ${error.message || error}`);

    setTimeout(() => {
      setBadge(tabId, "", "#000000");
    }, 5000);
  } finally {
    activeTabProcessing.delete(tabId);
  }
}

/**
 * Helper: Sets toolbar badge text and color
 */
async function setBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color });
    }
  } catch (e) {
    // Ignore tab-closed errors
  }
}

/**
 * Helper: Sends in-page toast feedback
 */
async function sendToast(tabId, message, toastType = "info", duration = 4000) {
  try {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: "showToast",
        message,
        toastType,
        duration
      });
    } catch (msgErr) {
      // If content script is not yet injected on this tab, inject and retry
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/extractor.js"]
      });
      await chrome.tabs.sendMessage(tabId, {
        action: "showToast",
        message,
        toastType,
        duration
      });
    }
  } catch (e) {
    if (toastType === "error") {
      showNotification("Genealogy Logger", message);
    }
  }
}

/**
 * Helper: Displays a desktop notification
 */
function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.png",
      title,
      message
    });
  } catch (e) {
    console.warn("Notification error:", e);
  }
}