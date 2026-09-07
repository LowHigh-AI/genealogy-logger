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

/**
 * Main workflow: extracts DOM metadata & screenshot, prompts Gemini 2.5 Flash,
 * and logs structured genealogical data to Google Sheets via Webhook.
 */
async function executeLogWorkflow(tab, userNotes = "", tabOverride = "") {
  if (!tab || !tab.id) return;

  // Restrict execution on internal browser pages
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
    showNotification("Genealogy Logger", "Cannot run on internal browser pages. Please open a genealogy website.");
    return;
  }

  const tabId = tab.id;

  try {
    // 1. Indicate working state via Badge
    await setBadge(tabId, "⏳", "#3b82f6");

    // 2. Check configuration in chrome.storage.sync
    const {
      geminiApiKey = "",
      webhookUrl = "https://script.google.com/macros/s/AKfycbw0h7QsRUeZqhwOL2FxRFu5z-xrhTubDISvzG96K6cP0WHYOKI3SKOttnL00lBggZCI/exec",
      defaultTabName = "Genealogy Log",
      saveScansToDrive = true,
      warnDuplicates = true,
      preferredModel = "gemini-2.5-flash",
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

    if (!geminiApiKey || !webhookUrl) {
      await setBadge(tabId, "CFG", "#f59e0b");
      await sendToast(tabId, "Please configure your Gemini API Key and Webhook URL.", "error");
      chrome.runtime.openOptionsPage();
      return;
    }

    const targetTab = tabOverride || defaultTabName || "Genealogy Log";

    // 3. Duplicate Record Check
    if (warnDuplicates) {
      const { loggedRecordHistory = [] } = await chrome.storage.local.get("loggedRecordHistory");
      const existing = loggedRecordHistory.find(item => item.url === tab.url);
      if (existing) {
        await sendToast(
          tabId,
          `ℹ️ Notice: You previously logged this record on ${existing.date}. Logging updated entry...`,
          "info",
          4000
        );
      }
    }

    // 4. Ensure content script is injected and extract DOM metadata
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
        url: tab.url,
        title: tab.title,
        siteCategory: "generic"
      };
    }

    // 5. Capture visible tab screenshot (viewport)
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 85
    });
    const base64Image = dataUrl.split(",")[1];

    // 6. Construct Gemini Prompt & Strict Schema
    const systemPrompt = `You are a professional genealogist and archivist.
Your job is to analyze the historical document image and provided page metadata to extract accurate biographical details.
Carefully review names, dates, places, relationships, and source citations.
Avoid guessing; if a field is unknown, leave it empty or note uncertainty in transcriptionOrSummary.
${customInstructions ? `Additional User Instructions: ${customInstructions}` : ""}`;

    const textPayload = {
      pageUrl: tab.url,
      pageTitle: tab.title,
      userNotes: userNotes || undefined,
      domExtractedData: extractedData
    };

    const userPrompt = `Analyze this genealogical record and extract structured information:\n${JSON.stringify(textPayload, null, 2)}`;

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(preferredModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

    const geminiBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          parts: [
            { text: userPrompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
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

    const geminiReq = await fetch(geminiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody)
    });

    if (!geminiReq.ok) {
      const errText = await geminiReq.text();
      throw new Error(`Gemini API returned status ${geminiReq.status}: ${errText}`);
    }

    const geminiRes = await geminiReq.json();
    if (!geminiRes.candidates || geminiRes.candidates.length === 0) {
      throw new Error("Gemini returned no candidate responses.");
    }

    const rawJsonString = geminiRes.candidates[0].content.parts[0].text;
    const parsedRecord = JSON.parse(rawJsonString);

    // Merge supplementary contextual fields for the spreadsheet
    const finalPayload = {
      ...parsedRecord,
      targetTab,
      recordUrl: tab.url,
      userNotes: userNotes || parsedRecord.userNotes || "",
      citation: parsedRecord.citation || extractedData.citation || "",
      sourceWebsite: extractedData.hostname || new URL(tab.url).hostname,
      // Include image base64 if Drive clipping saving is enabled
      imageJpegBase64: saveScansToDrive ? base64Image : undefined
    };

    // 7. Dispatch to Google Apps Script Webhook
    const webhookReq = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(finalPayload)
    });

    if (!webhookReq.ok) {
      throw new Error(`Webhook failed with status: ${webhookReq.status}`);
    }

    // 8. Update Duplicate History in chrome.storage.local
    const { loggedRecordHistory = [] } = await chrome.storage.local.get("loggedRecordHistory");
    const today = new Date().toLocaleDateString();
    const updatedHistory = [
      { url: tab.url, person: finalPayload.primaryPerson, date: today, timestamp: Date.now() },
      ...loggedRecordHistory.filter(item => item.url !== tab.url)
    ].slice(0, 200); // Keep last 200 records

    await chrome.storage.local.set({ loggedRecordHistory: updatedHistory });

    // 9. Success Visual Feedback
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

    setTimeout(() => {
      setBadge(tabId, "", "#000000");
    }, 5000);
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
    await chrome.tabs.sendMessage(tabId, {
      action: "showToast",
      message,
      toastType,
      duration
    });
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