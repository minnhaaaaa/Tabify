const categoryColors = {
  Coding:        "blue",
  Shopping:      "pink",
  Entertainment: "red",
  Study:         "green",
  Games:         "purple",
  Financial:     "yellow",
  Other:         "grey"
};

// ─── Group Tabs ───
async function groupTabs() {
  setStatus("analysing", "Analysing your tabs...");

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = {};

  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith("chrome://")) continue;
    const category = classifyTab(tab); // ← from classifier.js
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
}

// ─── Render Groups ───
function renderGroups(groups) {
  const list = document.getElementById("groupsList");
  const emptyState = document.getElementById("emptyState");

  list.querySelectorAll(".group-card").forEach(c => c.remove());

  if (Object.keys(groups).length === 0) {
    emptyState.style.display = "flex";
    return;
  }
  emptyState.style.display = "none";

  for (const [category, tabs] of Object.entries(groups)) {
    const card = document.createElement("div");
    card.className = "group-card";
    card.dataset.color = categoryColors[category] || "grey";

    const visibleTabs = tabs.slice(0, 3);
    const extraCount = tabs.length - visibleTabs.length;

    card.innerHTML = `
      <div class="group-card-header">
        <div class="group-identity">
          <span class="group-color-dot" data-color="${categoryColors[category]}"></span>
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
            <img class="tab-favicon"
              src="https://www.google.com/s2/favicons?domain=${extractDomain(tab.url)}&sz=16"
              alt="" />
            <span class="tab-title">${tab.title || tab.url}</span>
          </div>
        `).join("")}
        ${extraCount > 0 ? `<div class="tab-item muted"><span class="tab-more">+${extraCount} more</span></div>` : ""}
      </div>
    `;

    list.appendChild(card);
  }
}

// ─── Status Bar ───
function setStatus(state, message) {
  document.querySelector(".status-dot").className = "status-dot " + state;
  document.getElementById("statusText").textContent = message;
}

// ─── Update Counts ───
function updateCounts(tabCount, groupCount) {
  document.getElementById("totalCount").textContent = `${tabCount} tabs`;
  document.getElementById("groupCount").textContent = groupCount;
}

// ─── Cleanup Panel ───
async function loadCleanupSuggestions() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const list = document.getElementById("cleanupList");
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
        <img class="tab-favicon"
          src="https://www.google.com/s2/favicons?domain=${extractDomain(tab.url)}&sz=16"
          alt=""/>
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

  list.querySelectorAll(".session-row").forEach(r => r.remove());

  if (sessions.length === 0) {
    noSessions.style.display = "block";
    return;
  }
  noSessions.style.display = "none";

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

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Init ───
document.addEventListener("DOMContentLoaded", async () => {
  await loadModel(); // ← from classifier.js

  const tabs = await chrome.tabs.query({ currentWindow: true });
  updateCounts(tabs.length, 0);
  loadSessions();

  document.getElementById("autoGroupBtn").addEventListener("click", groupTabs);

  document.getElementById("cleanupBtn").addEventListener("click", () => {
    loadCleanupSuggestions();
    document.getElementById("cleanupPanel").style.display = "flex";
  });

  document.getElementById("closeCleanupPanel").addEventListener("click", () => {
    document.getElementById("cleanupPanel").style.display = "none";
  });

  document.getElementById("closeAllSuggested").addEventListener("click", async () => {
    const btns = document.querySelectorAll(".chip-btn.close[data-tab-id]");
    for (const btn of btns) await chrome.tabs.remove(parseInt(btn.dataset.tabId));
    document.getElementById("cleanupPanel").style.display = "none";
  });
  document.getElementById("saveSessionBtn").addEventListener("click", () => {
  document.getElementById("savePanel").style.display = "flex";
});

  document.getElementById("closeSavePanel").addEventListener("click", () => {
    document.getElementById("savePanel").style.display = "none";
  });

  document.getElementById("confirmSave").addEventListener("click", async () => {
    const name = document.getElementById("sessionNameInput").value.trim();
    if (!name) return;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const session = {
      name,
      tabs: tabs.map(t => ({ url: t.url, title: t.title })),
      savedAt: Date.now()
    };
    const existing = JSON.parse(localStorage.getItem("tabify_sessions") || "[]");
    existing.unshift(session);
    localStorage.setItem("tabify_sessions", JSON.stringify(existing));
    document.getElementById("savePanel").style.display = "none";
    loadSessions();
  });
});