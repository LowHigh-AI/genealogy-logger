/**
 * Google Apps Script for Genealogy Logger Chrome Extension
 * 
 * FEATURES:
 * - Family-line tab routing: the extension popup sends a persistent "targetFamilyLine"
 *   (configured & selected by the user in Settings/popup) and each family line gets its
 *   own sheet tab, auto-created with a self-healing header row.
 * - Automatic Google Drive clipping storage (saves document screenshot to Drive folder)
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
 * 5. Select "forceAuth" in the function dropdown and click Run. Approve the permission
 *    prompt (Advanced > Go to project (unsafe) > Allow). This is the ONLY reliable way
 *    to trigger the consent screen - running doGet will not, because it touches no
 *    protected services and therefore requires no scopes.
 * 6. Click "Deploy" > "New deployment" > Select type "Web app".
 * 7. Set "Execute as": "Me" and "Who has access": "Anyone".
 * 8. Click "Deploy" and copy the Web app URL.
 * 9. Paste the Web app URL into the Genealogy Logger extension settings, along with
 *    your Google Sheet's URL (Settings > Step 3). That is what tells the script which
 *    spreadsheet to write to - no id needs to be hardcoded here.
 *
 * IMPORTANT: authorization is granted per Google account. Whichever account you are
 * signed in as when you deploy is the account the web app executes as, so it must be
 * the same account that approved the prompt in step 5.
 */

// Normally leave blank. The extension sends the target sheet from its Settings page,
// and a container-bound script (Extensions > Apps Script from inside your sheet) finds
// its own sheet. Set this only to pin a specific sheet in code; copy the id from the
// sheet URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
const SPREADSHEET_ID = "";
const DEFAULT_TAB_NAME = "Genealogy Log";
const HEADERS = [
  "Logged Date", "Primary Person", "Event Type", "Event Date",
  "Event Place", "Family / Relatives", "Collection / Source",
  "Citation", "Document Scan (Drive Link)", "Source Link", "Transcription"
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

// Best-effort account name for error messages; never let it break the real error.
function getAccountLabel() {
  try {
    return Session.getEffectiveUser().getEmail() || "this account";
  } catch (err) {
    return "this account";
  }
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

    // 2. Gemini API Call for Structured Data
    const geminiApiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY not set in Script Properties");

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    
    const prompt = `You are an expert genealogist. Analyze the following raw text and document image (if provided).
Extract the genealogical facts into a structured JSON format.
Make sure to include a comprehensive 'transcription' of the actual historical record data if it is present in the raw text.
Raw Text: ${data.rawText}`;

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

    // 3. File Handling & Drive Routing
    // Note: this is Gemini's auto-detected surname, used only to bucket the Drive clipping.
    // It's intentionally independent of `targetFamilyLine` below, which drives the sheet tab
    // and is a persistent choice the user makes in the popup/Settings.
    const familyLine = extractedJson.familyLine || "Uncategorized";
    const baseFolderName = "Genealogy Document Clippings";
    
    let baseFolder;
    const baseFolders = DriveApp.getFoldersByName(baseFolderName);
    if (baseFolders.hasNext()) {
      baseFolder = baseFolders.next();
    } else {
      baseFolder = DriveApp.createFolder(baseFolderName);
    }

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
      sanitize(extractedJson.transcription || "")
    ];

    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, row.length).setVerticalAlignment("top").setWrap(true);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      tab: tabName,
      rowAdded: lastRow,
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
