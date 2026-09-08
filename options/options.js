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

  // Load existing settings
  let {
    apiKey = "",
    webhookUrl = "https://script.google.com/macros/s/AKfycbzv-2Nn4qvGO3kN52jbto6kL42XdG6qNmt-_aCK16y2hnNzHNUk-jEulcNjArNrxjYD/exec"
  } = await chrome.storage.sync.get([
    "apiKey",
    "webhookUrl"
  ]);

  apiKeyInput.value = apiKey;
  webhookUrlInput.value = webhookUrl;

  updateStatusBadge(apiKey, webhookUrl);

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
