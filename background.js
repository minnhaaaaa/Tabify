const categoryColors = {
  Coding:        "blue",
  Shopping:      "pink",
  Entertainment: "red",
  Study:         "green",
  Games:         "purple",
  Financial:     "yellow",
  Other:         "grey"
};

// ─── Periodic LRU Notification ───
chrome.alarms.create("lruCheck", { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "lruCheck") {
    const { inactiveThreshold } = await chrome.storage.sync.get({ inactiveThreshold: 20 });
    const thresholdMs = inactiveThreshold * 60 * 1000;
    const now = Date.now();

    const tabs = await chrome.tabs.query({});
    const idleTabs = tabs.filter(t => !t.active && !t.url.startsWith("chrome://") && (now - (t.lastAccessed || now)) > thresholdMs);

    if (idleTabs.length > 0) {
      idleTabs.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
      const lruTab = idleTabs[0];

      chrome.notifications.create("lruNotification", {
        type: "basic",
        iconUrl: "new-logo.png",
        title: "Tabify Cleanup",
        message: `Your tab "${lruTab.title.substring(0, 30)}..." hasn\\'t been used in a while. Want to close it?`,
        buttons: [
          { title: "Close Tab" },
          { title: "Review All Inactive" }
        ],
        priority: 1
      });

      await chrome.storage.local.set({ lastLruTabId: lruTab.id });
    }
  }
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId === "lruNotification") {
    if (buttonIndex === 0) {
      const { lastLruTabId } = await chrome.storage.local.get("lastLruTabId");
      if (lastLruTabId) {
        chrome.tabs.remove(lastLruTabId);
      }
    } else if (buttonIndex === 1) {
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html#cleanup") });
    }
  }
});

// ─── Dynamic Grouping Listener ───
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Trigger on status complete OR title change OR URL change (important for SPAs like YouTube)
  if (changeInfo.status !== "complete" && !changeInfo.title && !changeInfo.url) return;
  if (!tab.url) return;
  if (/^(chrome|edge|chrome-extension):/.test(tab.url)) return;

  const { dynamicGrouping } = await chrome.storage.sync.get({ dynamicGrouping: false });
  if (!dynamicGrouping) return;

  const { modelData } = await chrome.storage.local.get("modelData");

  // Add a small delay for SPAs to ensure the title/URL has fully updated in the DOM
  if (changeInfo.title || changeInfo.url || changeInfo.status === "complete") {
    setTimeout(async () => {
      try {
        const updatedTab = await chrome.tabs.get(tabId);
        await groupSingleTab(updatedTab, modelData);
      } catch (e) {
        console.error("Error updating tab group:", e);
      }
    }, 1000); // 1 second delay to be safe for YouTube/SPAs
  }
});

async function groupSingleTab(tab, modelData, retries = 3, delay = 500) {
  try {
    const category = classifyTabBg(tab, modelData);
    const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const match = existingGroups.find(g => g.title === category);

    if (match) {
      try {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: match.id });
      } catch (e) {
        // If the group was just closed, create a new one
        const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        await chrome.tabGroups.update(groupId, {
          title: category,
          color: categoryColors[category] || "grey"
        });
      }
    } else {
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, {
        title: category,
        color: categoryColors[category] || "grey"
      });
    }
  } catch (e) {
    // Retry if Chrome is temporarily blocking tab edits (user dragging, etc.)
    if (e.message && e.message.includes("Tabs cannot be edited") && retries > 0) {
      console.warn(`[Grouping] Retrying in ${delay}ms (${retries} retries left)`);
      setTimeout(() => {
        groupSingleTab(tab, modelData, retries - 1, delay * 1.5);
      }, delay);
    } else {
      console.error("[Grouping] Failed to group tab:", e);
    }
  }
}

// ─── Classification Logic (Unified) ───
function extractDomainBg(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function extractRelevantTextFromUrlBg(url, domain, title) {
  let extractedText = "";

  if (domain === "youtube.com") {
    const match = url.match(/[?&]search_query=([^&]+)/);
    if (match) extractedText = decodeURIComponent(match[1].replace(/\+/g, " "));
    // Clean and append title
    const cleanTitle = title
      ? title.replace(/ - YouTube$/, "").replace(/ \(\d+\)$/, "").trim()
      : "";
    if (cleanTitle) extractedText = (extractedText ? extractedText + " " : "") + cleanTitle;

  } else if (domain === "reddit.com") {
    const searchMatch = url.match(/\/r\/[^/]+\/search[?&]q=([^&]+)/);
    if (searchMatch) {
      extractedText = decodeURIComponent(searchMatch[1].replace(/\+/g, " "));
    } else {
      const postMatch = url.match(/\/r\/([^/]+)\/comments\/[^/]+\/([^/]+)/);
      if (postMatch) extractedText = `${postMatch[1]} ${postMatch[2].replace(/_/g, " ")}`;
    }
    // Always append title for Reddit - strip the " : subreddit" suffix
    const cleanTitle = title
      ? title.replace(/ : [^:]+$/, "").replace(/ - Reddit$/, "").trim()
      : "";
    if (cleanTitle && cleanTitle !== "reddit") {
      extractedText = (extractedText ? extractedText + " " : "") + cleanTitle;
    }

  } else if (domain === "quora.com") {
    const searchMatch = url.match(/\/search[?&]q=([^&]+)/);
    if (searchMatch) {
      extractedText = decodeURIComponent(searchMatch[1].replace(/\+/g, " "));
    } else {
      const questionMatch = url.match(/quora\.com\/([^/?#]+)/);
      if (questionMatch) extractedText = questionMatch[1].replace(/-/g, " ");
    }
    // Always append title for Quora - strip " - Quora" suffix
    const cleanTitle = title
      ? title.replace(/ - Quora$/, "").trim()
      : "";
    if (cleanTitle && cleanTitle !== "quora") {
      extractedText = (extractedText ? extractedText + " " : "") + cleanTitle;
    }

  } else if (domain === "stackoverflow.com") {
    const questionMatch = url.match(/\/questions\/\d+\/([^/?#]+)/);
    if (questionMatch) extractedText = questionMatch[1].replace(/-/g, " ");
    // Append title, strip " - Stack Overflow"
    const cleanTitle = title
      ? title.replace(/ - Stack Overflow$/, "").trim()
      : "";
    if (cleanTitle) extractedText = (extractedText ? extractedText + " " : "") + cleanTitle;

  } else if (["google.com", "bing.com", "duckduckgo.com"].includes(domain)) {
    const match = url.match(/[?&]q=([^&]+)/);
    if (match) extractedText = decodeURIComponent(match[1].replace(/\+/g, " "));
  }

  return extractedText.trim();
}

function normalizeTextBg(text) {
  if (!text) return "";
  text = text.toLowerCase();
  text = text.replace(/series [abc]/g, "funding_round");
  text = text.replace(/series \d+/g, "product_series");
  text = text.replace(/(tv|web|netflix|original|anime) series/g, "tv_series");
  text = text.replace(/[^\w\s]/g, " ");
  return text.trim();
}

function computeTFIDBg(text, modelData) {
  if (!modelData || !modelData.vocabulary) return [];
  const words = text.split(/\s+/);
  const vocab = modelData.vocabulary;
  const idf   = modelData.idf;
  const vector = new Array(Object.keys(vocab).length).fill(0);
  const tf    = {};

  words.forEach(w => {
    if (vocab[w] !== undefined) tf[w] = (tf[w] || 0) + 1;
  });

  if (modelData.ngram_range && modelData.ngram_range[1] >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i+1]}`;
      if (vocab[bigram] !== undefined) tf[bigram] = (tf[bigram] || 0) + 1;
    }
  }

  for (const w in tf) {
    vector[vocab[w]] = tf[w] * idf[vocab[w]];
  }

  const squareSum = vector.reduce((s, v) => s + v * v, 0);
  const norm      = Math.sqrt(squareSum);
  return norm > 0 ? vector.map(v => v / norm) : vector;
}

function predictBg(vector, modelData) {
  if (!modelData || !modelData.coef || vector.length === 0) return -1;
  const weights = modelData.coef;
  const bias    = modelData.intercept;

  const scores = weights.map((w, i) => {
    let sum = bias[i];
    for (let j = 0; j < vector.length; j++) sum += vector[j] * w[j];
    return sum;
  });

  const maxScore = Math.max(...scores);
  const exps     = scores.map(s => Math.exp(s - maxScore));
  const sumExps  = exps.reduce((a, b) => a + b, 0);
  const probs    = exps.map(e => e / sumExps);
  const maxProb  = Math.max(...probs);
  const maxIndex = probs.indexOf(maxProb);

  if (maxProb < 0.3) {
    const otherIdx = modelData.classes.indexOf("Other");
    return otherIdx !== -1 ? otherIdx : -1;
  }
  return maxIndex;
}

function classifyYouTubeBg(title) {
  const t = title.toLowerCase();
  const studyKW = ["lecture","tutorial","course","class","lesson","physics","chemistry","biology","mathematics","maths","calculus","algebra","integration","differentiation","thermodynamics","electrostatics","mechanics","optics","jee","neet","gate","upsc","cbse","ncert","physics wallah","khan academy","crashcourse","3blue1brown","mit opencourseware","nptel","vedantu","unacademy","abdul bari","cs50","andrew ng","data structures","algorithms","dsa","operating system","computer networks","dbms","discrete math","study","exam","syllabus","notes","solution","past paper","previous year","mock test","neural network explained","machine learning explained","what is","how does","how to learn","homework","assignment","textbook","vit"];
  const gameKW = ["gameplay","walkthrough","playthrough","let's play","lets play","gaming","minecraft","fortnite","valorant","csgo","gta","roblox","pubg","freefire","cod","warzone","highlights","clutch","speedrun","patch notes","season update"];
  const codeKW = ["how to code","learn to code","programming","coding","code","game development","game dev","unity","unreal","godot","pygame","project","build"]
  const entKW = ["trailer","mv","music video","official video","lyric video","song","album","playlist","podcast","interview","reaction","roast","challenge","prank","vlog","comedy","meme","shorts","trending","viral","movie","series","episode","season","web series","anime","asmr","mukbang","unboxing","mrbeast","pewdiepie","carryminati","bb ki vines","bollywood","hollywood","netflix","prime"];

  let s = 0, g = 0, e = 0,c=0;
  codeKW.forEach(k => { if (t.includes(k)) c += 2; });
  studyKW.forEach(k => { if (t.includes(k)) s += 2; });
  gameKW.forEach(k  => { if (t.includes(k)) g++;    });
  entKW.forEach(k   => { if (t.includes(k)) e++;    });

  if (s > 0 && s >= g && s >= e) return "Study";
  if (c > 0 && c >= g && c >= e) return "Coding";
  if (g > e && g > s)            return "Games";
  if (e > 0)                     return "Entertainment";
  return null;
}

const domainRulesBg = {
  "google.com":        "Other",
  "google.co.in":      "Other",
  "bing.com":          "Other",
  "duckduckgo.com":    "Other",
  "yahoo.com":         "Other",
  "friv.com":          "Games",
  "poki.com":          "Games",
  "chess.com":         "Games",
  "miniclip.com":      "Games",
  "netflix.com":       "Entertainment",
  "hotstar.com":       "Entertainment",
  "primevideo.com":    "Entertainment",
  "twitch.tv":         "Entertainment",
  "spotify.com":       "Entertainment",
  "instagram.com":     "Entertainment",
  "github.com":        "Coding",
  "leetcode.com":      "Coding",
  "stackoverflow.com": "Coding",
  "zerodha.com":       "Financial",
  "groww.in":          "Financial",
  "hdfcbank.com":      "Financial",
  "sbi.co.in":         "Financial",
  "icicibank.com":     "Financial",
  "paytm.com":         "Financial",
  "myntra.com":        "Shopping",
  "amazon.in":         "Shopping",
};

function classifyTabBg(tab, modelData) {
  if (!tab.url || /^(chrome|edge|chrome-extension):/.test(tab.url)) return "Other";
  const domain = extractDomainBg(tab.url);
  const title  = tab.title || "";
  let textToClassify = title + " " + domain;

  const relevantUrlText = extractRelevantTextFromUrlBg(tab.url, domain, title);
  if (relevantUrlText) {
    textToClassify = (relevantUrlText || title) + " " + domain;
  }
  console.log(`[Tabify] domain: ${domain} | text: "${textToClassify}"`);

  if (domain in domainRulesBg) return domainRulesBg[domain];
  if (domain === "youtube.com") {
    const r = classifyYouTubeBg(title);
    if (r !== null) return r;
  }
  if (/\.(edu|ac|ac\.[a-z]{2})$/.test(domain))                              return "Study";
  if (/\.gov(\.[a-z]{2})?$/.test(domain) || domain.endsWith(".nic.in"))     return "Other";
  if (domain.endsWith(".bank") || /\bbank\b|\bfinance\b|\binsurance\b/.test(domain)) return "Financial";

  if (modelData) {
    const text   = normalizeTextBg(textToClassify);
    const vector = computeTFIDBg(text, modelData);
    const index  = predictBg(vector, modelData);
    if (index !== -1) {
      const category = modelData.classes[index];
      if (category === "Shopping") {
        const shopKW = ["buy","shop","cart","order","price","sale","discount","offer","deal","checkout","purchase","delivery","store","myntra","flipkart","amazon","nykaa","ajio","meesho","snapdeal","croma","ikea","tatacliq"];
        if (!shopKW.some(k => text.includes(k) || domain.includes(k))) return "Other";
      }
      return category;
    }
  }
  return "Other";
}
