const categoryColors = {
  Coding: "blue",
  Shopping: "pink",
  Entertainment: "red",
  Study: "green",
  Games: "purple",
  Financial: "yellow",
  Other: "grey"
};

// ─── Helper: Extract Domain ───
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    return "";
  }
}

// ─── Helper: Time Ago ───
function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Status Bar ───
function setStatus(state, message) {
  const dot = document.querySelector(".status-dot");
  const text = document.getElementById("statusText");
  if (dot) dot.className = "status-dot " + state;
  if (text) text.textContent = message;
}

// ─── Update Counts ───
function updateCounts(tabCount, groupCount) {
  const totalLabel = document.getElementById("totalCount");
  const groupLabel = document.getElementById("groupCount");
  if (totalLabel) totalLabel.textContent = `${tabCount} tabs`;
  if (groupLabel) groupLabel.textContent = groupCount;
}

// ─── Group Tabs ───
async function groupTabs() {
  try {
    setStatus("analysing", "Analysing your tabs...");

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = {};
    for (const tab of tabs) {
  if (!tab.url || tab.url.startsWith("chrome://")) continue;

  const category = classifyTab(tab); 
  
  // ADD THIS LOG
  console.log(`URL: ${tab.url} | Result: ${category}`);

  if (!groups[category]) groups[category] = [];
  groups[category].push(tab);
}

    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith("chrome://")) continue;
      // Note: classifyTab must be globally available from classifier.js
      const category = typeof classifyTab === 'function' ? classifyTab(tab) : "Other";
      if (!groups[category]) groups[category] = [];
      groups[category].push(tab);
    }

    for (const [category, tabsInGroup] of Object.entries(groups)) {
      const tabIds = tabsInGroup.map(t => t.id);
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: category,
        color: categoryColors[category] || "grey",
        collapsed: false
      });
    }

    setStatus("done", `Grouped into ${Object.keys(groups).length} categories`);
    renderGroups(groups);
    updateCounts(tabs.length, Object.keys(groups).length);
  } catch (error) {
    console.error("Grouping failed:", error);
    setStatus("idle", "Error grouping tabs");
  }
}

// ─── Render Groups ───
function renderGroups(groups) {
  const list = document.getElementById("groupsList");
  const emptyState = document.getElementById("emptyState");

  if (!list) return;

  // Clear existing cards
  list.querySelectorAll(".group-card").forEach(c => c.remove());

  if (Object.keys(groups).length === 0) {
    if (emptyState) emptyState.style.display = "flex";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  for (const [category, tabs] of Object.entries(groups)) {
    const card = document.createElement("div");
    card.className = "group-card";
    card.dataset.color = categoryColors[category] || "grey";

    const visibleTabs = tabs.slice(0, 3);
    const extraCount = tabs.length - visibleTabs.length;

    card.innerHTML = `
      <div class="group-card-header">
        <div class="group-identity">
          <span class="group-color-dot" style="background-color: ${categoryColors[category] || 'grey'}"></span>
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
        ${visibleTabs.map(tab => `
          <div class="tab-item">
            <img class="tab-favicon" src="https://www.google.com/s2/favicons?domain=${extractDomain(tab.url)}&sz=16" alt="" />
            <span class="tab-title">${tab.title || tab.url}</span>
          </div>
        `).join("")}
        ${extraCount > 0 ? `<div class="tab-item muted"><span class="tab-more">+${extraCount} more</span></div>` : ""}
      </div>
    `;

    // Ungroup Button Logic
    card.querySelector(".ungroup-btn").addEventListener("click", async () => {
        const tabIds = tabs.map(t => t.id);
        await chrome.tabs.ungroup(tabIds);
        card.remove();
        const updatedTabs = await chrome.tabs.query({ currentWindow: true });
        updateCounts(updatedTabs.length, document.querySelectorAll('.group-card').length);
    });

    list.appendChild(card);
  }
}

// ─── Cleanup Panel ───
async function loadCleanupSuggestions() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const list = document.getElementById("cleanupList");
  if (!list) return;
  list.innerHTML = "";

  const idleTabs = tabs.filter(t => !t.active && !t.url.startsWith("chrome://"));

  if (idleTabs.length === 0) {
    list.innerHTML = `<p style="text-align:center;opacity:0.5;padding:12px">No idle tabs found</p>`;
    return;
  }

  for (const tab of idleTabs.slice(0, 5)) {
    const item = document.createElement("div");
    item.className = "cleanup-item";
    item.innerHTML = `
      <div class="cleanup-item-info">
        <img class="tab-favicon" src="https://www.google.com/s2/favicons?domain=${extractDomain(tab.url)}&sz=16" alt=""/>
        <div>
          <p class="cleanup-title">${tab.title || tab.url}</p>
          <p class="cleanup-age">Inactive tab</p>
        </div>
      </div>
      <div class="cleanup-item-actions">
        <button class="chip-btn keep">Keep</button>
        <button class="chip-btn close" data-tab-id="${tab.id}">Close</button>
      </div>
    `;

    item.querySelector(".chip-btn.close").addEventListener("click", async () => {
      await chrome.tabs.remove(tab.id);
      item.remove();
    });
    item.querySelector(".chip-btn.keep").addEventListener("click", () => item.remove());

    list.appendChild(item);
  }
}

// ─── Saved Sessions ───
function loadSessions() {
  const sessions = JSON.parse(localStorage.getItem("tabify_sessions") || "[]");
  const list = document.getElementById("sessionsList");
  const noSessions = document.getElementById("noSessions");

  if (!list) return;
  list.querySelectorAll(".session-row").forEach(r => r.remove());

  if (sessions.length === 0) {
    if (noSessions) noSessions.style.display = "block";
    return;
  }
  if (noSessions) noSessions.style.display = "none";

  for (const session of sessions.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "session-row";
    row.innerHTML = `
      <div class="session-info">
        <span class="session-name">${session.name}</span>
        <span class="session-meta">${session.tabs.length} tabs · ${timeAgo(session.savedAt)}</span>
      </div>
      <button class="restore-btn">Restore</button>
    `;
    row.querySelector(".restore-btn").addEventListener("click", async () => {
      for (const tab of session.tabs) {
        await chrome.tabs.create({ url: tab.url });
      }
    });
    list.insertBefore(row, noSessions);
  }
}

// ─── Model Loader ───
async function loadModel() {
  try {
    const modelData = await fetch(chrome.runtime.getURL('model/model.json')).then(res => res.json());
    await chrome.storage.local.set({ modelData });
    console.log("Model loaded");
  } catch (e) {
    console.warn("Model file not found, using fallback classification.");
  }
}

// ─── MAIN INIT ───
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initial Data Setup
  await loadModel();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  updateCounts(tabs.length, 0);
  loadSessions();

  // 2. Dynamic Toggle Logic
  const dynamicToggle = document.getElementById("dynamicToggle");
  const toggleStatus = document.getElementById('toggleStatus');
  const toggleRow = document.getElementById('toggleRow');

  const { dynamicGrouping } = await chrome.storage.sync.get("dynamicGrouping");
  if (dynamicToggle) {
    dynamicToggle.checked = !!dynamicGrouping;
    if (dynamicToggle.checked && toggleStatus) {
        toggleStatus.textContent = "Live Active";
        toggleRow?.classList.add('active-state');
    }

    dynamicToggle.addEventListener("change", async () => {
      await chrome.storage.sync.set({ dynamicGrouping: dynamicToggle.checked });
      if (toggleStatus) toggleStatus.textContent = dynamicToggle.checked ? "Live Active" : "Manual mode";
      dynamicToggle.checked ? toggleRow?.classList.add('active-state') : toggleRow?.classList.remove('active-state');
      
      setStatus(
        dynamicToggle.checked ? "analysing" : "idle",
        dynamicToggle.checked ? "Dynamic grouping enabled" : "Dynamic grouping disabled"
      );
    });
  }

  // 3. Auto Group & Progress Logic
  const autoGroupBtn = document.getElementById("autoGroupBtn");
  const progressFill = document.getElementById('progressFill');
  const progressContainer = document.querySelector('.progress-container');
  const btnLabel = document.getElementById('btnLabel');
  const btnShortcut = document.getElementById('btnShortcut');

  if (autoGroupBtn) {
    autoGroupBtn.addEventListener("click", async () => {
      // Start Animation
      let progress = 0;
      if (btnLabel) btnLabel.textContent = "Organizing...";
      if (btnShortcut) btnShortcut.style.display = "none";
      if (progressContainer) progressContainer.style.display = "block";
      
      const interval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setTimeout(() => {
            if (btnLabel) btnLabel.textContent = "Auto Group";
            if (btnShortcut) btnShortcut.style.display = "block";
            if (progressContainer) progressContainer.style.display = "none";
            if (progressFill) progressFill.style.width = "0%";
          }, 600);
        }
        if (progressFill) progressFill.style.width = progress + "%";
      }, 100);

      await groupTabs();
    });
  }

  // 4. Cleanup Panel Listeners
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
  });

  // 5. Save Session Listeners
  document.getElementById("saveSessionBtn")?.addEventListener("click", () => {
    document.getElementById("savePanel").style.display = "flex";
  });

  document.getElementById("closeSavePanel")?.addEventListener("click", () => {
    document.getElementById("savePanel").style.display = "none";
  });

  document.getElementById("confirmSave")?.addEventListener("click", async () => {
    const nameInput = document.getElementById("sessionNameInput");
    const name = nameInput?.value.trim();
    if (!name) return;

    const currentTabs = await chrome.tabs.query({ currentWindow: true });
    const session = {
      name,
      tabs: currentTabs.map(t => ({ url: t.url, title: t.title })),
      savedAt: Date.now()
    };
    
    const existing = JSON.parse(localStorage.getItem("tabify_sessions") || "[]");
    existing.unshift(session);
    localStorage.setItem("tabify_sessions", JSON.stringify(existing));
    
    document.getElementById("savePanel").style.display = "none";
    if (nameInput) nameInput.value = "";
    loadSessions();
  });
});