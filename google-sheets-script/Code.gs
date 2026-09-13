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

// Gemini model id. Prefer a floating "-latest" alias: Google retires numbered
// versions while still listing them in ListModels, so a pinned id eventually starts
// returning 404 even though it looks available. Override with a GEMINI_MODEL script
// property or the extension's Settings; run listGeminiModels() to see the full list.
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
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

// Gemini returns these when it is busy rather than misconfigured, so they are worth
// retrying: 429 rate limit, 503 "high demand", and the 5xx gateway family.
const GEMINI_RETRY_CODES = [429, 500, 502, 503, 504];
const GEMINI_MAX_ATTEMPTS = 3;
// Never hold the request open longer than this for one retry. Past it we give up and
// tell the user how long to wait, rather than stalling the popup.
const GEMINI_MAX_WAIT_MS = 10000;

// Quota errors carry the exact wait in a RetryInfo detail (and again in the message).
// Honouring it matters: retrying sooner cannot succeed and spends another request
// against the very quota that is exhausted.
function getRetryDelaySeconds(response) {
  try {
    const body = JSON.parse(response.getContentText());
    const details = (body.error && body.error.details) || [];
    for (let i = 0; i < details.length; i++) {
      const d = details[i];
      if (d["@type"] && d["@type"].indexOf("RetryInfo") !== -1 && d.retryDelay) {
        const parsed = parseFloat(d.retryDelay);
        if (!isNaN(parsed)) return parsed;
      }
    }
    const msg = (body.error && body.error.message) || "";
    const m = msg.match(/retry in ([\d.]+)\s*s/i);
    if (m) return parseFloat(m[1]);
  } catch (err) {
    // no structured detail available
  }
  return null;
}

// Exponential backoff with jitter. Worst case adds ~5s, well inside the Apps Script
// execution limit, and saves the user from losing a capture to a momentary spike.
function fetchGeminiWithRetry(url, options) {
  let response = null;
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    response = UrlFetchApp.fetch(url, options);
    if (GEMINI_RETRY_CODES.indexOf(response.getResponseCode()) === -1) {
      return response; // succeeded, or failed for a reason retrying will not fix
    }
    if (attempt === GEMINI_MAX_ATTEMPTS) break;

    const serverWait = getRetryDelaySeconds(response);
    const waitMs = serverWait !== null
      ? serverWait * 1000
      : Math.pow(2, attempt - 1) * 1500 + Math.floor(Math.random() * 500);

    // A long mandated wait means retrying here is pointless and wasteful.
    if (waitMs > GEMINI_MAX_WAIT_MS) return response;
    Utilities.sleep(waitMs);
  }
  return response; // still failing; the caller reports it
}

// Quota failures name which ceiling was hit, e.g.
// "GenerateRequestsPerDayPerProjectPerModel-FreeTier" vs "...PerMinute...".
// The distinction matters: a per-minute cap clears on its own, a daily one does not,
// and queueing against a daily cap would retry pointlessly for hours.
function getQuotaViolation(response) {
  try {
    const body = JSON.parse(response.getContentText());
    const details = (body.error && body.error.details) || [];
    for (let i = 0; i < details.length; i++) {
      const d = details[i];
      if (d["@type"] && d["@type"].indexOf("QuotaFailure") !== -1) {
        const v = (d.violations || [])[0];
        if (v) {
          const id = v.quotaId || "";
          return {
            id: id,
            value: v.quotaValue || "",
            perDay: /PerDay/i.test(id),
            perMinute: /PerMinute/i.test(id)
          };
        }
      }
    }
  } catch (err) {
    // no structured quota detail
  }
  return null;
}

// Pulls the human-readable line out of Gemini's error envelope.
function geminiErrorMessage(response) {
  try {
    const body = JSON.parse(response.getContentText());
    if (body && body.error && body.error.message) return body.error.message;
  } catch (err) {
    // fall through to the raw text
  }
  return response.getContentText();
}

// Models that can't do this job, however healthy they look in ListModels: speech,
// image generation, transcription-only, robotics, research agents and Gemma.
const SPECIALIST_MODEL_PATTERN =
  /tts|audio|speech|image|transcribe|robotics|computer-use|customtools|deep-research|lyria|embedding|banana|veo|imagen/;

// The subset worth showing a user: Gemini text models that accept an image alongside
// the prompt, ranked so the best default is first. Floating "-latest" aliases lead
// because they survive Google retiring numbered versions; then newest flash, then pro.
function filterUsableModels(names, exclude) {
  const usable = names.filter(function (n) {
    return n.indexOf("gemini") === 0 && n !== exclude && !SPECIALIST_MODEL_PATTERN.test(n);
  });

  const version = function (n) {
    const m = n.match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const tier = function (n) {
    if (/-latest$/.test(n)) return /flash/.test(n) ? 0 : 1;
    if (/preview/.test(n)) return 4;
    return /flash/.test(n) ? 2 : 3;
  };

  usable.sort(function (a, b) {
    return tier(a) - tier(b) || version(b) - version(a) || a.localeCompare(b);
  });
  return usable;
}

// Short, actionable list for an error message.
function suggestGeminiModels(names, exclude) {
  return filterUsableModels(names, exclude).slice(0, 6);
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
  const usable = filterUsableModels(names);
  Logger.log("Currently configured: " + getConfiguredModel());
  Logger.log("Recommended for this script (" + usable.length + "):\n" + usable.join("\n"));
  Logger.log("\nEverything the key can call (" + names.length + "):\n" + names.join("\n"));
  return usable;
}

// Turns escape sequences the model emitted literally back into real characters.
// Gemini frequently double-escapes inside structured output, so "\\n" survives
// JSON.parse as a backslash followed by an n and renders as \n in the cell.
function normalizeText(val) {
  if (typeof val !== "string") return val;
  return val
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/[ \t]+\n/g, "\n")   // trailing spaces before a break
    .trim();
}

// Column widths that keep a long transcription readable instead of stretching the row
// off-screen. Applied whenever the header row is written or restyled.
const COLUMN_WIDTHS = [150, 150, 120, 110, 190, 170, 190, 220, 130, 110, 420, 220];
const HEADER_BG = "#2e6b4f";   // heritage green, matching the extension
const HEADER_FG = "#ffffff";

function applyColumnWidths(sheet) {
  for (let i = 0; i < COLUMN_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, COLUMN_WIDTHS[i]);
  }
}

/**
 * Run from the editor to apply the current header row and column widths to every tab.
 * Useful after a schema change, since ensureHeaders only reformats when it has to.
 */
function formatAllTabs() {
  const sheets = getSpreadsheet().getSheets();
  sheets.forEach(function (sheet) {
    ensureHeaders(sheet);
    applyColumnWidths(sheet);
    Logger.log("Formatted: " + sheet.getName());
  });
}

// Ensures the given sheet's row 1 matches HEADERS, rewriting it if it's missing,
// stale (an older schema), or belongs to a brand-new tab. Never touches data rows.
function ensureHeaders(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  const currentHeaders = sheet.getLastRow() > 0 ? headerRange.getValues()[0] : [];
  const headersMatch = HEADERS.every((h, i) => currentHeaders[i] === h);

  // Styling drifts independently of the values: a tab written by an older version has
  // the right columns but the old palette and default widths. Heal both, so nobody has
  // to run a formatting function by hand.
  const styleMatch = headerRange.getBackground().toLowerCase() === HEADER_BG;

  if (!headersMatch) {
    headerRange.setValues([HEADERS]);
  }
  if (!headersMatch || !styleMatch) {
    headerRange.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
    sheet.setFrozenRows(1);
    applyColumnWidths(sheet);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000);
  if (!gotLock) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Another record is being logged right now.",
      retryable: true,
      retryAfter: 30
    })).setMimeType(ContentService.MimeType.JSON);
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
      const allModels = getAvailableGeminiModels(listKey);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        models: filterUsableModels(allModels),
        allModels: allModels,
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
Write the transcription as readable prose with real line breaks between lines of the record. Do not write escaped sequences such as \\n, and do not wrap it in JSON or markdown.
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

    const geminiResponse = fetchGeminiWithRetry(geminiUrl, geminiOptions);
    if (geminiResponse.getResponseCode() === 404) {
      // Almost always a retired model id. Note that a retired model often still
      // appears in ListModels, so "it was in the list" does not mean it is callable.
      const available = getAvailableGeminiModels(geminiApiKey);
      if (!available.length) {
        throw new Error(
          "Gemini model '" + geminiModel + "' returned 404, and the model list could not " +
          "be read either - check that GEMINI_API_KEY is valid."
        );
      }
      const listed = available.indexOf(geminiModel) !== -1;
      throw new Error(
        "Gemini model '" + geminiModel + "' would not run" +
        (listed
          ? " even though it is still listed - Google has most likely retired it. "
          : " and is not available to this API key. ") +
        "Pick another in the extension's Settings (Gemini Model), or set a GEMINI_MODEL " +
        "script property. Recommended: " + suggestGeminiModels(available, geminiModel).join(", ") +
        " (" + available.length + " models available in total)."
      );
    }
    const geminiCode = geminiResponse.getResponseCode();
    if (GEMINI_RETRY_CODES.indexOf(geminiCode) !== -1) {
      // Google is overloaded, not misconfigured - say so, because the raw envelope
      // reads like something the user broke.
      const waitSeconds = getRetryDelaySeconds(geminiResponse);
      const waitAdvice = waitSeconds
        ? "Try again in about " + Math.ceil(waitSeconds) + " seconds."
        : "Wait a moment and try again.";

      let transient;
      if (geminiCode === 429) {
        const quota = getQuotaViolation(geminiResponse);
        if (quota && quota.perDay) {
          // Waiting will not help today, so say so plainly instead of offering a retry.
          transient = new Error(
            "You have used today's free-tier allowance for " + geminiModel +
            (quota.value ? " (" + quota.value + " requests per day)" : "") + ". " +
            "It resets at midnight Pacific time. To keep working now, switch to a " +
            "different model in Settings - gemini-flash-lite-latest has a much larger " +
            "free allowance - or enable billing on your Gemini key."
          );
          transient.retryable = false; // queueing this would retry for hours
        } else {
          transient = new Error(
            "Gemini's per-minute rate limit was reached for " + geminiModel +
            (quota && quota.value ? " (" + quota.value + " requests/minute)" : "") + ". " +
            waitAdvice + " This one will be retried automatically."
          );
          transient.retryable = true;
        }
      } else {
        transient = new Error(
          "Gemini is busy right now (HTTP " + geminiCode + "). " + waitAdvice +
          " If it persists, try a lighter model such as gemini-flash-lite-latest."
        );
        transient.retryable = true;
      }

      transient.retryAfter = waitSeconds || 30;
      throw transient;
    }
    if (geminiCode !== 200) {
      throw new Error("Gemini API error " + geminiCode + ": " + geminiErrorMessage(geminiResponse));
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
    const relativesStr = extractedJson.relatives
      ? extractedJson.relatives.map(normalizeText).join("\n")
      : "";

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
      sanitize(normalizeText(extractedJson.citation || "")),
      scanCell,
      sourceCell,
      sanitize(normalizeText(extractedJson.transcription || "")),
      sanitize(normalizeText(data.notes || ""))
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
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.message || err.toString(),
      // Present only on failures the caller should queue and retry, so a
      // misconfiguration is never retried forever.
      retryable: Boolean(err.retryable),
      retryAfter: err.retryAfter || 0
    })).setMimeType(ContentService.MimeType.JSON);
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
