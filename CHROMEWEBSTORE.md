# Chrome Web Store Listing — Genealogy Logger

> Last Updated: 2026-09-07

---

## Store Listing Metadata

**Extension Name**  
`Genealogy Logger`

**Short Description (132 chars max)**  
`Extract and log genealogical records, documents, and citations to your own Google Sheet using Gemini AI.`

**Category**  
`Productivity` or `Search Tools`

**Single Purpose**  
`Extracts genealogical record data from viewed archival web pages and logs it to a personal Google Sheet.`

**Detailed Description (Plain Text format for Chrome Developer Dashboard)**:
```
Genealogy Logger is an archivist's companion that turns web-based family history research into a structured Google Sheet database in one click.

Whether you are viewing census records, gravestone memorials, military rosters, or historical newspapers, Genealogy Logger extracts the core biographical details, family relationships, and formal citations, and appends them to your personal Google Sheet.

KEY FEATURES:
• Notes: Add your own note to any record before logging it — it is saved alongside the record and given to the AI as context.
• One-Click Logging: Click the toolbar icon or press Command+Shift+L (Mac) / Ctrl+Shift+L (Windows) to preview and send, or right-click any page and choose "Log this page" to log it straight away.
• Specialized Archive Scrapers: Built-in DOM extractors for FamilySearch, MyHeritage, GenealogyBank, Find a Grave, Chronicling America (Library of Congress), National Archives (NARA), BLM Land Records, Internet Archive, WikiTree, and BillionGraves.
• Multi-Modal AI Precision: Combines on-page metadata with high-resolution visual document capture analyzed by Google Gemini to reduce handwriting transcription errors. You choose the model from a live list in Settings.
• Google Drive Document Archive: Saves document clippings to a Drive folder you choose (or an auto-created "Genealogy Document Clippings" folder), sorted into surname subfolders and linked from your spreadsheet.
• Family Line Routing: Add your ancestral surnames in Settings, then pick the active one from the popup — it stays selected until you change it, and each family line logs to its own tab in your Google Sheet.

HOW TO USE:
1. Open the extension Settings to link your free Gemini API key and Google Sheet Webhook URL.
2. Navigate to any genealogical record online.
3. Click the extension icon, press Cmd/Ctrl+Shift+L, or right-click the page.
4. Watch the confirmation badge turn green as your record is saved!

PRIVACY FIRST:
Genealogy Logger does not track your browsing history or sell any data. It operates entirely between your browser, your personal Google Gemini API key, and your own Google Sheet.
```

---

## Permissions Justification (For Chrome Review Team)

| Permission | Type | User-Facing Justification |
| :--- | :--- | :--- |
| `tabs` / `activeTab` | permissions | Required to capture a visual screenshot of the historical document and read the active tab's URL, only when the user explicitly triggers a log. |
| `scripting` | permissions | Required to inject the metadata extractor script on user gesture to extract structured genealogical table fields, names, and citation text. |
| `storage` | permissions | Required to safely store the user's personal Gemini API key, Google Sheets Webhook URL, and tab routing preferences locally. |
| `notifications` | permissions | Required to report success or failure when a record is logged from the right-click menu, where no popup is open to show the result. |
| `contextMenus` | permissions | Required to provide the "Log this page to Genealogy Logger" action when right-clicking a page, selection, image, or link. |
| `<all_urls>` | host_permissions | Genealogical records live on an open-ended set of archive sites, and many serve their high-resolution document scans from per-record or CDN hosts that cannot be enumerated in advance. The extension fetches that image **in the user's own authenticated session**, because subscription archives (Ancestry, MyHeritage, Findmypast) will not serve it to a server-side request. It also needs to reach the user's personal Apps Script endpoint at `script.google.com` / `script.googleusercontent.com`. No page is read or fetched without an explicit user gesture — clicking the toolbar icon, using the keyboard shortcut, or choosing the right-click menu item. |

---

## Privacy & Data Use Disclosure Form

- **Does the extension collect user data?** No central servers. Data is only processed between the user's browser, Google Gemini, and the user's own Google Sheet.
- **Data Categories checked in Dashboard:**
  - *Website Content*: Processed strictly upon user gesture (clicking log, using the shortcut, or the right-click menu) to extract genealogical data.
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
