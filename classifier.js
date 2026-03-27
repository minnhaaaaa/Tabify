// Global variable to store model once loaded
let modelData = null;

async function loadModel() {
  try {
    const res = await fetch(chrome.runtime.getURL('model/model.json'));
    modelData = await res.json();
    console.log("Classifier: Model loaded successfully");
  } catch (err) {
    console.error("Classifier: Failed to load model", err);
  }
}

// Initial load call
loadModel();

function extractDomain(url) {
  try {
    let hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeText(text) {
  if (!text) return "";
  text = text.toLowerCase();

  const phraseMap = [
    { pattern: /series a|series b|series c/g, replace: "funding_round" },
    { pattern: /tv series|web series|netflix series/g, replace: "tv_series" },
    { pattern: /stock market|share market/g, replace: "stock_market" },
    { pattern: /online shopping|buy online/g, replace: "online_shopping" }
  ];

  phraseMap.forEach(({ pattern, replace }) => {
    text = text.replace(pattern, replace);
  });

  return text;
}

function computeTFIDF(text) {
  // SAFETY: If model isn't loaded yet, return an empty array
  if (!modelData || !modelData.vocabulary) return [];

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
  // SAFETY: Check if model data exists
  if (!modelData || !modelData.coef || vector.length === 0) return -1;

  const weights = modelData.coef;
  const bias = modelData.intercept;

  const scores = weights.map((w, i) => {
    let sum = bias[i];
    for (let j = 0; j < vector.length; j++) {
      sum += vector[j] * w[j];
    }
    return sum;
  });

  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - maxScore));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sumExps);

  const maxProb = Math.max(...probs);

  if (maxProb < 0.5) {
    return modelData.classes.indexOf("Other");
  }

  return scores.indexOf(Math.max(...scores));
}

// ─── Domain Whitelist ───
const domainRules = {
  "google.com": "Other",
  "bing.com": "Other",
  "duckduckgo.com": "Other",
  "yahoo.com": "Other",
  "google.co.in": "Other",
  "friv.com": "Games",
  "poki.com": "Games",
  "chess.com": "Games",
  "miniclip.com": "Games",
  "youtube.com": null, 
  "netflix.com": "Entertainment",
  "twitch.tv": "Entertainment",
  "github.com": "Coding",
  "leetcode.com": "Coding",
  "stackoverflow.com": "Coding",
  "zerodha.com": "Financial",
  "groww.in": "Financial",
};

function classifyTab(tab) {
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("chrome-extension://")) {
    return "Other";
  }

  const domain = extractDomain(tab.url);
  const rawText = (tab.title || "") + " " + domain;
  const text = normalizeText(rawText);

  // 1. Exact domain whitelist
  if (domain in domainRules) {
    const rule = domainRules[domain];
    if (rule !== null) return rule;
  }

  // 2. TLD rules
  if (domain.endsWith(".ac.in") || domain.endsWith(".edu") || domain.endsWith(".ac.uk") || domain.endsWith(".ac")) return "Study";
  if (domain.endsWith(".gov.in") || domain.endsWith(".gov") || domain.endsWith(".nic.in")) return "Other";
  
  // Financial check
  if (domain.endsWith(".bank") || domain.includes(".bank.") || domain.includes("bank") || domain.includes("finance") || domain.includes("insurance")) {
    return "Financial";
  }

  // 3. ML classification (only if modelData is ready)
  if (modelData) {
    const vector = computeTFIDF(text);
    const index = predict(vector);
    
    if (index !== -1) {
      const category = modelData.classes[index];
      const shoppingKeywords = ["buy", "shop", "cart", "order", "price", "sale", "discount", "delivery", "offer", "deal", "checkout"];
      
      // Verification logic for Shopping
      if (category === "Shopping" && !shoppingKeywords.some(k => text.includes(k))) {
        return "Other";
      }
      return category;
    }
  }

  // Fallback if model isn't ready or ML fails
  return "Other";
}