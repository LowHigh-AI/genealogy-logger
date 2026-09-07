// Genealogy Logger - Content Extractor & In-Page Feedback

(function () {
  if (window.__genealogyLoggerInjected) {
    return;
  }
  window.__genealogyLoggerInjected = true;

  /**
   * Displays an elegant on-page toast notification to give the user immediate feedback.
   */
  function showToast(message, type = "info", duration = 4000) {
    const existing = document.getElementById("genealogy-logger-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "genealogy-logger-toast";

    const bgColors = {
      info: "linear-gradient(135deg, #1e293b, #0f172a)",
      success: "linear-gradient(135deg, #065f46, #064e3b)",
      error: "linear-gradient(135deg, #991b1b, #7f1d1d)",
      working: "linear-gradient(135deg, #1e3a8a, #1e293b)"
    };

    const borderColors = {
      info: "#38bdf8",
      success: "#34d399",
      error: "#f87171",
      working: "#60a5fa"
    };

    const icons = {
      info: "📜",
      success: "✓",
      error: "⚠️",
      working: "⏳"
    };

    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "2147483647",
      background: bgColors[type] || bgColors.info,
      border: `1px solid ${borderColors[type] || borderColors.info}`,
      borderRadius: "12px",
      padding: "14px 20px",
      color: "#f8fafc",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      lineHeight: "1.4",
      boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.4)",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      maxWidth: "420px",
      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      transform: "translateY(20px) scale(0.96)",
      opacity: "0",
      pointerEvents: "none"
    });

    const iconSpan = document.createElement("span");
    iconSpan.textContent = icons[type] || "📜";
    iconSpan.style.fontSize = "18px";
    iconSpan.style.flexShrink = "0";

    const textSpan = document.createElement("span");
    textSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.transform = "translateY(0) scale(1)";
      toast.style.opacity = "1";
    });

    if (duration > 0) {
      setTimeout(() => {
        toast.style.transform = "translateY(12px) scale(0.96)";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  }

  /**
   * Scrapes structured details based on the current website.
   */
  function extractPageMetadata() {
    const url = window.location.href;
    const hostname = window.location.hostname.toLowerCase();
    const title = document.title || "";
    const selectedText = window.getSelection() ? window.getSelection().toString().trim() : "";

    const data = {
      url,
      title,
      hostname,
      selectedText,
      siteCategory: "generic",
      structuredDetails: {},
      citation: "",
      rawTextSnippets: []
    };

    // Extract JSON-LD microdata if present
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach((script) => {
      try {
        const parsed = JSON.parse(script.textContent);
        data.structuredDetails.jsonLd = parsed;
      } catch (e) {}
    });

    // -------------------------------------------------------------
    // 1. FamilySearch (familysearch.org)
    // -------------------------------------------------------------
    if (hostname.includes("familysearch.org")) {
      data.siteCategory = "familysearch";

      const citationEl = document.querySelector('[data-testid="citation-text"], .citation, [aria-label*="citation" i]');
      if (citationEl) data.citation = citationEl.innerText.trim();

      const detailRows = document.querySelectorAll('tr, .fs-table-row, [role="row"], dl > div, .field-row');
      const pairs = {};
      detailRows.forEach((row) => {
        const labelEl = row.querySelector('th, dt, .label, [class*="label"]');
        const valueEl = row.querySelector('td, dd, .value, [class*="value"]');
        if (labelEl && valueEl) {
          const label = labelEl.innerText.replace(/[:]/g, "").trim();
          const val = valueEl.innerText.trim();
          if (label && val && label.length < 50) pairs[label] = val;
        }
      });
      data.structuredDetails.recordFields = pairs;

      const personHeader = document.querySelector('h1, [data-testid="person-name"], .person-name');
      if (personHeader) data.structuredDetails.primaryHeading = personHeader.innerText.trim();
    }

    // -------------------------------------------------------------
    // 2. MyHeritage (myheritage.com)
    // -------------------------------------------------------------
    else if (hostname.includes("myheritage.com")) {
      data.siteCategory = "myheritage";

      const mhRows = document.querySelectorAll('.record-details-table tr, .record-fields tr, table.formTable tr');
      const pairs = {};
      mhRows.forEach((row) => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const label = cells[0].innerText.replace(/[:]/g, "").trim();
          const val = cells[1].innerText.trim();
          if (label && val) pairs[label] = val;
        }
      });
      data.structuredDetails.recordFields = pairs;

      const citationEl = document.querySelector('.citation, .source-citation, [id*="citation"]');
      if (citationEl) data.citation = citationEl.innerText.trim();
    }

    // -------------------------------------------------------------
    // 3. GenealogyBank (genealogybank.com)
    // -------------------------------------------------------------
    else if (hostname.includes("genealogybank.com")) {
      data.siteCategory = "genealogybank";

      const pairs = {};
      const paperNameEl = document.querySelector('.newspaper-title, .publication-title, [class*="doc-meta"]');
      if (paperNameEl) pairs.newspaper = paperNameEl.innerText.trim();

      const dateEl = document.querySelector('.doc-date, .date, time, [class*="publish-date"]');
      if (dateEl) pairs.date = dateEl.innerText.trim();

      const locEl = document.querySelector('.doc-location, .location, [class*="location"]');
      if (locEl) pairs.location = locEl.innerText.trim();

      const articleHeading = document.querySelector('h1, h2.article-title');
      if (articleHeading) pairs.articleHeading = articleHeading.innerText.trim();

      data.structuredDetails.newspaperMeta = pairs;

      const transcriptEl = document.querySelector('.transcript-content, .ocr-text, #article-transcript, .doc-snippet');
      if (transcriptEl) {
        data.structuredDetails.transcript = transcriptEl.innerText.slice(0, 3000).trim();
      }
    }

    // -------------------------------------------------------------
    // 4. Find A Grave (findagrave.com)
    // -------------------------------------------------------------
    else if (hostname.includes("findagrave.com")) {
      data.siteCategory = "findagrave";
      const details = {};

      // Name & Memorial ID
      const nameEl = document.querySelector('#bio-name, h1[itemprop="name"], h1');
      if (nameEl) details.name = nameEl.innerText.trim();

      const memorialIdEl = document.querySelector('[data-testid="memorial-id"], #memorial-id, .memorial-id');
      if (memorialIdEl) {
        details.memorialId = memorialIdEl.innerText.replace(/[^0-9]/g, "");
      } else {
        const idMatch = url.match(/memorial\/([0-9]+)/);
        if (idMatch) details.memorialId = idMatch[1];
      }

      // Birth & Death Dates / Places
      const birthDateEl = document.querySelector('#birthDate, [itemprop="birthDate"], [data-testid="birth-date"]');
      if (birthDateEl) details.birthDate = birthDateEl.innerText.trim();

      const deathDateEl = document.querySelector('#deathDate, [itemprop="deathDate"], [data-testid="death-date"]');
      if (deathDateEl) details.deathDate = deathDateEl.innerText.trim();

      const birthPlaceEl = document.querySelector('#birthLocation, [itemprop="birthPlace"]');
      if (birthPlaceEl) details.birthPlace = birthPlaceEl.innerText.trim();

      const deathPlaceEl = document.querySelector('#deathLocation, [itemprop="deathPlace"]');
      if (deathPlaceEl) details.deathPlace = deathPlaceEl.innerText.trim();

      // Cemetery
      const cemeteryEl = document.querySelector('#cemeteryName, [itemprop="containedInPlace"], .cemetery-name');
      if (cemeteryEl) details.cemetery = cemeteryEl.innerText.trim();

      // Family Links (Spouse, Parents, Children)
      const familyLinks = Array.from(document.querySelectorAll('#family-members a, .family-member a, [data-testid="family-member"] a'))
        .map(a => a.innerText.trim())
        .filter(t => t && t.length > 2);
      if (familyLinks.length) details.familyMembers = familyLinks.slice(0, 15);

      // Bio / Inscription excerpt
      const bioEl = document.querySelector('#bio-text, [itemprop="description"], .memorial-bio');
      if (bioEl) details.bioExcerpt = bioEl.innerText.slice(0, 1200).trim();

      data.structuredDetails.findAGrave = details;
      if (details.memorialId) {
        data.citation = `Find a Grave, database and images (https://www.findagrave.com/memorial/${details.memorialId}), memorial page for ${details.name || "Subject"}.`;
      }
    }

    // -------------------------------------------------------------
    // 5. Library of Congress / Chronicling America (loc.gov / chroniclingamerica)
    // -------------------------------------------------------------
    else if (hostname.includes("chroniclingamerica.loc.gov") || (hostname.includes("loc.gov") && url.includes("newspapers"))) {
      data.siteCategory = "chronicling_america";
      const meta = {};

      const titleEl = document.querySelector('.page_header h1, #newspaper-title, .item-title, h1');
      if (titleEl) meta.newspaperTitle = titleEl.innerText.trim();

      const dateEl = document.querySelector('#page-date, .header-date, .date-picker, time');
      if (dateEl) meta.issueDate = dateEl.innerText.trim();

      const locEl = document.querySelector('.newspaper-place, .header-location');
      if (locEl) meta.location = locEl.innerText.trim();

      const pageEl = document.querySelector('#page-number, .pagination-text');
      if (pageEl) meta.pageNumber = pageEl.innerText.trim();

      // OCR text if open
      const ocrEl = document.querySelector('.ocr-text, #ocr-tab, .transcription, #transcription-view');
      if (ocrEl) meta.ocrTextSnippet = ocrEl.innerText.slice(0, 3000).trim();

      data.structuredDetails.chroniclingAmerica = meta;
      data.citation = `Chronicling America: Historic American Newspapers. Lib. of Congress. <${url}>`;
    }

    // -------------------------------------------------------------
    // 6. National Archives Catalog (catalog.archives.gov)
    // -------------------------------------------------------------
    else if (hostname.includes("archives.gov")) {
      data.siteCategory = "nara";
      const nara = {};

      const titleEl = document.querySelector('h1.record-title, [data-testid="record-title"], h1');
      if (titleEl) nara.recordTitle = titleEl.innerText.trim();

      // Look for National Archives Identifier (NAID)
      const naidEl = document.querySelector('[data-testid="naId"], .na-id, .national-archives-identifier');
      if (naidEl) {
        nara.naid = naidEl.innerText.trim();
      } else {
        const naidMatch = url.match(/id\/([0-9]+)/);
        if (naidMatch) nara.naid = naidMatch[1];
      }

      // Record Group / Series
      const rgEl = document.querySelector('.record-group, [data-testid="record-group"], .series-title');
      if (rgEl) nara.recordGroupOrSeries = rgEl.innerText.trim();

      const dateSpanEl = document.querySelector('.date-span, [data-testid="creation-date"]');
      if (dateSpanEl) nara.dateSpan = dateSpanEl.innerText.trim();

      const scopeEl = document.querySelector('.scope-content, [data-testid="scope-content"]');
      if (scopeEl) nara.scopeExcerpt = scopeEl.innerText.slice(0, 1500).trim();

      data.structuredDetails.nara = nara;
      if (nara.naid) {
        data.citation = `National Archives and Records Administration, National Archives Identifier (NAID) ${nara.naid}, ${nara.recordTitle || ""}.`;
      }
    }

    // -------------------------------------------------------------
    // 7. BLM GLO Records (glorecords.blm.gov)
    // -------------------------------------------------------------
    else if (hostname.includes("glorecords.blm.gov")) {
      data.siteCategory = "blm_glo";
      const glo = {};

      const rows = document.querySelectorAll('table tr, .data-row');
      rows.forEach(r => {
        const cells = r.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const k = cells[0].innerText.replace(/[:]/g, "").trim();
          const v = cells[1].innerText.trim();
          if (k && v) glo[k] = v;
        }
      });

      data.structuredDetails.blmLandPatent = glo;
      data.citation = `Bureau of Land Management, General Land Office Records (https://glorecords.blm.gov), Patent Record <${url}>`;
    }

    // -------------------------------------------------------------
    // 8. Internet Archive (archive.org)
    // -------------------------------------------------------------
    else if (hostname.includes("archive.org")) {
      data.siteCategory = "internet_archive";
      const ia = {};

      const itemTitleEl = document.querySelector('h1.item-title, h1');
      if (itemTitleEl) ia.title = itemTitleEl.innerText.trim();

      const authorEl = document.querySelector('[itemprop="author"], .metadata-definition a[href*="creator"]');
      if (authorEl) ia.author = authorEl.innerText.trim();

      const dateEl = document.querySelector('[itemprop="datePublished"], .metadata-definition span[itemprop="date"]');
      if (dateEl) ia.publishedDate = dateEl.innerText.trim();

      const pageEl = document.querySelector('.page-number, .current-page');
      if (pageEl) ia.page = pageEl.innerText.trim();

      data.structuredDetails.internetArchive = ia;
      data.citation = `Internet Archive, digitized work: "${ia.title || "Item"}" (${ia.publishedDate || "n.d."}), <${url}>`;
    }

    // -------------------------------------------------------------
    // 9. WikiTree (wikitree.com)
    // -------------------------------------------------------------
    else if (hostname.includes("wikitree.com")) {
      data.siteCategory = "wikitree";
      const wt = {};

      const nameEl = document.querySelector('h1.page-title, h1');
      if (nameEl) wt.fullName = nameEl.innerText.trim();

      const vitalInfoEl = document.querySelector('.VITALS, .vitals-summary, [itemprop="birthDate"]');
      if (vitalInfoEl) wt.vitals = vitalInfoEl.innerText.slice(0, 1000).trim();

      const bioEl = document.querySelector('.bodytext, #body-text, .biography');
      if (bioEl) wt.bioSnippet = bioEl.innerText.slice(0, 2000).trim();

      data.structuredDetails.wikitree = wt;
      data.citation = `WikiTree: Where genealogists collaborate. Profile: <${url}>`;
    }

    // -------------------------------------------------------------
    // 10. BillionGraves (billiongraves.com)
    // -------------------------------------------------------------
    else if (hostname.includes("billiongraves.com")) {
      data.siteCategory = "billiongraves";
      const bg = {};

      const nameEl = document.querySelector('h1.record-title, h1');
      if (nameEl) bg.name = nameEl.innerText.trim();

      const cemeteryEl = document.querySelector('.cemetery-link, .cemetery-name');
      if (cemeteryEl) bg.cemetery = cemeteryEl.innerText.trim();

      const transcriptionEl = document.querySelector('.transcription-info, .record-details');
      if (transcriptionEl) bg.transcription = transcriptionEl.innerText.slice(0, 1000).trim();

      data.structuredDetails.billiongraves = bg;
      data.citation = `BillionGraves.com record for ${bg.name || "Subject"}, <${url}>`;
    }

    // -------------------------------------------------------------
    // 11. Generic Fallback (Ancestry, Newspapers.com, State Archives)
    // -------------------------------------------------------------
    else {
      const metaDesc = document.querySelector('meta[name="description"]')?.content;
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
      if (metaDesc || ogTitle || ogDesc) {
        data.structuredDetails.meta = { metaDesc, ogTitle, ogDesc };
      }

      const h1s = Array.from(document.querySelectorAll('h1')).map((h) => h.innerText.trim()).filter(Boolean);
      if (h1s.length) data.structuredDetails.headings = h1s;
    }

    return data;
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractData") {
      const data = extractPageMetadata();
      sendResponse({ status: "ok", data });
      return false;
    }

    if (request.action === "showToast") {
      showToast(request.message, request.toastType || "info", request.duration || 4000);
      sendResponse({ status: "displayed" });
      return false;
    }
  });

  // Attach extractor to window for executeScript direct evaluation if needed
  window.__genealogyLoggerExtract = extractPageMetadata;
  window.__genealogyLoggerShowToast = showToast;
})();
