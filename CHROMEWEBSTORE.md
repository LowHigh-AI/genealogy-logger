# Chrome Web Store Listing — Genealogy Logger

> Last Updated: 2026-09-07

---

## Store Listing Metadata

**Extension Name**  
`Genealogy Logger`

**Short Description (132 chars max)**  
`Instantly extract and log genealogical records, documents, and citations to Google Sheets using Gemini AI.`

**Category**  
`Productivity` or `Search Tools`

**Single Purpose**  
`Extracts genealogical record data from viewed archival web pages and logs it to a personal Google Sheet.`

**Detailed Description (Plain Text format for Chrome Developer Dashboard)**:
```
Genealogy Logger is an archivist's companion that turns web-based family history research into a structured Google Sheet database in one click.

Whether you are viewing census records, gravestone memorials, military rosters, or historical newspapers, Genealogy Logger extracts the core biographical details, family relationships, and formal citations, and appends them to your personal Google Sheet.

KEY FEATURES:
• Address Bar Quick-Log: Type "log" followed by Space or Tab in your Chrome address bar, add any notes, and press Enter.
• One-Click Logging: Click the toolbar icon or press Command+Shift+L (Mac) / Ctrl+Shift+L (Windows).
• Specialized Archive Scrapers: Built-in DOM extractors for FamilySearch, MyHeritage, GenealogyBank, Find a Grave, Chronicling America (Library of Congress), National Archives (NARA), BLM Land Records, Internet Archive, WikiTree, and BillionGraves.
• Multi-Modal AI Precision: Combines on-page metadata with high-resolution visual document capture analyzed by Google Gemini 2.5 Flash to eliminate handwriting transcription errors.
• Google Drive Document Archive: Automatically saves document clippings to a "Genealogy Document Clippings" Google Drive folder and links them in your spreadsheet.
• Family Line Routing: Direct records to custom tabs (e.g. typing "log [Smith Line] 1920 Census" routes to the "Smith Line" tab).
• Duplicate Protection: Alerts you if you already logged a record from that URL.

HOW TO USE:
1. Open the extension Settings to link your free Gemini API key and Google Sheet Webhook URL.
2. Navigate to any genealogical record online.
3. Click the extension icon, press Cmd/Ctrl+Shift+L, or type "log" in the Chrome address bar.
4. Watch the confirmation badge turn green as your record is saved!

PRIVACY FIRST:
Genealogy Logger does not track your browsing history or sell any data. It operates entirely between your browser, your personal Google Gemini API key, and your own Google Sheet.
```

---

## Permissions Justification (For Chrome Review Team)

| Permission | Type | User-Facing Justification |
| :--- | :--- | :--- |
| `activeTab` | permissions | Required to capture a visual screenshot of the historical document and access the active tab's URL only when explicitly triggered by the user. |
| `scripting` | permissions | Required to inject the metadata extractor script on user gesture to extract structured genealogical table fields, names, and citation text. |
| `storage` | permissions | Required to safely store the user's personal Gemini API key, Google Sheets Webhook URL, and tab routing preferences locally. |
| `notifications` | permissions | Required to display status confirmation or error feedback to the user when logging completes. |
| `contextMenus` | permissions | Required to provide a "Log Genealogy Record" action when right-clicking text, images, or pages. |
| `https://script.google.com/*` | host_permissions | Required to transmit the extracted record JSON payload to the user's personal Google Apps Script Webhook. |
| `https://script.googleusercontent.com/*` | host_permissions | Required to handle Google Apps Script redirect responses upon spreadsheet appending. |
| `https://generativelanguage.googleapis.com/*` | host_permissions | Required to communicate with the Google Gemini API to parse and structure the historical record. |

---

## Privacy & Data Use Disclosure Form

- **Does the extension collect user data?** No central servers. Data is only processed between the user's browser, Google Gemini, and the user's own Google Sheet.
- **Data Categories checked in Dashboard:**
  - *Website Content*: Processed strictly upon user gesture (clicking log or typing omnibox command) to extract genealogical data.
  - *Personally Identifiable Information*: Only historical genealogical names/dates extracted from public archives for insertion into the user's personal sheet.
- **Certifications**:
  - [x] Data is NOT sold to third parties.
  - [x] Data is NOT used for purposes unrelated to the extension's core functionality.
  - [x] Data is NOT used for creditworthiness or lending.

---

## Store Assets Checklist

| Asset | Size | Status | Notes |
| :--- | :--- | :--- | :--- |
| Store Icon | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Primary Screenshot | 1280×800 PNG | ⬜ To Capture | Screenshot of extension logging a FamilySearch or Find a Grave page |
| Secondary Screenshot | 1280×800 PNG | ⬜ To Capture | Screenshot of the Google Sheet with populated records & Drive links |
| Settings Screenshot | 1280×800 PNG | ⬜ To Capture | Screenshot of the extension Settings dashboard |

---

## Developer & Store Links

- **Repository**: `https://github.com/LowHigh-AI/genealogy-logger`
- **Homepage URL**: `https://github.com/LowHigh-AI/genealogy-logger`
- **Support / Issues URL**: `https://github.com/LowHigh-AI/genealogy-logger/issues`
- **Privacy Policy URL**: `https://github.com/LowHigh-AI/genealogy-logger/blob/main/PRIVACY_POLICY.md`
- **Publisher**: `LowHigh-AI`
