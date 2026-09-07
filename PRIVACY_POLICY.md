# Privacy Policy — Genealogy Logger

**Effective Date:** September 7, 2026

Genealogy Logger is committed to protecting your privacy. This Privacy Policy outlines how your data is handled when using the Genealogy Logger Chrome Extension.

### 1. Data Collection & Processing
Genealogy Logger operates entirely locally in your browser.
- **No Third-Party Analytics / Tracking:** We do not track, collect, or store your personal browsing history, IP address, or analytical data.
- **User-Initiated Processing:** When you explicitly click "Log", press the keyboard shortcut, or use the Omnibox command, the extension captures the URL, title, structured text, and visible viewport of the active tab.
- **Gemini AI:** Extracted text and document screenshots are sent directly to the official Google Gemini API (`generativelanguage.googleapis.com`) using your personal API key solely for transcription and structuring.
- **Google Sheets:** The structured data and document clippings are sent directly to your personal Google Apps Script Webhook URL (`script.google.com`) and stored in your personal Google Drive spreadsheet.

### 2. Data Storage
- Your **Gemini API Key**, **Webhook URL**, and **User Preferences** are stored locally on your device via Chrome's secure storage API (`chrome.storage.sync`) and synced via your Google account if Chrome Sync is enabled.
- We run no external servers, databases, or intermediary proxies.

### 3. Data Sharing
We do not sell, rent, trade, or share any user data with third parties.

### 4. Contact & Open Source
For questions, support, or privacy inquiries regarding Genealogy Logger, please open an issue at:
- **Repository**: [https://github.com/LowHigh-AI/genealogy-logger](https://github.com/LowHigh-AI/genealogy-logger)
- **Issues & Support**: [https://github.com/LowHigh-AI/genealogy-logger/issues](https://github.com/LowHigh-AI/genealogy-logger/issues)
