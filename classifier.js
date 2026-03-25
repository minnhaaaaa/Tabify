//ai classification
let modelData;

async function loadModel() {
  modelData = await fetch(chrome.runtime.getURL('model/model.json'))
    .then(res => res.json());

  console.log("Model loaded");
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
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

  return scores.indexOf(Math.max(...scores));
}

function classifyTab(tab) {
  const text = (tab.title + " " + extractDomain(tab.url)).toLowerCase();

  const vector = computeTFIDF(text);

  const index = predict(vector);

  return modelData.classes[index];
}