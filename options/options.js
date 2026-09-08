// Genealogy Logger - Options Logic

document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("apiKey");
  const webhookUrlInput = document.getElementById("webhookUrl");
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
    webhookUrl = "https://script.google.com/macros/s/AKfycbw0Ga8e_Ey4cLcpLmLE0vWtl3PH8IEMqMmajTN94cs6CvSpSn68jjqNjevD1lQ6vyme/exec",
    familyLines = []
  } = await chrome.storage.sync.get([
    "apiKey",
    "webhookUrl",
    "familyLines"
  ]);

  apiKeyInput.value = apiKey;
  webhookUrlInput.value = webhookUrl;

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

  // Save Settings
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = apiKeyInput.value.trim();
    const webhook = webhookUrlInput.value.trim();

    await chrome.storage.sync.set({
      apiKey: key,
      webhookUrl: webhook
    });

    updateStatusBadge(key, webhook);
    showFeedback("Settings saved successfully!", "success");
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
      // Test Webhook via POST with empty data but valid key to see if we get a response (or error gracefully)
      const webhookRes = await fetch(webhook, { 
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8", "x-api-key": key },
        body: JSON.stringify({ test: true })
      });
      
      if (webhookRes.ok) {
        showFeedback("✓ Webhook connected successfully!", "success");
      } else {
        showFeedback(`✗ Validation Failed: HTTP ${webhookRes.status}`, "error");
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
