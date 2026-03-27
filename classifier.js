// Global variable to store model once loaded
let modelData = null;
let isModelReady = false;

async function loadModel() {
  try {
    const res = await fetch(chrome.runtime.getURL('model/model.json'));
    modelData = await res.json();
    isModelReady = true;
    console.log("Classifier: Model loaded successfully");
  } catch (err) {
    console.error("Classifier: Failed to load model", err);
  }
}

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
  // Lowercase and remove non-alphanumeric characters to match Python tokenizers
  text = text.toLowerCase().replace(/[^\w\s]/g, ' ');

  const phraseMap = [
    { pattern: /series [abc]/g, replace: "funding_round" },
    { pattern: /(tv|web|netflix) series/g, replace: "tv_series" },
    { pattern: /(stock|share) market/g, replace: "stock_market" },
    { pattern: /online (shopping|buy)/g, replace: "online_shopping" }
  ];

  phraseMap.forEach(({ pattern, replace }) => {
    text = text.replace(pattern, replace);
  });

  return text.trim();
}

function computeTFIDF(text) {
  if (!modelData || !modelData.vocabulary) return [];

  const words = text.split(/\s+/);
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

  // --- L2 Normalization (Crucial for Scikit-Learn models) ---
  const squareSum = vector.reduce((sum, val) => sum + (val * val), 0);
  const norm = Math.sqrt(squareSum);
  return norm > 0 ? vector.map(v => v / norm) : vector;
}

function predict(vector) {
  if (!modelData || !modelData.coef || vector.length === 0) return -1;

  const weights = modelData.coef; 
  const bias = modelData.intercept;

  // Calculate scores (Logits)
  const scores = weights.map((w, i) => {
    let sum = bias[i];
    for (let j = 0; j < vector.length; j++) {
      sum += vector[j] * w[j];
    }
    return sum;
  });

  // Softmax for Probability Distribution
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - maxScore));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sumExps);

  const maxProb = Math.max(...probs);
  const maxIndex = probs.indexOf(maxProb);

  // If confidence is low, default to 'Other'
  if (maxProb < 0.45) {
    const otherIdx = modelData.classes.indexOf("Other");
    return otherIdx !== -1 ? otherIdx : maxIndex;
  }

  return maxIndex;
}

const domainRules = {
  "google.com": "Other", "bing.com": "Other", "duckduckgo.com": "Other",
  "yahoo.com": "Other", "google.co.in": "Other", "friv.com": "Games",
  "poki.com": "Games", "chess.com": "Games", "miniclip.com": "Games",
  "youtube.com": null, "netflix.com": "Entertainment", "twitch.tv": "Entertainment",
  "github.com": "Coding", "leetcode.com": "Coding", "stackoverflow.com": "Coding",
  "zerodha.com": "Financial", "groww.in": "Financial",
};

function classifyTab(tab) {
  if (!tab.url || /^(chrome|edge|chrome-extension):/.test(tab.url)) {
    return "Other";
  }

  const domain = extractDomain(tab.url);

  // 1. Exact domain whitelist
  if (domain in domainRules && domainRules[domain] !== null) {
    return domainRules[domain];
  }

  // 2. TLD / Hard-coded Rules
  // Study: .edu, .ac, .ac.in, .ac.uk
  if (/\.(edu|ac|ac\.[a-z]{2})$/.test(domain)) return "Study";
  
  // Financial: .bank, or domain contains bank/finance/insurance
  if (domain.endsWith(".bank") || /bank|finance|insurance/.test(domain)) return "Financial";

  // Other: .gov, .nic.in
  if (/\.gov(\.[a-z]{2})?$/.test(domain) || domain.endsWith(".nic.in")) return "Other";

  // 3. ML classification
  if (isModelReady) {
    const rawText = (tab.title || "") + " " + domain;
    const text = normalizeText(rawText);
    const vector = computeTFIDF(text);
    const index = predict(vector);
    
    if (index !== -1) {
      const category = modelData.classes[index];
      
      // Verification for Shopping
      if (category === "Shopping") {
        const shopKeywords = ["buy", "shop", "cart", "order", "price", "sale", "discount", "offer"];
        if (!shopKeywords.some(k => text.includes(k))) return "Other";
      }
      return category;
    }
  }

  return "Other";
}