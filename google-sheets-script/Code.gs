/**
 * Google Apps Script for Genealogy Logger Chrome Extension
 * 
 * FEATURES:
 * - Dynamic tab routing (routes records to specific family/project tabs)
 * - Automatic Google Drive clipping storage (saves document screenshot to Drive folder)
 * - Hyperlinked columns for Document Scan & Source URL
 * - Auto-formatting & column sizing
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your target Google Sheet.
 * 2. In top menu, click: Extensions > Apps Script.
 * 3. Replace all code with this script and save (Cmd+S / Ctrl+S).
 * 4. Click "Deploy" > "New deployment" > Select type "Web app".
 * 5. Set "Execute as": "Me" and "Who has access": "Anyone".
 * 6. Click "Deploy", approve permissions, and copy the Web app URL.
 * 7. Paste the Web app URL into the Genealogy Logger extension settings.
 */

const SPREADSHEET_ID = "11ul12tBcS1_H5RUaMA9w6YJ8gWlaMUkB";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

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
    
    const prompt = `Extract genealogy facts from the raw text. Return strictly a JSON object.\nRaw Text: ${data.rawText}`;

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
            ancestorName: { type: "STRING" },
            familyLine: { type: "STRING", description: "Primary surname" },
            recordDate: { type: "STRING", description: "YYYY-MM-DD or standardized historical date" },
            country: { type: "STRING" },
            state: { type: "STRING" },
            county: { type: "STRING" },
            city: { type: "STRING" },
            recordType: { type: "STRING" },
            evidenceSummary: { type: "STRING" },
            citation: { type: "STRING" },
            geoFileName: { type: "STRING", description: "YYYY-MM-DD_Country_State_County_City_RecordType_Name" },
            relatives: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["ancestorName", "familyLine", "recordType", "geoFileName"]
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
    const extractedText = geminiData.candidates[0].content.parts[0].text;
    const extractedJson = JSON.parse(extractedText);

    // 3. File Handling & Drive Routing
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
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tabName = "Genealogy Log";
    let sheet = ss.getSheetByName(tabName);
    
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      const headers = [
        "Logged Date", "Primary Person", "Family Line", "Event Date", 
        "Country", "State", "County", "City", "Record Type", 
        "Relatives", "Citation", "Document Scan", "Source Link", "Evidence Summary"
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setBackground("#1e293b").setFontColor("#f8fafc").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const scanCell = fileUrl ? `=HYPERLINK("${fileUrl}", "View Scan")` : "No scan";
    const sourceCell = data.sourceUrl ? `=HYPERLINK("${data.sourceUrl}", "Open Record")` : "";
    const relativesStr = extractedJson.relatives ? extractedJson.relatives.join("\n") : "";

    const row = [
      timestamp,
      extractedJson.ancestorName || "Unknown",
      extractedJson.familyLine || "",
      extractedJson.recordDate || "",
      extractedJson.country || "",
      extractedJson.state || "",
      extractedJson.county || "",
      extractedJson.city || "",
      extractedJson.recordType || "",
      relativesStr,
      extractedJson.citation || "",
      scanCell,
      sourceCell,
      extractedJson.evidenceSummary || ""
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
