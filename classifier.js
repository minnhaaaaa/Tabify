//ai classification
let modelData;

async function loadModel() {
  modelData = await fetch(chrome.runtime.getURL('model/model.json'))
    .then(res => res.json());

  console.log("Model loaded");
}

function extractDomain(url) {
  try {
    let hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, ""); 
  } catch {
    return "";
  }
}

function computeTFIDF(text) {
  const words = text.toLowerCase().split(/\W+/);

  const vocab = modelData.vocabulary;
  const idf = modelData.idf;

  const vector = new Array(Object.keys(vocab).length).fill(0);

  const tf = {};

  words.forEach(word => {
    if (vocab[word] !== undefined) {
      tf[word] = (tf[word] || 0) + 1;
    }
  });

  for (let word in tf) {
    const index = vocab[word];
    vector[index] = tf[word] * idf[index];
  }

  return vector;
}

function predict(vector) {
  const weights = modelData.coef;
  const bias = modelData.intercept;

  const scores = weights.map((w, i) => {
    let sum = bias[i];
    for (let j = 0; j < vector.length; j++) {
      sum += vector[j] * w[j];
    }
    return sum;
  });

  // Softmax to get probabilities
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - maxScore));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sumExps);

  const maxProb = Math.max(...probs);

  // If not confident enough → Other
  if (maxProb < 0.5) {
    return modelData.classes.indexOf("Other");
  }

  return scores.indexOf(Math.max(...scores));
}

const keywordRules = {
  Coding: [
    "github", "code", "programming", "developer", "api", "debug",
    "javascript", "python", "html", "css", "react", "nodejs",
    "tutorial", "documentation", "docs", "npm", "git", "deploy",
    "frontend", "backend", "database", "framework", "library"
  ],
  Study: [
    "lecture", "course", "learn", "notes", "exam", "syllabus",
    "university", "college", "tutorial", "education", "chapter",
    "assignment", "quiz", "study", "class", "lesson", "textbook",
    "mcq", "revision", "practice", "formula", "subject"
  ],
  Shopping: [
    "buy", "shop", "cart", "order", "price", "sale", "discount",
    "delivery", "offer", "deal", "checkout", "product", "store"
  ],
  Entertainment: [
    "watch", "stream", "movie", "music", "song", "episode",
    "series", "video", "playlist", "podcast", "meme", "funny",
    "trending", "viral", "celebrity", "trailer"
  ],
  Games: [
    "game", "play", "gaming", "player", "multiplayer", "score",
    "level", "quest", "tournament", "esports", "clan", "match"
  ],
  Financial: [
    "bank", "invest", "stock", "finance", "loan", "insurance",
    "mutual fund", "trading", "market", "portfolio", "tax",
    "credit", "debit", "payment", "wallet", "upi", "emi"
  ]
};

function keywordClassify(text) {
  const lower = text.toLowerCase();
  const scores = {};

  for (const [category, keywords] of Object.entries(keywordRules)) {
    scores[category] = keywords.filter(k => lower.includes(k)).length;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  // Only return if at least 1 keyword matched
  if (best[1] > 0) return best[0];
  return null; // no keywords matched
}

// ─── Domain Whitelist ───
const domainRules = {
  // Search engines → always Other
  "google.com": "Other",
  "bing.com": "Other",
  "duckduckgo.com": "Other",
  "yahoo.com": "Other",
  "google.co.in": "Other",

  // Games → always Games
  "friv.com": "Games",
  "poki.com": "Games",
  "chess.com": "Games",
  "miniclip.com": "Games",

  // Entertainment
  "youtube.com": null, // null = let ML decide (could be Study or Entertainment)
  "netflix.com": "Entertainment",
  "spotify.com": "Entertainment",
  "twitch.tv": "Entertainment",

  // Coding
  "github.com": "Coding",
  "leetcode.com": "Coding",
  "stackoverflow.com": "Coding",

  // Financial
  "zerodha.com": "Financial",
  "groww.in": "Financial",
};

function classifyTab(tab) {
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("chrome-extension://")) {
        return "Other";}
  const domain = extractDomain(tab.url);
  const text = (tab.title + " " + domain).toLowerCase();

  // 1. Exact domain whitelist
  if (domain in domainRules) {
    const rule = domainRules[domain];
    if (rule !== null) return rule; // hard override
  }

  // 2. TLD rules
  if (domain.endsWith(".ac.in") || domain.endsWith(".edu") || domain.endsWith(".ac.uk")) return "Study";
  if (domain.endsWith(".gov.in") || domain.endsWith(".gov")) return "Other";

  //3. Keyword Matching
  const keywordResult = keywordClassify(text);
  if (keywordResult) return keywordResult;

  // 3. ML classification
  const vector = computeTFIDF(text);
  const index = predict(vector);
  const category = modelData.classes[index];
  const shoppingKeywords = ["buy", "shop", "cart", "order", "price", "sale",
                            "discount", "delivery", "offer", "deal", "checkout"];
  if (category === "Shopping" && !shoppingKeywords.some(k => text.includes(k))) {
    return "Other";
  }
  return modelData.classes[index];
}