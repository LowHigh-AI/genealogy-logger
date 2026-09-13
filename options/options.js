// Genealogy Logger - Options Logic

document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("apiKey");
  const webhookUrlInput = document.getElementById("webhookUrl");
  const sheetUrlInput = document.getElementById("sheetUrl");
  const driveFolderUrlInput = document.getElementById("driveFolderUrl");
  const tabButtons = document.querySelectorAll(".tab");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const viewGuideLink = document.getElementById("viewGuideLink");
  const geminiModelSelect = document.getElementById("geminiModel");
  const refreshModelsBtn = document.getElementById("refreshModelsBtn");
  const modelStatus = document.getElementById("modelStatus");
  const toggleAllModels = document.getElementById("toggleAllModels");
  const fullTestBtn = document.getElementById("fullTestBtn");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const copyManifestBtn = document.getElementById("copyManifestBtn");
  const copyStatus = document.getElementById("copyStatus");
  const browseSheetsBtn = document.getElementById("browseSheetsBtn");
  const browseFoldersBtn = document.getElementById("browseFoldersBtn");
  const pickerOverlay = document.getElementById("pickerOverlay");
  const pickerTitle = document.getElementById("pickerTitle");
  const pickerCrumb = document.getElementById("pickerCrumb");
  const pickerSearch = document.getElementById("pickerSearch");
  const pickerList = document.getElementById("pickerList");
  const pickerStatus = document.getElementById("pickerStatus");
  const pickerSelect = document.getElementById("pickerSelect");
  const pickerCancel = document.getElementById("pickerCancel");
  const pickerClose = document.getElementById("pickerClose");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const toggleApiKeyBtn = document.getElementById("toggleApiKey");
  const saveFeedback = document.getElementById("saveFeedback");
  const overallStatus = document.getElementById("overallStatus");
  const statusText = document.getElementById("statusText");
  const familyLineForm = document.getElementById("familyLineForm");
  const familyLineInput = document.getElementById("familyLineInput");
  const familyLineList = document.getElementById("familyLineList");
  const familyLineFeedback = document.getElementById("familyLineFeedback");

  // Load existing settings
  let {
    apiKey = "",
    webhookUrl = "",
    sheetUrl = "",
    driveFolderUrl = "",
    geminiModel = "",
    geminiModelList = [],
    geminiModelListAll = [],
    geminiScriptDefault = "",
    familyLines = []
  } = await chrome.storage.sync.get([
    "apiKey",
    "webhookUrl",
    "sheetUrl",
    "driveFolderUrl",
    "geminiModel",
    "geminiModelList",
    "geminiModelListAll",
    "geminiScriptDefault",
    "familyLines"
  ]);

  apiKeyInput.value = apiKey;
  webhookUrlInput.value = webhookUrl;
  sheetUrlInput.value = sheetUrl;
  driveFolderUrlInput.value = driveFolderUrl;
  renderModelOptions(geminiModelList, geminiModel);
  renderModelStatus();

  updateStatusBadge(apiKey, webhookUrl);
  renderFamilyLines();

  // --- Family Lines ---

  // Sheet tab names can't contain these characters (or exceed 100 chars).
  const INVALID_TAB_CHARS = /[:\\/?*\[\]]/;

  function renderFamilyLines() {
    familyLineList.innerHTML = "";
    if (familyLines.length === 0) {
      const empty = document.createElement("p");
      empty.className = "family-line-empty";
      empty.textContent = "No family lines yet — add one above.";
      familyLineList.appendChild(empty);
      return;
    }
    familyLines.forEach((line) => {
      const chip = document.createElement("span");
      chip.className = "family-line-chip";
      const label = document.createElement("span");
      label.textContent = line;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chip-remove";
      removeBtn.title = `Remove "${line}"`;
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => removeFamilyLine(line));
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      familyLineList.appendChild(chip);
    });
  }

  async function saveFamilyLines() {
    await chrome.storage.sync.set({ familyLines });
    // If the active target was removed, fall back to the default tab next time the popup opens.
    const { activeFamilyLine } = await chrome.storage.sync.get(["activeFamilyLine"]);
    if (activeFamilyLine && !familyLines.includes(activeFamilyLine)) {
      await chrome.storage.sync.remove("activeFamilyLine");
    }
  }

  function showFamilyLineFeedback(msg, type) {
    familyLineFeedback.className = `feedback-msg ${type}`;
    familyLineFeedback.textContent = msg;
    familyLineFeedback.style.display = "block";
    setTimeout(() => {
      familyLineFeedback.style.display = "none";
    }, 4000);
  }

  familyLineForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = familyLineInput.value.trim();
    if (!name) return;
    if (INVALID_TAB_CHARS.test(name)) {
      showFamilyLineFeedback('Family line names can\'t contain : \\ / ? * [ ]', "error");
      return;
    }
    if (familyLines.some((l) => l.toLowerCase() === name.toLowerCase())) {
      showFamilyLineFeedback("That family line already exists.", "error");
      return;
    }
    familyLines.push(name);
    await saveFamilyLines();
    renderFamilyLines();
    familyLineInput.value = "";
  });

  async function removeFamilyLine(name) {
    familyLines = familyLines.filter((l) => l !== name);
    await saveFamilyLines();
    renderFamilyLines();
  }

  // Toggle API Key visibility
  toggleApiKeyBtn.addEventListener("click", () => {
    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleApiKeyBtn.textContent = "🙈";
    } else {
      apiKeyInput.type = "password";
      toggleApiKeyBtn.textContent = "👁️";
    }
  });

  // Pulls the file id out of a Google Sheets URL. Also accepts a bare id, so pasting
  // either the full URL or just the id both work. Returns null if neither.
  function parseSpreadsheetId(value) {
    const input = (value || "").trim();
    if (!input) return "";

    const urlMatch = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) return urlMatch[1];

    // A bare id pasted on its own.
    if (/^[a-zA-Z0-9-_]{20,}$/.test(input)) return input;

    return null;
  }

  // --- Tabs -----------------------------------------------------------------------

  function showTab(panelId) {
    tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.panel === panelId));
    tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
    try {
      localStorage.setItem("activeTab", panelId);
    } catch (e) {
      /* private mode - the tab just won't be remembered */
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.panel));
  });

  viewGuideLink.addEventListener("click", (e) => {
    e.preventDefault();
    showTab("panel-guide");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Deep links (#guide / #faq) still work, they just switch tabs instead of scrolling.
  const hashPanel = { "#guide": "panel-guide", "#faq": "panel-faq" }[window.location.hash];

  let rememberedTab = null;
  try {
    rememberedTab = localStorage.getItem("activeTab");
  } catch (e) {
    /* ignore */
  }

  // A brand-new install opens on the guide; anyone already set up lands on Settings.
  const isConfigured = Boolean(apiKey);
  showTab(hashPanel || rememberedTab || (isConfigured ? "panel-settings" : "panel-guide"));

  // --- Gemini model picker ---

  // Rebuilds the dropdown. Keeps a previously chosen model selectable even if it is no
  // longer in the list, so a stale selection stays visible rather than silently vanishing.
  function renderModelOptions(models, selected) {
    geminiModelSelect.innerHTML = "";

    const auto = document.createElement("option");
    auto.value = "";
    // Spell out what "Automatic" actually resolves to, so the dropdown is never ambiguous.
    auto.textContent = geminiScriptDefault
      ? `Automatic — currently ${geminiScriptDefault}`
      : "Automatic (script default)";
    geminiModelSelect.appendChild(auto);

    const names = (models || []).slice();
    if (selected && names.indexOf(selected) === -1) {
      names.unshift(selected);
    }

    // The script returns the list pre-ranked, so the first entry is the best default.
    names.forEach((name, i) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = i === 0 && !selected ? `${name} — recommended` : name;
      geminiModelSelect.appendChild(option);
    });

    geminiModelSelect.value = selected || "";
  }

  // One line that always answers "so which model is being used?"
  function renderModelStatus() {
    const chosen = geminiModelSelect.value;
    if (chosen) {
      modelStatus.innerHTML = `Using <span class="model-name">${chosen}</span> — your explicit choice.`;
    } else if (geminiScriptDefault) {
      modelStatus.innerHTML =
        `Using <span class="model-name">${geminiScriptDefault}</span> — chosen automatically by the script.`;
    } else {
      modelStatus.innerHTML = "Click <strong>Refresh list</strong> to see which models your Gemini key can use.";
    }
  }

  geminiModelSelect.addEventListener("change", renderModelStatus);

  let showingAllModels = false;
  toggleAllModels.addEventListener("click", () => {
    showingAllModels = !showingAllModels;
    const list = showingAllModels ? geminiModelListAll : geminiModelList;
    if (!list.length) {
      showFeedback("Click Refresh list first.", "error");
      showingAllModels = false;
      return;
    }
    toggleAllModels.textContent = showingAllModels ? "Show recommended only" : "Show all models";
    renderModelOptions(list, geminiModelSelect.value);
    renderModelStatus();
  });

  refreshModelsBtn.addEventListener("click", async () => {
    const { webhook, key } = webhookSettings();
    if (!webhook || !key) {
      showFeedback("Enter and save your Webhook URL and API Key first — the Gemini key lives in your Apps Script project, so the list comes from there.", "error");
      return;
    }

    refreshModelsBtn.disabled = true;
    refreshModelsBtn.textContent = "Loading...";

    try {
      const result = await callWebhook({ listModels: true });

      const models = result.models || [];
      if (models.length === 0) {
        showFeedback("No usable models returned. Check the GEMINI_API_KEY script property in your Apps Script project.", "error");
        return;
      }

      geminiModelList = models;
      geminiModelListAll = result.allModels || models;
      geminiScriptDefault = result.scriptDefault || "";
      showingAllModels = false;
      toggleAllModels.textContent = "Show all models";

      const keep = geminiModelListAll.indexOf(geminiModelSelect.value) !== -1 ? geminiModelSelect.value : "";
      renderModelOptions(models, keep);
      renderModelStatus();

      await chrome.storage.sync.set({
        geminiModelList: geminiModelList,
        geminiModelListAll: geminiModelListAll,
        geminiScriptDefault: geminiScriptDefault
      });

      const hidden = geminiModelListAll.length - models.length;
      showFeedback(
        `✓ ${models.length} suitable models found` +
        (hidden > 0 ? ` (${hidden} speech/image/research models hidden)` : "") + ".",
        "success"
      );
    } catch (err) {
      showFeedback(`✗ Could not load models: ${err.message}`, "error");
    } finally {
      refreshModelsBtn.disabled = false;
      refreshModelsBtn.textContent = "Refresh list";
    }
  });

  // --- Copy the Apps Script files -------------------------------------------------

  async function copyBundledFile(path, label) {
    try {
      const res = await fetch(chrome.runtime.getURL(path));
      if (!res.ok) throw new Error(`could not read ${path}`);
      await navigator.clipboard.writeText(await res.text());
      copyStatus.textContent = `✓ ${label} copied`;
    } catch (err) {
      copyStatus.textContent = `✗ ${err.message}`;
    }
    setTimeout(() => { copyStatus.textContent = ""; }, 4000);
  }

  copyCodeBtn.addEventListener("click", () => copyBundledFile("google-sheets-script/Code.gs", "Code.gs"));
  copyManifestBtn.addEventListener("click", () => copyBundledFile("google-sheets-script/appsscript.json", "appsscript.json"));

  // --- Full test --------------------------------------------------------------------
  // Test Connection deliberately skips Gemini, so a retired model or a bad key still
  // looks healthy. This exercises the model too, without writing a row.
  fullTestBtn.addEventListener("click", async () => {
    const { webhook, key } = webhookSettings();
    if (!webhook || !key) {
      showFeedback("Please enter both the Webhook URL and API Key.", "error");
      return;
    }

    fullTestBtn.disabled = true;
    fullTestBtn.textContent = "Testing...";
    showFeedback("Asking Gemini to read a sample record…", "info");

    try {
      const result = await callWebhook({
        dryRun: true,
        rawText: "Sample record for configuration testing. Name: Jane Doe. Born 1880 in Springfield, Illinois. Father: John Doe.",
        spreadsheetId: parseSpreadsheetId(sheetUrlInput.value) || "",
        geminiModel: geminiModelSelect.value || ""
      });
      const person = result.extractedData && result.extractedData.primaryPerson;
      showFeedback(
        `✓ ${result.message}${person ? ` It read the sample person as "${person}".` : ""}`,
        "success"
      );
    } catch (err) {
      showFeedback(`✗ Full test failed: ${err.message}`, "error");
    } finally {
      fullTestBtn.disabled = false;
      fullTestBtn.textContent = "Run Full Test";
    }
  });

  // --- Drive picker ---------------------------------------------------------------
  // Browsing runs through the webhook, not the Drive API: the Apps Script is already
  // authorized for Drive, so the extension needs no OAuth client or restricted scopes.
  // Bonus - anything shown here is provably visible to the account that does the writing.

  let pickerMode = "folder";      // "folder" | "sheet"
  let pickerFolderId = "";        // folder currently being browsed
  let pickerChoice = null;        // { id, name } highlighted by the user

  function webhookSettings() {
    return { webhook: webhookUrlInput.value.trim(), key: apiKeyInput.value.trim() };
  }

  async function callWebhook(body) {
    const { webhook, key } = webhookSettings();
    if (!webhook || !key) {
      throw new Error("Save your Webhook URL and API Key first — browsing runs through your Apps Script.");
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8", "x-api-key": key },
      body: JSON.stringify(Object.assign({ apiKey: key }, body))
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.status !== "success") throw new Error(result.message || "Webhook returned an error.");
    return result;
  }

  function openPicker(mode) {
    pickerMode = mode;
    pickerChoice = null;
    pickerFolderId = "";
    pickerTitle.textContent = mode === "folder" ? "Choose a folder" : "Choose a spreadsheet";
    pickerSelect.textContent = mode === "folder" ? "Select this folder" : "Select";
    pickerSearch.classList.toggle("hidden", mode !== "sheet");
    pickerSearch.value = "";
    pickerCrumb.classList.toggle("hidden", mode !== "folder");
    pickerOverlay.classList.remove("hidden");
    mode === "folder" ? loadFolders("") : loadSheets("");
  }

  function closePicker() {
    pickerOverlay.classList.add("hidden");
    pickerList.innerHTML = "";
    pickerStatus.textContent = "";
  }

  function setPickerBusy(msg) {
    pickerList.innerHTML = `<p class="picker-empty">${msg}</p>`;
  }

  function row({ icon, name, onOpen, onPick }) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "picker-row";

    const i = document.createElement("span");
    i.className = "row-icon";
    i.textContent = icon;
    const n = document.createElement("span");
    n.className = "row-name";
    n.textContent = name;
    el.appendChild(i);
    el.appendChild(n);

    if (onOpen) {
      const chevron = document.createElement("span");
      chevron.className = "row-open";
      chevron.textContent = "›";
      el.appendChild(chevron);
    }

    el.addEventListener("click", () => {
      if (onPick) {
        pickerList.querySelectorAll(".picker-row").forEach((r) => r.classList.remove("selected"));
        el.classList.add("selected");
        onPick();
      } else if (onOpen) {
        onOpen();
      }
    });
    el.addEventListener("dblclick", () => { if (onOpen) onOpen(); });
    return el;
  }

  async function loadFolders(parentId) {
    setPickerBusy("Loading…");
    try {
      const result = await callWebhook({ listFolders: true, parentId: parentId || "" });
      pickerFolderId = result.current.id;
      pickerChoice = { id: result.current.id, name: result.current.name };
      pickerCrumb.textContent = result.current.name;
      pickerStatus.textContent = `Will use: ${result.current.name}`;

      pickerList.innerHTML = "";
      if (result.parent) {
        pickerList.appendChild(row({
          icon: "↰", name: result.parent.name, onOpen: () => loadFolders(result.parent.id)
        }));
      }
      if (result.folders.length === 0 && !result.parent) {
        pickerList.appendChild(Object.assign(document.createElement("p"), {
          className: "picker-empty", textContent: "No subfolders here. Select this folder to use it."
        }));
      }
      result.folders.forEach((f) => {
        pickerList.appendChild(row({
          icon: "📁",
          name: f.name,
          onOpen: () => loadFolders(f.id)
        }));
      });
    } catch (err) {
      setPickerBusy(err.message);
      pickerStatus.textContent = "";
    }
  }

  async function loadSheets(query) {
    setPickerBusy("Loading…");
    try {
      const result = await callWebhook({ listSheets: true, query: query || "" });
      pickerList.innerHTML = "";
      pickerStatus.textContent = "";

      if (!result.sheets.length) {
        setPickerBusy(query ? "No spreadsheets match that name." : "No spreadsheets found.");
        return;
      }
      result.sheets.forEach((sheet) => {
        pickerList.appendChild(row({
          icon: "📊",
          name: sheet.name,
          onPick: () => {
            pickerChoice = { id: sheet.id, name: sheet.name };
            pickerStatus.textContent = `Will use: ${sheet.name}`;
          }
        }));
      });
    } catch (err) {
      setPickerBusy(err.message);
    }
  }

  let searchTimer = null;
  pickerSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadSheets(pickerSearch.value.trim()), 350);
  });

  pickerSelect.addEventListener("click", async () => {
    if (!pickerChoice) {
      pickerStatus.textContent = "Pick something from the list first.";
      return;
    }
    if (pickerMode === "folder") {
      driveFolderUrlInput.value = `https://drive.google.com/drive/folders/${pickerChoice.id}`;
      await chrome.storage.sync.set({
        driveFolderUrl: driveFolderUrlInput.value,
        driveFolderId: pickerChoice.id
      });
    } else {
      sheetUrlInput.value = `https://docs.google.com/spreadsheets/d/${pickerChoice.id}/edit`;
      await chrome.storage.sync.set({
        sheetUrl: sheetUrlInput.value,
        spreadsheetId: pickerChoice.id
      });
    }
    showFeedback(`✓ Selected "${pickerChoice.name}".`, "success");
    closePicker();
  });

  browseFoldersBtn.addEventListener("click", () => openPicker("folder"));
  browseSheetsBtn.addEventListener("click", () => openPicker("sheet"));
  pickerCancel.addEventListener("click", closePicker);
  pickerClose.addEventListener("click", closePicker);
  pickerOverlay.addEventListener("click", (e) => { if (e.target === pickerOverlay) closePicker(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pickerOverlay.classList.contains("hidden")) closePicker();
  });

  // Pulls the folder id out of a Google Drive folder URL. Also accepts a bare id.
  // Returns null if the input is neither.
  function parseDriveFolderId(value) {
    const input = (value || "").trim();
    if (!input) return "";

    const folderMatch = input.match(/\/folders\/([a-zA-Z0-9-_]+)/);
    if (folderMatch) return folderMatch[1];

    const idParam = input.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (idParam) return idParam[1];

    if (/^[a-zA-Z0-9-_]{20,}$/.test(input)) return input;

    return null;
  }

  // Save Settings
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = apiKeyInput.value.trim();
    const webhook = webhookUrlInput.value.trim();
    const sheet = sheetUrlInput.value.trim();

    const folder = driveFolderUrlInput.value.trim();

    const spreadsheetId = parseSpreadsheetId(sheet);
    if (spreadsheetId === null) {
      showFeedback("That doesn't look like a Google Sheet URL. Copy the address bar from your open sheet, or leave it blank.", "error");
      return;
    }

    const driveFolderId = parseDriveFolderId(folder);
    if (driveFolderId === null) {
      showFeedback("That doesn't look like a Google Drive folder URL. Open the folder in Drive and copy its address, or leave it blank.", "error");
      return;
    }

    await chrome.storage.sync.set({
      apiKey: key,
      webhookUrl: webhook,
      sheetUrl: sheet,
      spreadsheetId: spreadsheetId,
      driveFolderUrl: folder,
      driveFolderId: driveFolderId,
      geminiModel: geminiModelSelect.value || ""
    });

    updateStatusBadge(key, webhook);
    showFeedback(
      spreadsheetId
        ? "Settings saved — logging to sheet " + spreadsheetId
        : "Settings saved successfully!",
      "success"
    );
  });

  // Test Connection
  testBtn.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    const webhook = webhookUrlInput.value.trim();

    if (!webhook || !key) {
      showFeedback("Please enter both the Webhook URL and API Key.", "error");
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = "Testing...";
    showFeedback("Validating Connection...", "info");

    try {
      // Apps Script reports its own errors inside a 200 response body, so check the
      // payload rather than just the HTTP status.
      const webhookRes = await fetch(webhook, { 
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8", "x-api-key": key },
        body: JSON.stringify({
          test: true,
          apiKey: key,
          spreadsheetId: parseSpreadsheetId(sheetUrlInput.value) || "",
          driveFolderId: parseDriveFolderId(driveFolderUrlInput.value) || ""
        })
      });

      if (!webhookRes.ok) {
        showFeedback(`✗ Validation Failed: HTTP ${webhookRes.status}`, "error");
      } else {
        const result = await webhookRes.json();
        if (result.status === "success") {
          showFeedback(`✓ ${result.message || "Webhook connected successfully!"}`, "success");
        } else {
          showFeedback(`✗ ${result.message || "Webhook returned an error."}`, "error");
        }
      }
      updateStatusBadge(key, webhook);
    } catch (err) {
      showFeedback(`✗ Validation Failed: ${err.message}`, "error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test Connection";
    }
  });

  function updateStatusBadge(key, webhook) {
    const missing = [];
    if (!webhook) missing.push("webhook URL");
    if (!key) missing.push("API key");

    if (missing.length === 0) {
      overallStatus.classList.add("ready");
      // A blank sheet setting is valid (the script falls back to its bound sheet),
      // so this is a note rather than an error.
      statusText.textContent = sheetUrlInput.value.trim()
        ? "Ready to Log"
        : "Ready — using the script's own sheet";
    } else {
      overallStatus.classList.remove("ready");
      statusText.textContent = `Needs your ${missing.join(" and ")}`;
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
