const categoryColors = {
  Coding:        "blue",
  Shopping:      "pink",
  Entertainment: "red",
  Study:         "green",
  Games:         "purple",
  Financial:     "yellow",
  Other:         "grey"
};

const chromeColorToHex = {
  blue:   "#4f9eff",
  pink:   "#ff6eb4",
  red:    "#ff5b5b",
  green:  "#3dd68c",
  purple: "#7c6fff",
  yellow: "#f5c542",
  grey:   "#8a8d96",
  cyan:   "#22d3ee",
  orange: "#fb923c",
};

// Helper: Extract Domain 
function extractDomain(url) {
  try { return new URL(url).hostname; }
  catch { return ""; }
}

// elper: Time Ago
function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

//Status Bar
function setStatus(state, message) {
  const dot  = document.querySelector(".status-dot");
  const text = document.getElementById("statusText");
  const cssClass = {
    idle:"idle", analysing:"working", working:"working",
    done:"success", success:"success", error:"error"
  }[state] || "idle";
  if (dot)  dot.className   = "status-dot " + cssClass;
  if (text) text.textContent = message;
}

//Update Counts
function updateCounts(tabCount, groupCount) {
  const t = document.getElementById("totalCount");
  const g = document.getElementById("groupCount");
  if (t) t.textContent = `${tabCount} tabs`;
  if (g) g.textContent = groupCount;
}


//  SYNC FROM BROWSER  — run on every popup open

async function syncGroupsFromBrowser() {
  const [allTabs, chromeGroups] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT })
  ]);

  const groupMap = {};
  for (const g of chromeGroups) groupMap[g.id] = { info: g, tabs: [] };
  for (const tab of allTabs) {
    if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
        && groupMap[tab.groupId]) {
      groupMap[tab.groupId].tabs.push(tab);
    }
  }

  const entries = Object.values(groupMap).filter(g => g.tabs.length > 0);
  updateCounts(allTabs.length, entries.length);

  if (entries.length === 0) {
    renderGroups({});
    setStatus("idle", "Ready to analyse your tabs");
    return;
  }

  renderGroupsFromChrome(entries);
  setStatus("success", `${entries.length} group${entries.length > 1 ? "s" : ""} active`);
}

function renderGroupsFromChrome(entries) {
  const list       = document.getElementById("groupsList");
  const emptyState = document.getElementById("emptyState");
  if (!list) return;

  list.querySelectorAll(".group-card").forEach(c => c.remove());

  if (entries.length === 0) {
    if (emptyState) emptyState.style.display = "flex";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  for (const { info, tabs } of entries) {
    const dotColor    = chromeColorToHex[info.color] || "#8a8d96";
    const label       = info.title || "Ungrouped";
    const visibleTabs = tabs.slice(0, 3);
    const extraCount  = tabs.length - visibleTabs.length;

    const card = document.createElement("div");
    card.className = "group-card";
    card.innerHTML = `
      <div class="group-card-header">
        <div class="group-identity">
          <span class="group-color-dot" style="background-color:${dotColor}"></span>
          <span class="group-name">${label}</span>
          <span class="group-tab-count">${tabs.length} tab${tabs.length > 1 ? "s" : ""}</span>
        </div>
        <div class="group-actions">
          <button class="mini-btn danger ungroup-btn" title="Ungroup">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="tab-list">
        ${visibleTabs.map(t => `
          <div class="tab-item">
            <img class="tab-favicon"
              src="https://www.google.com/s2/favicons?domain=${extractDomain(t.url)}&sz=16" alt=""/>
            <span class="tab-title">${t.title || t.url}</span>
          </div>`).join("")}
        ${extraCount > 0
          ? `<div class="tab-item muted"><span class="tab-more">+${extraCount} more</span></div>`
          : ""}
      </div>`;

    card.querySelector(".ungroup-btn").addEventListener("click", async () => {
      await chrome.tabs.ungroup(tabs.map(t => t.id));
      card.remove();
      const remaining = document.querySelectorAll(".group-card").length;
      const latest    = await chrome.tabs.query({ currentWindow: true });
      updateCounts(latest.length, remaining);
      if (remaining === 0) {
        document.getElementById("emptyState").style.display = "flex";
        setStatus("idle", "Ready to analyse your tabs");
      }
    });

    list.appendChild(card);
  }
}

function renderGroups(groups) {
  const list       = document.getElementById("groupsList");
  const emptyState = document.getElementById("emptyState");
  if (!list) return;

  list.querySelectorAll(".group-card").forEach(c => c.remove());

  if (Object.keys(groups).length === 0) {
    if (emptyState) emptyState.style.display = "flex";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  for (const [category, tabs] of Object.entries(groups)) {
    const dotColor    = chromeColorToHex[categoryColors[category]] || "#8a8d96";
    const visibleTabs = tabs.slice(0, 3);
    const extraCount  = tabs.length - visibleTabs.length;

    const card = document.createElement("div");
    card.className = "group-card";
    card.innerHTML = `
      <div class="group-card-header">
        <div class="group-identity">
          <span class="group-color-dot" style="background-color:${dotColor}"></span>
          <span class="group-name">${category}</span>
          <span class="group-tab-count">${tabs.length} tab${tabs.length > 1 ? "s" : ""}</span>
        </div>
        <div class="group-actions">
          <button class="mini-btn danger ungroup-btn" title="Ungroup">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="tab-list">
        ${visibleTabs.map(t => `
          <div class="tab-item">
            <img class="tab-favicon"
              src="https://www.google.com/s2/favicons?domain=${extractDomain(t.url)}&sz=16" alt=""/>
            <span class="tab-title">${t.title || t.url}</span>
          </div>`).join("")}
        ${extraCount > 0
          ? `<div class="tab-item muted"><span class="tab-more">+${extraCount} more</span></div>`
          : ""}
      </div>`;

    card.querySelector(".ungroup-btn").addEventListener("click", async () => {
      await chrome.tabs.ungroup(tabs.map(t => t.id));
      card.remove();
      const remaining = document.querySelectorAll(".group-card").length;
      const latest    = await chrome.tabs.query({ currentWindow: true });
      updateCounts(latest.length, remaining);
      if (remaining === 0) {
        document.getElementById("emptyState").style.display = "flex";
        setStatus("idle", "Ready to analyse your tabs");
      }
    });

    list.appendChild(card);
  }
}

async function groupTabs() {
  try {
    setStatus("working", "Analysing your tabs...");

    const tabs   = await chrome.tabs.query({ currentWindow: true });
    const groups = {};

    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith("chrome://")) continue;
      let category = "Other";
      if (typeof classifyTab === "function") {
        try {
          category = await classifyTab(tab);
        } catch (e) {
          console.error("[Tabify] Classification error:", e);
          category = "Other";
        }
      }
      if (!groups[category]) groups[category] = [];
      groups[category].push(tab);
    }

    const existing = await chrome.tabGroups.query({
      windowId: chrome.windows.WINDOW_ID_CURRENT
    });
    for (const g of existing) {
      const gt = await chrome.tabs.query({ groupId: g.id });
      if (gt.length) await chrome.tabs.ungroup(gt.map(t => t.id));
    }

    for (const [category, tabsInGroup] of Object.entries(groups)) {
      const groupId = await chrome.tabs.group({ tabIds: tabsInGroup.map(t => t.id) });
      await chrome.tabGroups.update(groupId, {
        title:     category,
        color:     categoryColors[category] || "grey",
        collapsed: false
      });
    }

    const groupCount = Object.keys(groups).length;
    setStatus("success", `Grouped into ${groupCount} categor${groupCount === 1 ? "y" : "ies"}`);
    renderGroups(groups);
    updateCounts(tabs.length, groupCount);

  } catch (err) {
    console.error("Grouping failed:", err);
    setStatus("error", "Error grouping tabs");
  }
}

//Cleanup Logic
async function loadCleanupSuggestions() {
  const { inactiveThreshold } = await chrome.storage.sync.get({ inactiveThreshold: 20 });
  const thresholdMs = inactiveThreshold * 60 * 1000;
  const now = Date.now();

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const list = document.getElementById("cleanupList");
  if (!list) return;
  list.innerHTML = "";

  const idleTabs = tabs.filter(t => {
    if (t.active || t.url.startsWith("chrome://")) return false;
    const lastAccessed = t.lastAccessed || now;
    return (now - lastAccessed) > thresholdMs;
  });

  if (idleTabs.length === 0) {
    list.innerHTML = `<p style="text-align:center;opacity:0.5;padding:12px">No inactive tabs found (Threshold: ${inactiveThreshold}m)</p>`;
    return;
  }

  for (const tab of idleTabs) {
    const item = document.createElement("div");
    item.className = "cleanup-item";
    const inactiveTime = Math.floor((now - (tab.lastAccessed || now)) / 60000);
    
    item.innerHTML = `
      <div class="cleanup-item-info">
        <img class="tab-favicon"
          src="https://www.google.com/s2/favicons?domain=${extractDomain(tab.url)}&sz=16" alt=""/>
        <div style="min-width: 0;">
          <p class="cleanup-title">${tab.title || tab.url}</p>
          <p class="cleanup-age">Inactive for ${inactiveTime}m</p>
        </div>
      </div>
      <div class="cleanup-item-actions">
        <button class="chip-btn keep">Keep</button>
        <button class="chip-btn close" data-tab-id="${tab.id}">Close</button>
      </div>`;
    
    item.querySelector(".chip-btn.close").addEventListener("click", async () => {
      await chrome.tabs.remove(tab.id);
      item.remove();
      if (list.children.length === 0) {
        list.innerHTML = `<p style="text-align:center;opacity:0.5;padding:12px">All cleared!</p>`;
      }
    });
    item.querySelector(".chip-btn.keep").addEventListener("click", () => {
      item.remove();
      if (list.children.length === 0) {
        list.innerHTML = `<p style="text-align:center;opacity:0.5;padding:12px">All cleared!</p>`;
      }
    });
    list.appendChild(item);
  }
}

// Workspace Logic
async function loadSessions() {
  const { tabifySessions } = await chrome.storage.local.get({ tabifySessions: [] });
  const list = document.getElementById("sessionsList");
  const noSessions = document.getElementById("noSessions");
  if (!list) return;

  list.querySelectorAll(".session-row").forEach(r => r.remove());

  if (tabifySessions.length === 0) {
    if (noSessions) noSessions.style.display = "block";
    return;
  }
  if (noSessions) noSessions.style.display = "none";

  for (let i = 0; i < tabifySessions.length; i++) {
    const session = tabifySessions[i];
    const row = document.createElement("div");
    row.className = "session-row";
    row.innerHTML = `
      <div class="session-info">
        <span class="session-name">${session.name}</span>
        <span class="session-meta">${session.tabs.length} tabs · ${timeAgo(session.savedAt)}</span>
      </div>
      <div class="session-actions">
        <button class="restore-btn" data-index="${i}">Restore</button>
        <button class="delete-session-btn" data-index="${i}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>`;
    
    row.querySelector(".restore-btn").addEventListener("click", async () => {
      const urls = session.tabs.map(t => t.url);
      if (urls.length > 0) {
        await chrome.windows.create({ url: urls });
      }
    });

    row.querySelector(".delete-session-btn").addEventListener("click", async () => {
      const { tabifySessions: current } = await chrome.storage.local.get({ tabifySessions: [] });
      current.splice(i, 1);
      await chrome.storage.local.set({ tabifySessions: current });
      loadSessions();
    });

    list.appendChild(row);
  }
}

async function loadTabSelection() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const list = document.getElementById("tabSelectionList");
  if (!list) return;
  list.innerHTML = "";

  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className = "tab-selection-item";
    item.innerHTML = `
      <input type="checkbox" data-tab-id="${tab.id}" data-url="${tab.url}" data-title="${tab.title}" checked>
      <img class="tab-favicon" src="https://www.google.com/s2/favicons?domain=${extractDomain(tab.url)}&sz=16" alt=""/>
      <span class="cleanup-title">${tab.title || tab.url}</span>
    `;
    item.addEventListener("click", (e) => {
      if (e.target.tagName !== "INPUT") {
        const cb = item.querySelector("input");
        cb.checked = !cb.checked;
      }
    });
    list.appendChild(item);
  }
}

async function loadModel() {
  try {
    const cached = await chrome.storage.local.get("modelData");
    if (cached.modelData) return;
    const modelData = await fetch(chrome.runtime.getURL("model/model.json")).then(r => r.json());
    await chrome.storage.local.set({ modelData });
  } catch (e) {
    console.warn("[Tabify] Model fallback.");
  }
}

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
  await loadModel();
  await syncGroupsFromBrowser();
  await loadSessions();

  // Inactive Slider Logic
  const inactiveSlider = document.getElementById("inactiveSlider");
  const inactiveValue = document.getElementById("inactiveValue");
  
  const { inactiveThreshold } = await chrome.storage.sync.get({ inactiveThreshold: 20 });
  if (inactiveSlider && inactiveValue) {
    inactiveSlider.value = inactiveThreshold;
    inactiveValue.textContent = `${inactiveThreshold}m`;
    
    inactiveSlider.addEventListener("input", (e) => {
      inactiveValue.textContent = `${e.target.value}m`;
    });
    
    inactiveSlider.addEventListener("change", async (e) => {
      await chrome.storage.sync.set({ inactiveThreshold: parseInt(e.target.value) });
    });
  }

  // Dynamic toggle
  const dynamicToggle = document.getElementById("dynamicToggle");
  const toggleStatus  = document.getElementById("toggleStatus");
  const toggleRow     = document.getElementById("toggleRow");

  const { dynamicGrouping } = await chrome.storage.sync.get({ dynamicGrouping: false });
  if (dynamicToggle) {
    dynamicToggle.checked = !!dynamicGrouping;
    if (dynamicToggle.checked && toggleStatus) {
      toggleStatus.textContent = "Live Active";
      toggleRow?.classList.add("active-state");
    }
    dynamicToggle.addEventListener("change", async () => {
      const on = dynamicToggle.checked;
      await chrome.storage.sync.set({ dynamicGrouping: on });
      if (toggleStatus) toggleStatus.textContent = on ? "Live Active" : "Manual mode";
      on ? toggleRow?.classList.add("active-state") : toggleRow?.classList.remove("active-state");
    });
  }

  // Auto-group button
  const autoGroupBtn = document.getElementById("autoGroupBtn");
  if (autoGroupBtn) {
    autoGroupBtn.addEventListener("click", async () => {
      autoGroupBtn.disabled = true;
      const btnLabel = document.getElementById("btnLabel");
      const progressFill = document.getElementById("progressFill");
      const progressContainer = document.getElementById("progressContainer");
      
      if (btnLabel) btnLabel.textContent = "Organizing...";
      if (progressContainer) progressContainer.style.display = "block";
      
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        if (progress > 90) progress = 90;
        if (progressFill) progressFill.style.width = `${progress}%`;
      }, 100);

      await groupTabs();

      clearInterval(interval);
      if (progressFill) progressFill.style.width = "100%";
      setTimeout(() => {
        if (btnLabel) btnLabel.textContent = "Auto Group";
        if (progressContainer) progressContainer.style.display = "none";
        if (progressFill) progressFill.style.width = "0%";
        autoGroupBtn.disabled = false;
      }, 500);
    });
  }

  // Cleanup panel
  document.getElementById("cleanupBtn")?.addEventListener("click", () => {
    loadCleanupSuggestions();
    document.getElementById("cleanupPanel").style.display = "flex";
  });
  document.getElementById("closeCleanupPanel")?.addEventListener("click", () => {
    document.getElementById("cleanupPanel").style.display = "none";
  });
  document.getElementById("closeAllSuggested")?.addEventListener("click", async () => {
    const btns = document.querySelectorAll(".chip-btn.close[data-tab-id]");
    for (const btn of btns) {
      await chrome.tabs.remove(parseInt(btn.dataset.tabId));
    }
    document.getElementById("cleanupPanel").style.display = "none";
    await syncGroupsFromBrowser();
  });

  // Save Workspace panel
  document.getElementById("saveSessionBtn")?.addEventListener("click", () => {
    loadTabSelection();
    document.getElementById("savePanel").style.display = "flex";
  });
  document.getElementById("closeSavePanel")?.addEventListener("click", () => {
    document.getElementById("savePanel").style.display = "none";
  });
  document.getElementById("confirmSave")?.addEventListener("click", async () => {
    const nameInput = document.getElementById("sessionNameInput");
    const name = nameInput?.value.trim() || "Unnamed Workspace";
    
    const selectedCheckboxes = document.querySelectorAll("#tabSelectionList input[type='checkbox']:checked");
    const selectedTabs = Array.from(selectedCheckboxes).map(cb => ({
      url: cb.dataset.url,
      title: cb.dataset.title
    }));

    if (selectedTabs.length === 0) {
      alert("Please select at least one tab to save.");
      return;
    }

    const session = {
      name,
      tabs: selectedTabs,
      savedAt: Date.now()
    };

    const { tabifySessions } = await chrome.storage.local.get({ tabifySessions: [] });
    tabifySessions.unshift(session);
    await chrome.storage.local.set({ tabifySessions });
    
    document.getElementById("savePanel").style.display = "none";
    if (nameInput) nameInput.value = "";
    await loadSessions();
  });
});
