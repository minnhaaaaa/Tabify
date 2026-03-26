// ─── Listen for tab updates ───
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only trigger when page is fully loaded
  if (changeInfo.status !== "complete") return;
  if (!tab.url || tab.url.startsWith("chrome://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("chrome-extension://")) return;

  // Check if dynamic grouping is enabled
  const { dynamicGrouping } = await chrome.storage.sync.get("dynamicGrouping");
  if (!dynamicGrouping) return;

  // Wait for model to be ready
  const { modelData } = await chrome.storage.local.get("modelData");
  if (!modelData) return;

  // Classify and group this tab
  await groupSingleTab(tab, modelData);
});

// ─── Group a single tab into existing or new group ───
async function groupSingleTab(tab, modelData) {
  const category = classifyTabBackground(tab, modelData);

  // Find existing group with same category name
  const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const matchingGroup = existingGroups.find(g => g.title === category);

  if (matchingGroup) {
    // Add tab to existing group
    await chrome.tabs.group({ tabIds: [tab.id], groupId: matchingGroup.id });
  } else {
    // Create new group
    const categoryColors = {
      Coding: "blue", Shopping: "pink", Entertainment: "red",
      Study: "green", Games: "purple", Financial: "yellow", Other: "grey"
    };
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, {
      title: category,
      color: categoryColors[category] || "grey"
    });
  }
}

// ─── Inline classification for background ───
const domainRules = {
  "google.com": "Other", "bing.com": "Other",
  "duckduckgo.com": "Other", "yahoo.com": "Other",
  "friv.com": "Games", "poki.com": "Games",
  "chess.com": "Games", "miniclip.com": "Games",
  "youtube.com": null,
  "netflix.com": "Entertainment", "spotify.com": "Entertainment",
  "twitch.tv": "Entertainment",
  "github.com": "Coding", "leetcode.com": "Coding",
  "stackoverflow.com": "Coding",
  "zerodha.com": "Financial", "groww.in": "Financial",
  "chatgpt.com": "Other", "claude.ai": "Other",
};


function extractDomainBg(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch { return ""; }
}

function classifyTabBackground(tab, modelData) {
  const domain = extractDomainBg(tab.url);
  const text = (tab.title + " " + domain).toLowerCase();

  // 1. Domain whitelist
  if (domain in domainRules) {
    const rule = domainRules[domain];
    if (rule !== null) return rule;
  }

  // 2. TLD rules
  if (domain.endsWith(".ac.in") || domain.endsWith(".edu") ||
      domain.endsWith(".ac.uk")) return "Study";
  if (domain.endsWith(".gov.in") || domain.endsWith(".gov")) return "Other";


  // 3. ML model
  const vector = computeTFIDBg(text, modelData);
  const index = predictBg(vector, modelData);
  if (index === -1) return "Other";

  const category = modelData.classes[index];
  const shoppingKeywords = ["buy","shop","cart","order","price",
                            "sale","discount","delivery","offer","deal"];
  if (category === "Shopping" && !shoppingKeywords.some(k => text.includes(k))) {
    return "Other";
  }
  return category;
}

function computeTFIDBg(text, modelData) {
  const words = text.toLowerCase().split(/\W+/);
  const vocab = modelData.vocabulary;
  const idf = modelData.idf;
  const vector = new Array(Object.keys(vocab).length).fill(0);
  const tf = {};
  words.forEach(word => {
    if (vocab[word] !== undefined) tf[word] = (tf[word] || 0) + 1;
  });
  for (let word in tf) {
    vector[vocab[word]] = tf[word] * idf[vocab[word]];
  }
  return vector;
}

function predictBg(vector, modelData) {
  const weights = modelData.coef;
  const bias = modelData.intercept;
  const scores = weights.map((w, i) => {
    let sum = bias[i];
    for (let j = 0; j < vector.length; j++) sum += vector[j] * w[j];
    return sum;
  });
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - maxScore));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sum);
  if (Math.max(...probs) < 0.5) return -1;
  return scores.indexOf(maxScore);
}