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

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    const rawData = e.postData.contents;
    const data = JSON.parse(rawData);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = (data.targetTab || "Genealogy Log").trim();
    let sheet = ss.getSheetByName(tabName);

    const headers = [
      "Logged Date",
      "Primary Person",
      "Event Type",
      "Event Date",
      "Event Place",
      "Family / Relatives",
      "Collection / Source",
      "Citation",
      "Document Scan (Drive)",
      "Source Link",
      "Transcription / Summary",
      "User Notes"
    ];

    // Create the tab and headers if it does not exist
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow(headers);

      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#1e293b");
      headerRange.setFontColor("#f8fafc");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
    }

    // 1. Save document clipping to Google Drive if image base64 is provided
    let scanUrl = "";
    if (data.imageJpegBase64) {
      try {
        const folderName = "Genealogy Document Clippings";
        const folders = DriveApp.getFoldersByName(folderName);
        let folder;
        if (folders.hasNext()) {
          folder = folders.next();
        } else {
          folder = DriveApp.createFolder(folderName);
        }

        const decoded = Utilities.base64Decode(data.imageJpegBase64);
        const dateTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
        const safeName = (data.primaryPerson || "Record").replace(/[^a-zA-Z0-9_\- ]/g, "_");
        const fileName = `${safeName}_${dateTag}.jpg`;
        const blob = Utilities.newBlob(decoded, "image/jpeg", fileName);
        const file = folder.createFile(blob);
        scanUrl = file.getUrl();
      } catch (driveErr) {
        Logger.log("Drive save error: " + driveErr.toString());
      }
    }

    // 2. Format relatives list
    let relativesStr = "";
    if (Array.isArray(data.relatives)) {
      relativesStr = data.relatives.join("\n");
    } else if (data.relatives && typeof data.relatives === "object") {
      relativesStr = Object.entries(data.relatives)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    } else if (data.relatives) {
      relativesStr = String(data.relatives);
    }

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const sourceUrl = data.recordUrl || data.url || "";

    const scanCell = scanUrl ? `=HYPERLINK("${scanUrl}", "View Scan")` : "No scan";
    const sourceCell = sourceUrl ? `=HYPERLINK("${sourceUrl}", "Open Record")` : "";

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

    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        tab: tabName,
        rowAdded: lastRow,
        scanUrl: scanUrl || null
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok", message: "Genealogy Logger Webhook is active and ready." })
  ).setMimeType(ContentService.MimeType.JSON);
}
