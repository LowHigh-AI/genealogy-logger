// Genealogy Logger - Options Logic

document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("apiKey");
  const webhookUrlInput = document.getElementById("webhookUrl");
  const sheetUrlInput = document.getElementById("sheetUrl");
  const driveFolderUrlInput = document.getElementById("driveFolderUrl");
  const geminiModelSelect = document.getElementById("geminiModel");
  const refreshModelsBtn = document.getElementById("refreshModelsBtn");
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
    webhookUrl = "https://script.google.com/macros/s/AKfycbzXUrqWQuNPmhOaHKV2_Ab3MsigxesUCaM78I5ICXa9oT94-1EKM99Qq68ezyEnkbar/exec",
    sheetUrl = "",
    driveFolderUrl = "",
    geminiModel = "",
    geminiModelList = [],
    familyLines = []
  } = await chrome.storage.sync.get([
    "apiKey",
    "webhookUrl",
    "sheetUrl",
    "driveFolderUrl",
    "geminiModel",
    "geminiModelList",
    "familyLines"
  ]);

  apiKeyInput.value = apiKey;
  webhookUrlInput.value = webhookUrl;
  sheetUrlInput.value = sheetUrl;
  driveFolderUrlInput.value = driveFolderUrl;
  renderModelOptions(geminiModelList, geminiModel);

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

  // --- Gemini model picker ---

  // Rebuilds the dropdown. Keeps a previously chosen model selectable even if it is no
  // longer in the list, so a stale selection is visible rather than silently dropped.
  function renderModelOptions(models, selected) {
    geminiModelSelect.innerHTML = "";

    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Automatic (script default)";
    geminiModelSelect.appendChild(auto);

    const names = (models || []).slice().sort();
    if (selected && names.indexOf(selected) === -1) {
      names.unshift(selected);
    }

    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      geminiModelSelect.appendChild(option);
    });

    geminiModelSelect.value = selected || "";
  }

  refreshModelsBtn.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    const webhook = webhookUrlInput.value.trim();

    if (!webhook || !key) {
      showFeedback("Enter and save your Webhook URL and API Key first — the Gemini key lives in your Apps Script project, so the list comes from there.", "error");
      return;
    }

    refreshModelsBtn.disabled = true;
    refreshModelsBtn.textContent = "Loading...";

    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8", "x-api-key": key },
        body: JSON.stringify({ listModels: true, apiKey: key })
      });

      const result = await res.json();
      if (result.status !== "success") {
        throw new Error(result.message || "Webhook returned an error.");
      }

      const models = result.models || [];
      if (models.length === 0) {
        showFeedback("No models returned. Check the GEMINI_API_KEY script property in your Apps Script project.", "error");
        return;
      }

      const keep = models.indexOf(geminiModelSelect.value) !== -1 ? geminiModelSelect.value : "";
      renderModelOptions(models, keep);
      await chrome.storage.sync.set({ geminiModelList: models });
      showFeedback(`✓ Found ${models.length} models. The script currently defaults to ${result.scriptDefault || "its built-in model"}.`, "success");
    } catch (err) {
      showFeedback(`✗ Could not load models: ${err.message}`, "error");
    } finally {
      refreshModelsBtn.disabled = false;
      refreshModelsBtn.textContent = "Refresh list";
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
