/**
 * Google Apps Script for Genealogy Logger Chrome Extension
 * 
 * FEATURES:
 * - Family-line tab routing: the extension popup sends a persistent "targetFamilyLine"
 *   (configured & selected by the user in Settings/popup) and each family line gets its
 *   own sheet tab, auto-created with a self-healing header row.
 * - Google Drive clipping storage, into a folder you choose in Settings (or an
 *   auto-created "Genealogy Document Clippings" folder), sorted into surname subfolders
 * - Hyperlinked columns for Document Scan & Source URL
 * - Auto-formatting & column sizing
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your target Google Sheet.
 * 2. In top menu, click: Extensions > Apps Script.
 * 3. Replace all code with this script and save (Cmd+S / Ctrl+S).
 * 4. Project Settings (gear icon) > tick "Show 'appsscript.json' manifest file in
 *    editor", then paste in the appsscript.json from this same folder. This declares
 *    the OAuth scopes the script needs - without the external_request scope you get
 *    "You do not have permission to call UrlFetchApp.fetch" at runtime.
 * 5. In Project Settings > Script Properties add GEMINI_API_KEY (your Gemini key) and
 *    GAS_SECRET_KEY (any password, matching the extension settings). GEMINI_MODEL is
 *    optional - set it to override the default model, e.g. after Google retires one.
 *    Run listGeminiModels() to see what your key can call.
 * 6. Select "forceAuth" in the function dropdown and click Run. Approve the permission
 *    prompt (Advanced > Go to project (unsafe) > Allow). This is the ONLY reliable way
 *    to trigger the consent screen - running doGet will not, because it touches no
 *    protected services and therefore requires no scopes.
 * 7. Click "Deploy" > "New deployment" > Select type "Web app".
 * 8. Set "Execute as": "Me" and "Who has access": "Anyone".
 * 9. Click "Deploy" and copy the Web app URL.
 * 10. Paste the Web app URL into the Genealogy Logger extension settings, along with
 *    your Google Sheet's URL (Settings > Step 3) and optionally a Drive folder URL for
 *    document scans (Step 4). Those tell the script where to write - nothing needs to
 *    be hardcoded here.
 *
 * IMPORTANT: authorization is granted per Google account. Whichever account you are
 * signed in as when you deploy is the account the web app executes as, so it must be
 * the same account that approved the prompt in step 6.
 */

// Normally leave blank. The extension sends the target sheet from its Settings page,
// and a container-bound script (Extensions > Apps Script from inside your sheet) finds
// its own sheet. Set this only to pin a specific sheet in code; copy the id from the
// sheet URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
const SPREADSHEET_ID = "";
const DEFAULT_TAB_NAME = "Genealogy Log";

// Where document clippings are filed. Normally blank - the extension sends the folder
// from its Settings page. Set this to pin one in code; copy the id from the folder URL:
// drive.google.com/drive/folders/<THIS PART>
const DRIVE_FOLDER_ID = "";
const DEFAULT_CLIPPINGS_FOLDER = "Genealogy Document Clippings";

// Gemini model id. Google retires these periodically, so it is overridable without a code
// edit: set a GEMINI_MODEL script property to switch. Run listGeminiModels() from the
// editor to see what your key can currently use.
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const HEADERS = [
  "Logged Date", "Primary Person", "Event Type", "Event Date",
  "Event Place", "Family / Relatives", "Collection / Source",
  "Citation", "Document Scan (Drive Link)", "Source Link", "Transcription", "Notes"
];

// Google Sheets forbids : \ / ? * [ ] in a tab name and caps it at 100 chars.
function sanitizeTabName(name) {
  const cleaned = (name || "").toString().replace(/[:\\/?*\[\]]/g, "").trim();
  return cleaned ? cleaned.slice(0, 100) : DEFAULT_TAB_NAME;
}

// Resolves the target spreadsheet, in priority order:
//   1. the id the extension sends (Settings > Google Sheet URL) - most explicit
//   2. the SPREADSHEET_ID constant below - for standalone deployments
//   3. the bound spreadsheet - the documented "Extensions > Apps Script" setup
// Anyone holding the webhook URL and API key can therefore target any sheet this
// account can open; the API key is the security boundary, so keep it secret.
function getSpreadsheet(requestedId) {
  const id = (requestedId || "").toString().trim() || SPREADSHEET_ID;

  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      throw new Error(
        "Could not open spreadsheet id '" + id + "'. Check that it matches the /d/<ID>/ portion " +
        "of your sheet's URL and that " + getAccountLabel() + " can open it. (" + err.message + ")"
      );
    }
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  throw new Error(
    "No spreadsheet configured. Paste your sheet's URL into the extension's Settings page, " +
    "or create this script from inside the sheet itself (Extensions > Apps Script)."
  );
}

// Resolves the base folder for document clippings, in the same priority order as the
// spreadsheet: the id the extension sends, then DRIVE_FOLDER_ID, then a folder named
// DEFAULT_CLIPPINGS_FOLDER in the account's Drive (created if it doesn't exist yet).
function getClippingsFolder(requestedId) {
  const id = (requestedId || "").toString().trim() || DRIVE_FOLDER_ID;

  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      throw new Error(
        "Could not open Drive folder id '" + id + "'. Check that it matches the /folders/<ID> " +
        "portion of the folder's URL and that " + getAccountLabel() + " can open it. (" + err.message + ")"
      );
    }
  }

  const existing = DriveApp.getFoldersByName(DEFAULT_CLIPPINGS_FOLDER);
  return existing.hasNext() ? existing.next() : DriveApp.createFolder(DEFAULT_CLIPPINGS_FOLDER);
}

// Best-effort account name for error messages; never let it break the real error.
function getAccountLabel() {
  try {
    return Session.getEffectiveUser().getEmail() || "this account";
  } catch (err) {
    return "this account";
  }
}

// Model ids that this API key can currently call generateContent on.
function getAvailableGeminiModels(apiKey) {
  const res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey,
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return [];

  const models = JSON.parse(res.getContentText()).models || [];
  return models
    .filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") !== -1)
    .map((m) => (m.name || "").replace(/^models\//, ""));
}

// --- Drive browsing for the Settings pickers -------------------------------------
// These run here rather than in the extension on purpose: this script is already
// authorized for Drive, so the extension needs no OAuth client and no restricted
// scopes. It also guarantees anything listed is visible to the account that writes.

const BROWSE_LIMIT = 300;

// Subfolders of parentId (or My Drive when omitted), plus breadcrumb info.
function listDriveFolders(parentId) {
  const id = (parentId || "").toString().trim();
  const current = id ? DriveApp.getFolderById(id) : DriveApp.getRootFolder();

  const folders = [];
  const it = current.getFolders();
  while (it.hasNext() && folders.length < BROWSE_LIMIT) {
    const f = it.next();
    folders.push({ id: f.getId(), name: f.getName() });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));

  // Root has no parent; anything else may have several - the first is enough to go up.
  let parent = null;
  const rootId = DriveApp.getRootFolder().getId();
  if (current.getId() !== rootId) {
    const parents = current.getParents();
    parent = parents.hasNext()
      ? { id: parents.next().getId(), name: "Up one level" }
      : { id: rootId, name: "My Drive" };
  }

  return {
    current: { id: current.getId(), name: current.getId() === rootId ? "My Drive" : current.getName(), url: current.getUrl() },
    parent: parent,
    folders: folders
  };
}

// Spreadsheets this account can open, newest first, optionally name-filtered.
function listDriveSheets(query) {
  const term = (query || "").toString().trim().replace(/['"\\]/g, "");
  const files = term
    ? DriveApp.searchFiles('mimeType = "application/vnd.google-apps.spreadsheet" and title contains "' + term + '" and trashed = false')
    : DriveApp.getFilesByType(MimeType.GOOGLE_SHEETS);

  const sheets = [];
  while (files.hasNext() && sheets.length < BROWSE_LIMIT) {
    const f = files.next();
    sheets.push({ id: f.getId(), name: f.getName(), updated: f.getLastUpdated().getTime() });
  }
  sheets.sort((a, b) => b.updated - a.updated);
  return sheets;
}

// The model to call, in priority order: what the extension sends (Settings dropdown),
// then a GEMINI_MODEL script property, then the constant above.
function getConfiguredModel(requested) {
  const model = (requested || "").toString().trim()
    || PropertiesService.getScriptProperties().getProperty("GEMINI_MODEL")
    || DEFAULT_GEMINI_MODEL;
  return model.trim().replace(/^models\//, "");
}

/**
 * Run this from the editor to list the models your key can use, then set the winner as a
 * GEMINI_MODEL script property. Useful when Google retires the configured model and
 * logging starts failing with a 404.
 */
function listGeminiModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in Script Properties");

  const names = getAvailableGeminiModels(apiKey);
  Logger.log("Currently configured: " + (PropertiesService.getScriptProperties().getProperty("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL));
  Logger.log("Available models (" + names.length + "):\n" + names.join("\n"));
  return names;
}

// Ensures the given sheet's row 1 matches HEADERS, rewriting it if it's missing,
// stale (an older schema), or belongs to a brand-new tab. Never touches data rows.
function ensureHeaders(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  const currentHeaders = sheet.getLastRow() > 0 ? headerRange.getValues()[0] : [];
  const headersMatch = HEADERS.every((h, i) => currentHeaders[i] === h);
  if (!headersMatch) {
    headerRange.setValues([HEADERS]);
    headerRange.setBackground("#1e293b").setFontColor("#f8fafc").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000);
  if (!gotLock) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Server busy, please try again." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const rawData = e.postData.contents;
    const data = JSON.parse(rawData);

    // 1. Endpoint Security Check
    const apiKey = e.parameter["x-api-key"] || data.apiKey;
    const expectedKey = PropertiesService.getScriptProperties().getProperty("GAS_SECRET_KEY") || "GENEALOGY_SECRET_2026";
    if (apiKey !== expectedKey) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "403 Forbidden" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 1b. Connection test from the Settings page. Confirms the endpoint, the API key and
    // which spreadsheet we resolve to - without calling Gemini or writing a row.
    if (data.test === true) {
      const testSheet = getSpreadsheet(data.spreadsheetId);
      const testFolder = getClippingsFolder(data.driveFolderId);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Connected. Logging to \"" + testSheet.getName() + "\", scans to \"" + testFolder.getName() + "\".",
        spreadsheet: testSheet.getName(),
        spreadsheetUrl: testSheet.getUrl(),
        driveFolder: testFolder.getName(),
        driveFolderUrl: testFolder.getUrl(),
        account: getAccountLabel()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1c. Model list for the Settings page dropdown. The Gemini key lives here, not in the
    // extension, so the options page asks us rather than calling Google directly.
    if (data.listModels === true) {
      const listKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
      if (!listKey) throw new Error("GEMINI_API_KEY not set in Script Properties");
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        models: getAvailableGeminiModels(listKey),
        scriptDefault: getConfiguredModel()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1d. Drive pickers in the Settings page.
    if (data.listFolders === true) {
      const result = listDriveFolders(data.parentId);
      result.status = "success";
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.listSheets === true) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        sheets: listDriveSheets(data.query)
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Gemini API Call for Structured Data
    const geminiApiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY not set in Script Properties");

    const geminiModel = getConfiguredModel(data.geminiModel);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
    
    const prompt = `You are an expert genealogist. Analyze the following raw text and document image (if provided).
Extract the genealogical facts into a structured JSON format.
Make sure to include a comprehensive 'transcription' of the actual historical record data if it is present in the raw text.
${data.notes ? "The researcher added this note, which may identify the person of interest: " + data.notes + "\n" : ""}Raw Text: ${data.rawText}`;

    let geminiContentParts = [{ text: prompt }];

    if (data.fileBase64) {
      geminiContentParts.push({
        inlineData: {
          mimeType: data.mimeType || "image/jpeg",
          data: data.fileBase64
        }
      });
    }

    const geminiPayload = {
      contents: [{ parts: geminiContentParts }],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: {
          type: "OBJECT",
          properties: {
            primaryPerson: { type: "STRING" },
            eventType: { type: "STRING", description: "e.g., Census, Marriage, Birth, Death" },
            eventDate: { type: "STRING", description: "YYYY-MM-DD or standardized historical date" },
            eventPlace: { type: "STRING", description: "City, County, State, Country" },
            familyLine: { type: "STRING", description: "Primary surname for folder routing" },
            relatives: { type: "ARRAY", items: { type: "STRING", description: "Format: 'Relationship: Name'" } },
            collectionSource: { type: "STRING", description: "e.g., 1880 United States Federal Census" },
            citation: { type: "STRING" },
            transcription: { type: "STRING", description: "The full text transcription of the historical record or document." },
            geoFileName: { type: "STRING", description: "YYYY-MM-DD_Country_State_County_City_RecordType_Name" }
          },
          required: ["primaryPerson", "eventType", "familyLine", "geoFileName"]
        }
      }
    };

    const geminiOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(geminiPayload),
      muteHttpExceptions: true
    };

    const geminiResponse = UrlFetchApp.fetch(geminiUrl, geminiOptions);
    if (geminiResponse.getResponseCode() === 404) {
      // Almost always a retired model id. Say which ids actually work right now.
      const available = getAvailableGeminiModels(geminiApiKey);
      throw new Error(
        "Gemini model '" + geminiModel + "' is not available to this API key. " +
        (available.length
          ? "Pick a different one in the extension's Settings (Gemini Model), or set a " +
            "GEMINI_MODEL script property. Available: " + available.join(", ")
          : "Could not list available models - check that GEMINI_API_KEY is valid.")
      );
    }
    if (geminiResponse.getResponseCode() !== 200) {
      throw new Error("Gemini API Error: " + geminiResponse.getContentText());
    }
    
    const geminiData = JSON.parse(geminiResponse.getContentText());
    const candidate = geminiData.candidates && geminiData.candidates[0];
    const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
    if (!part || !part.text) {
      throw new Error("Gemini returned no usable content (finishReason: " + (candidate && candidate.finishReason || "unknown") + ")");
    }
    const extractedJson = JSON.parse(part.text);

    // 2b. Dry run from the Settings page: the model answered, so configuration is
    // sound. Stop before touching Drive or the sheet.
    if (data.dryRun === true) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Gemini responded using " + geminiModel + ". Nothing was written.",
        model: geminiModel,
        extractedData: extractedJson
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. File Handling & Drive Routing
    // Note: this is Gemini's auto-detected surname, used only to bucket the Drive clipping.
    // It's intentionally independent of `targetFamilyLine` below, which drives the sheet tab
    // and is a persistent choice the user makes in the popup/Settings.
    const familyLine = extractedJson.familyLine || "Uncategorized";
    const baseFolder = getClippingsFolder(data.driveFolderId);

    let familyFolder;
    const familyFolders = baseFolder.getFoldersByName(familyLine);
    if (familyFolders.hasNext()) {
      familyFolder = familyFolders.next();
    } else {
      familyFolder = baseFolder.createFolder(familyLine);
    }

    let fileUrl = "";
    if (data.fileBase64 || data.printUrl) {
      let blob;
      let extension = ".jpg";
      let mimeType = data.mimeType || "image/jpeg";
      
      if (mimeType === "image/png") extension = ".png";
      else if (mimeType === "application/pdf") extension = ".pdf";
      
      let finalFileName = (extractedJson.geoFileName || "document").replace(/\.[^/.]+$/, "") + extension;

      if (data.fileBase64) {
        const decoded = Utilities.base64Decode(data.fileBase64);
        blob = Utilities.newBlob(decoded, mimeType, finalFileName);
      } else if (data.printUrl) {
        const fetchRes = UrlFetchApp.fetch(data.printUrl);
        blob = fetchRes.getBlob().setName(finalFileName);
      }
      
      if (blob) {
        const file = familyFolder.createFile(blob);
        fileUrl = file.getUrl();
      }
    }

    // 4. Append to Spreadsheet
    const ss = getSpreadsheet(data.spreadsheetId);
    const tabName = data.targetFamilyLine ? sanitizeTabName(data.targetFamilyLine) : DEFAULT_TAB_NAME;
    let sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    }
    // Always verify/repair row 1 against the current schema — this both seeds a brand-new
    // tab and heals an existing tab whose headers were written under an older schema.
    ensureHeaders(sheet);

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const scanCell = fileUrl ? `=HYPERLINK("${fileUrl}", "View Scan")` : "No scan";
    const sourceCell = data.sourceUrl ? `=HYPERLINK("${data.sourceUrl}", "Open Record")` : "";
    const relativesStr = extractedJson.relatives ? extractedJson.relatives.join("\n") : "";

    const sanitize = (val) => {
      if (typeof val !== "string") return val;
      if (/^[=+\-@]/.test(val)) {
        return "'" + val;
      }
      return val;
    };

    const row = [
      timestamp,
      sanitize(extractedJson.primaryPerson || "Unknown"),
      sanitize(extractedJson.eventType || ""),
      sanitize(extractedJson.eventDate || ""),
      sanitize(extractedJson.eventPlace || ""),
      sanitize(relativesStr),
      sanitize(extractedJson.collectionSource || ""),
      sanitize(extractedJson.citation || ""),
      scanCell,
      sourceCell,
      sanitize(extractedJson.transcription || ""),
      sanitize(data.notes || "")
    ];

    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, row.length).setVerticalAlignment("top").setWrap(true);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      tab: tabName,
      rowAdded: lastRow,
      spreadsheetUrl: ss.getUrl(),
      scanUrl: fileUrl || null,
      extractedData: extractedJson
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok", message: "Genealogy Logger Webhook is active and ready." })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * One-time authorization helper. Run this manually from the Apps Script editor to
 * trigger Google's consent screen for every scope doPost needs.
 *
 * doGet/doPost cannot do this for you: doGet only uses ContentService (zero scopes),
 * and doPost is invoked anonymously over HTTP, where Google cannot show a prompt - it
 * just fails with "You do not have permission to call UrlFetchApp.fetch".
 *
 * Safe to run repeatedly: it only reads, and writes nothing.
 */
function forceAuth() {
  UrlFetchApp.fetch("https://www.google.com");           // script.external_request
  getSpreadsheet().getName();                            // spreadsheets
  DriveApp.getRootFolder().getName();                    // drive
  Logger.log("Authorization complete for: " + Session.getEffectiveUser().getEmail());
}
