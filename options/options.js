// Genealogy Logger - Options Logic

const DEFAULT_INSTRUCTIONS = `You are an expert genealogical archivist. Analyze the provided document image and page text.
Extract and normalize the core biographical and vital statistics of the primary individual and their direct relatives.
Format historical dates (e.g. "12 Oct 1910") and geographical places (City, County, State, Country) accurately.
Distinguish between primary participants, informants, and associated family members.`;

const APPS_SCRIPT_CODE = `function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);
  try {
    const rawData = e.postData.contents;
    const data = JSON.parse(rawData);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = (data.targetTab || "Genealogy Log").trim();
    let sheet = ss.getSheetByName(tabName);
    const headers = [
      "Logged Date", "Primary Person", "Event Type", "Event Date", 
      "Event Place", "Family / Relatives", "Collection / Source", 
      "Citation", "Document Scan (Drive)", "Source Link", "Transcription / Summary", "User Notes"
    ];
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow(headers);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#1e293b").setFontColor("#f8fafc").setFontWeight("bold").setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
    }
    let scanUrl = "";
    if (data.imageJpegBase64) {
      try {
        const folderName = "Genealogy Document Clippings";
        const folders = DriveApp.getFoldersByName(folderName);
        const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
        const decoded = Utilities.base64Decode(data.imageJpegBase64);
        const dateTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
        const safeName = (data.primaryPerson || "Record").replace(/[^a-zA-Z0-9_\\- ]/g, "_");
        const file = folder.createFile(Utilities.newBlob(decoded, "image/jpeg", \`\${safeName}_\${dateTag}.jpg\`));
        scanUrl = file.getUrl();
      } catch (driveErr) {
        Logger.log("Drive save error: " + driveErr.toString());
      }
    }
    let relativesStr = "";
    if (Array.isArray(data.relatives)) {
      relativesStr = data.relatives.join("\\n");
    } else if (data.relatives && typeof data.relatives === "object") {
      relativesStr = Object.entries(data.relatives).map(([k, v]) => \`\${k}: \${v}\`).join("\\n");
    } else if (data.relatives) {
      relativesStr = String(data.relatives);
    }
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const sourceUrl = data.recordUrl || data.url || "";
    const scanCell = scanUrl ? \`=HYPERLINK("\${scanUrl}", "View Scan")\` : "No scan";
    const sourceCell = sourceUrl ? \`=HYPERLINK("\${sourceUrl}", "Open Record")\` : "";
    const row = [
      timestamp,
      data.primaryPerson || data.personName || "Unknown",
      data.eventType || "Record",
      data.eventDate || "",
      data.eventPlace || "",
      relativesStr,
      data.collectionOrSource || data.sourceWebsite || "",
      data.citation || "",
      scanCell,
      sourceCell,
      data.transcriptionOrSummary || data.notes || "",
      data.userNotes || ""
    ];
    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, row.length).setVerticalAlignment("top").setWrap(true);
    return ContentService.createTextOutput(JSON.stringify({ status: "success", tab: tabName, rowAdded: lastRow, scanUrl: scanUrl || null })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "ok", message: "Genealogy Logger Webhook is active and ready." })).setMimeType(ContentService.MimeType.JSON);
}`;

document.addEventListener("DOMContentLoaded", async () => {
  const geminiApiKeyInput = document.getElementById("geminiApiKey");
  const webhookUrlInput = document.getElementById("webhookUrl");
  const defaultTabNameInput = document.getElementById("defaultTabName");
  const saveScansToDriveCheck = document.getElementById("saveScansToDrive");
  const warnDuplicatesCheck = document.getElementById("warnDuplicates");
  const preferredModelSelect = document.getElementById("preferredModel");
  const customInstructionsInput = document.getElementById("customInstructions");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const toggleApiKeyBtn = document.getElementById("toggleApiKey");
  const saveFeedback = document.getElementById("saveFeedback");
  const overallStatus = document.getElementById("overallStatus");
  const statusText = document.getElementById("statusText");
  const copyScriptBtn = document.getElementById("copyScriptBtn");
  const copyScriptInline = document.getElementById("copyScriptInline");

  // Load existing settings
  const {
    geminiApiKey = "",
    webhookUrl = "https://script.google.com/macros/s/AKfycbw0h7QsRUeZqhwOL2FxRFu5z-xrhTubDISvzG96K6cP0WHYOKI3SKOttnL00lBggZCI/exec",
    defaultTabName = "Genealogy Log",
    saveScansToDrive = true,
    warnDuplicates = true,
    preferredModel = "gemini-2.5-flash",
    customInstructions = DEFAULT_INSTRUCTIONS
  } = await chrome.storage.sync.get([
    "geminiApiKey",
    "webhookUrl",
    "defaultTabName",
    "saveScansToDrive",
    "warnDuplicates",
    "preferredModel",
    "customInstructions"
  ]);

  geminiApiKeyInput.value = geminiApiKey;
  webhookUrlInput.value = webhookUrl;
  defaultTabNameInput.value = defaultTabName;
  saveScansToDriveCheck.checked = saveScansToDrive;
  warnDuplicatesCheck.checked = warnDuplicates;
  preferredModelSelect.value = preferredModel;
  customInstructionsInput.value = customInstructions;

  updateStatusBadge(geminiApiKey, webhookUrl);

  // Toggle API Key visibility
  toggleApiKeyBtn.addEventListener("click", () => {
    if (geminiApiKeyInput.type === "password") {
      geminiApiKeyInput.type = "text";
      toggleApiKeyBtn.textContent = "🙈";
    } else {
      geminiApiKeyInput.type = "password";
      toggleApiKeyBtn.textContent = "👁️";
    }
  });

  // Save Settings
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = geminiApiKeyInput.value.trim();
    const webhook = webhookUrlInput.value.trim();
    const tabName = defaultTabNameInput.value.trim() || "Genealogy Log";
    const saveScans = saveScansToDriveCheck.checked;
    const warnDupes = warnDuplicatesCheck.checked;
    const model = preferredModelSelect.value;
    const instructions = customInstructionsInput.value.trim();

    await chrome.storage.sync.set({
      geminiApiKey: apiKey,
      webhookUrl: webhook,
      defaultTabName: tabName,
      saveScansToDrive: saveScans,
      warnDuplicates: warnDupes,
      preferredModel: model,
      customInstructions: instructions
    });

    updateStatusBadge(apiKey, webhook);
    showFeedback("Settings saved successfully!", "success");
  });

  // Test Connection
  testBtn.addEventListener("click", async () => {
    const apiKey = geminiApiKeyInput.value.trim();
    const webhook = webhookUrlInput.value.trim();

    if (!apiKey) {
      showFeedback("Please enter a Gemini API Key to test.", "error");
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = "Testing...";
    showFeedback("Validating API Key and Webhook...", "info");

    try {
      // 1. Test Gemini API
      const geminiTestRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      );

      if (!geminiTestRes.ok) {
        throw new Error(`Gemini API error: ${geminiTestRes.status} ${geminiTestRes.statusText}`);
      }

      // 2. Test Webhook if provided
      let webhookMsg = "";
      if (webhook) {
        try {
          const webhookRes = await fetch(webhook, { method: "GET" });
          if (webhookRes.ok) {
            webhookMsg = " & Google Webhook connected!";
          } else {
            webhookMsg = ` (Warning: Webhook returned status ${webhookRes.status})`;
          }
        } catch (we) {
          webhookMsg = " (Note: Webhook verification skipped due to cross-origin, verify deployment)";
        }
      }

      showFeedback(`✓ Gemini API Key valid${webhookMsg}`, "success");
      updateStatusBadge(apiKey, webhook);
    } catch (err) {
      showFeedback(`✗ Validation Failed: ${err.message}`, "error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test Connection";
    }
  });

  // Copy Script logic
  function copyScript() {
    navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
      copyScriptBtn.textContent = "Copied!";
      setTimeout(() => (copyScriptBtn.textContent = "Copy Script Code"), 2500);
    });
  }

  copyScriptBtn.addEventListener("click", copyScript);
  if (copyScriptInline) copyScriptInline.addEventListener("click", copyScript);

  function updateStatusBadge(key, webhook) {
    if (key && webhook) {
      overallStatus.classList.add("ready");
      statusText.textContent = "Ready to Log";
    } else {
      overallStatus.classList.remove("ready");
      statusText.textContent = "Configuration Incomplete";
    }
  }

  function showFeedback(msg, type) {
    saveFeedback.className = `feedback-msg ${type}`;
    saveFeedback.textContent = msg;
    saveFeedback.style.display = "block";
    if (type === "success") {
      setTimeout(() => {
        saveFeedback.style.display = "none";
      }, 4000);
    }
  }
});
