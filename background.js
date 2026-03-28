const categoryColors = {
  Coding:        "blue",
  Shopping:      "pink",
  Entertainment: "red",
  Study:         "green",
  Games:         "purple",
  Financial:     "yellow",
  Other:         "grey"
};

// Listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;
  if (/^(chrome|edge|chrome-extension):/.test(tab.url)) return;

  const { dynamicGrouping } = await chrome.storage.sync.get("dynamicGrouping");
  if (!dynamicGrouping) return;

  // Load model from storage (populated by popup.js on first open)
  const { modelData } = await chrome.storage.local.get("modelData");
  await groupSingleTab(tab, modelData);
});

// Group single tab into existing groups
async function groupSingleTab(tab, modelData) {
  const category = classifyTabBg(tab, modelData);

  const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const match          = existingGroups.find(g => g.title === category);

  if (match) {
    await chrome.tabs.group({ tabIds: [tab.id], groupId: match.id });
  } else {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, {
      title: category,
      color: categoryColors[category] || "grey"
    });
  }
}

// Classification Logic

function extractDomainBg(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function normalizeTextBg(text) {
  if (!text) return "";
  text = text.toLowerCase().replace(/[^\w\s]/g, " ");
  [
    [/series [abc]/g,           "funding_round"   ],
    [/(tv|web|netflix) series/g, "tv_series"       ],
    [/(stock|share) market/g,    "stock_market"    ],
    [/online (shopping|buy)/g,   "online_shopping" ],
  ].forEach(([pat, rep]) => { text = text.replace(pat, rep); });
  return text.trim();
}

function computeTFIDBg(text, modelData) {
  if (!modelData || !modelData.vocabulary) return [];
  const words  = text.split(/\s+/);
  const vocab  = modelData.vocabulary;
  const idf    = modelData.idf;
  const vector = new Array(Object.keys(vocab).length).fill(0);
  const tf     = {};

  words.forEach(w => {
    if (vocab[w] !== undefined) tf[w] = (tf[w] || 0) + 1;
  });
  for (const w in tf) {
    vector[vocab[w]] = tf[w] * idf[vocab[w]];
  }

  // L2 normalisation — required by scikit-learn LogisticRegression
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

  // Increase confidence threshold to 0.65 to avoid misclassification
  if (maxProb < 0.65) {
    const otherIdx = modelData.classes.indexOf("Other");
    return otherIdx !== -1 ? otherIdx : -1;
  }
  return maxIndex;
}

// YouTube keyword heuristic — identical to classifier.js
function classifyYouTubeBg(title) {
  const t = title.toLowerCase();

  const studyKW = [
    "lecture","tutorial","course","class","lesson",
    "physics","chemistry","biology","mathematics","maths",
    "calculus","algebra","integration","differentiation",
    "thermodynamics","electrostatics","mechanics","optics",
    "jee","neet","gate","upsc","cbse","ncert",
    "physics wallah","khan academy","crashcourse","3blue1brown",
    "mit opencourseware","nptel","vedantu","unacademy",
    "abdul bari","cs50","andrew ng",
    "data structures","algorithms","dsa","operating system",
    "computer networks","dbms","discrete math",
    "study","exam","syllabus","notes","solution",
    "past paper","previous year","mock test",
    "neural network explained","machine learning explained",
    "what is","how does","how to learn",
    "homework","assignment","textbook",
  ];
  const gameKW = [
    "gameplay","walkthrough","playthrough","let's play","lets play",
    "gaming","game","minecraft","fortnite","valorant","csgo",
    "gta","roblox","pubg","freefire","cod","warzone",
    "highlights","clutch","speedrun","patch notes","season update",
  ];
  const entKW = [
    "trailer","mv","music video","official video","lyric video",
    "song","album","playlist","podcast","interview",
    "reaction","roast","challenge","prank","vlog",
    "comedy","meme","shorts","trending","viral",
    "movie","series","episode","season","web series",
    "anime","asmr","mukbang","unboxing",
    "mrbeast","pewdiepie","carryminati","bb ki vines",
    "bollywood","hollywood","netflix","prime",
  ];

  let s = 0, g = 0, e = 0;
  studyKW.forEach(k => { if (t.includes(k)) s += 2; });
  gameKW.forEach(k  => { if (t.includes(k)) g++;    });
  entKW.forEach(k   => { if (t.includes(k)) e++;    });

  if (s > 0 && s >= g && s >= e) return "Study";
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

  if (domain in domainRulesBg) return domainRulesBg[domain];

  if (domain === "youtube.com") {
    const r = classifyYouTubeBg(title);
    if (r !== null) return r;
  }

  if (/\.(edu|ac|ac\.[a-z]{2})$/.test(domain))                              return "Study";
  if (/\.gov(\.[a-z]{2})?$/.test(domain) || domain.endsWith(".nic.in"))     return "Other";
  if (domain.endsWith(".bank") || /\bbank\b|\bfinance\b|\binsurance\b/.test(domain)) return "Financial";

  if (modelData) {
    const text   = normalizeTextBg(title + " " + domain);
    const vector = computeTFIDBg(text, modelData);
    const index  = predictBg(vector, modelData);

    if (index !== -1) {
      const category = modelData.classes[index];
      if (category === "Shopping") {
        const shopKW = [
          "buy","shop","cart","order","price","sale","discount",
          "offer","deal","checkout","purchase","delivery","store",
          "myntra","flipkart","amazon","nykaa","ajio","meesho",
          "snapdeal","croma","ikea","tatacliq"
        ];
        if (!shopKW.some(k => text.includes(k) || domain.includes(k))) return "Other";
      }
      return category;
    }
  }

  return "Other";
}
