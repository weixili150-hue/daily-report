# 我是口语世界冠军 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first English speaking practice web app — input Chinese, get natural American English translations with pronunciation (US/UK), word explanations, and auto-saved searchable history.

**Architecture:** Add a `/api/translate` route to the existing Express server (calls DeepSeek API) and create a single-page `public/app.html` that handles all UI, Web Speech API pronunciation, and localStorage history/search on the client side.

**Tech Stack:** Node.js Express (backend), vanilla HTML/CSS/JS (frontend), DeepSeek API (translation), Web Speech API (pronunciation), localStorage (history)

---

### Task 1: Add `/api/translate` backend route

**Files:**
- Modify: `server.js` (insert route before `// ── Start ──` section)

- [ ] **Step 1: Add the translate route to server.js**

Insert the following code block immediately before the `// ── Start ──` comment (before `app.listen`):

```javascript
// ── Translate API ──
app.post("/api/translate", async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "请输入中文" });
  }

  const systemPrompt = `You are an English speaking coach for Chinese learners. Translate the given Chinese into simple, natural, everyday American English — the way a native speaker would actually say it in daily conversation. Keep it short and colloquial, not textbook English.

Also, identify any words in the translation that are above CEFR A2 level (basic vocabulary). For each such word, provide a brief Chinese explanation.

Return ONLY valid JSON, no other text, no markdown formatting:
{
  "english": "<translation>",
  "explanations": [
    { "word": "<word>", "meaning": "<Chinese explanation>" }
  ]
}

If there are no difficult words, return an empty array for explanations.`;

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY;
    const baseUrl = process.env.DEEPSEEK_API_KEY ? "https://api.deepseek.com/v1" : "https://api.anthropic.com/v1";
    const model = process.env.DEEPSEEK_API_KEY ? "deepseek-chat" : "claude-sonnet-4-6-20250501";

    const body = {
      model,
      max_tokens: 2000,
      temperature: 0.6,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.trim() }
      ]
    };

    if (process.env.DEEPSEEK_API_KEY) {
      body.thinking = { type: "enabled" };
    }

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("Translate API error:", resp.status, JSON.stringify(data).slice(0, 200));
      return res.status(500).json({ error: "翻译失败，请稍后再试" });
    }

    const content = data.choices[0].message.content.trim();
    // Parse JSON from AI response — strip markdown code fences if present
    const jsonStr = content.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const result = JSON.parse(jsonStr);

    res.json({
      english: result.english || content,
      explanations: result.explanations || []
    });
  } catch (e) {
    console.error("Translate error:", e.message);
    res.status(500).json({ error: "翻译失败，请稍后再试" });
  }
});
```

- [ ] **Step 2: Restart server and test the API**

```bash
# Kill existing server and restart
pkill -f "node server.js" 2>/dev/null; sleep 1
cd /Users/liweixi/my-todo && node server.js &
sleep 2

# Test translate API
curl -s -X POST http://localhost:3456/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"这个菜怎么做？"}' | python3 -m json.tool
```

Expected: JSON response with `english` and `explanations` fields.

- [ ] **Step 3: Commit**

```bash
cd /Users/liweixi/my-todo && git add server.js && git commit -m "feat: add /api/translate route with DeepSeek prompt"
```

---

### Task 2: Create frontend app.html — structure and styling

**Files:**
- Create: `public/app.html`

- [ ] **Step 1: Write the complete HTML file**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>我是口语世界冠军</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { font-size: 16px; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
  display: flex;
  justify-content: center;
  min-height: 100vh;
}
.app {
  width: 100%;
  max-width: 480px;
  background: #fff;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.header {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  padding: 16px 20px;
  text-align: center;
  flex-shrink: 0;
}
.header h1 { font-size: 1.2rem; font-weight: 700; }
.header p { font-size: 0.7rem; opacity: 0.8; margin-top: 2px; }

/* Tabs */
.tabs {
  display: flex;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}
.tab {
  flex: 1;
  padding: 12px;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: #999;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  -webkit-tap-highlight-color: transparent;
  min-height: 44px;
}
.tab.active { color: #667eea; border-bottom-color: #667eea; }
.tab:active { background: #f5f0ff; }

/* Page containers */
.page { display: none; flex: 1; flex-direction: column; overflow-y: auto; }
.page.active { display: flex; }

/* Translate page */
.translate-page { padding: 16px; }
.input-area { margin-bottom: 16px; }
.input-area textarea {
  width: 100%;
  min-height: 80px;
  border: 2px solid #667eea;
  border-radius: 10px;
  padding: 12px;
  font-size: 1rem;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.input-area textarea:focus { border-color: #764ba2; }
.btn-row { display: flex; gap: 8px; margin-top: 10px; }
.btn {
  padding: 11px 0;
  border: none;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  min-height: 44px;
  transition: opacity 0.2s;
  -webkit-tap-highlight-color: transparent;
}
.btn:active { opacity: 0.8; }
.btn-primary { flex: 1; background: #667eea; color: #fff; }
.btn-primary:disabled { opacity: 0.5; }
.btn-icon { padding: 11px 14px; background: #f0f0f0; color: #333; white-space: nowrap; }

/* Result card */
.result-card {
  background: #f9f9ff;
  border-radius: 10px;
  padding: 16px;
  border: 1px solid #e8e8ff;
}
.result-english {
  font-size: 1.3rem;
  font-weight: 700;
  color: #333;
  margin-bottom: 12px;
  line-height: 1.5;
}
.result-actions { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.btn-sm {
  padding: 7px 14px;
  border: none;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  min-height: 36px;
  -webkit-tap-highlight-color: transparent;
}
.btn-us { background: #27ae60; color: #fff; }
.btn-uk { background: #2980b9; color: #fff; }
.btn-copy { background: #f0f0f0; color: #555; }

/* Explanations */
.explanations {
  background: #fff8e1;
  padding: 12px;
  border-radius: 8px;
  border-left: 3px solid #f0a030;
}
.explanations h4 { font-size: 0.85rem; margin-bottom: 8px; color: #8b6914; }
.exp-item { font-size: 0.85rem; margin-bottom: 5px; line-height: 1.5; }
.exp-item b { color: #333; }

/* History page */
.history-page { padding: 0; }
.search-bar { padding: 12px 16px; border-bottom: 1px solid #eee; position: sticky; top: 0; background: #fff; z-index: 1; }
.search-bar input {
  width: 100%;
  padding: 10px 14px;
  border: 2px solid #eee;
  border-radius: 20px;
  font-size: 0.9rem;
  outline: none;
  font-family: inherit;
  min-height: 44px;
}
.search-bar input:focus { border-color: #667eea; }
.search-hint { font-size: 0.7rem; color: #999; text-align: center; margin-top: 4px; }
.history-list { flex: 1; overflow-y: auto; }
.history-count { font-size: 0.75rem; color: #999; padding: 8px 16px; }

.history-card {
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.history-time { font-size: 0.75rem; color: #aaa; margin-bottom: 4px; }
.history-chinese { font-size: 0.9rem; color: #666; margin-bottom: 4px; }
.history-english { font-size: 1.05rem; font-weight: 600; color: #333; margin-bottom: 8px; line-height: 1.4; }
.history-actions { display: flex; gap: 6px; }

mark { background: #fff3b0; padding: 0 2px; border-radius: 2px; }

/* Toast */
.toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 24px;
  border-radius: 8px;
  color: #fff;
  font-size: 0.85rem;
  z-index: 999;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.toast.show { opacity: 1; }
.toast.success { background: #27ae60; }
.toast.error { background: #e74c3c; }

/* Empty state */
.empty { text-align: center; color: #bbb; padding: 60px 20px; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>🏆 我是口语世界冠军</h1>
    <p>Speak Like a Native</p>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="switchTab('translate')">翻译</button>
    <button class="tab" onclick="switchTab('history')">收藏</button>
  </div>

  <div class="page active" id="page-translate">
    <div class="translate-page">
      <div class="input-area">
        <textarea id="inputText" placeholder="输入中文，例如：这多少钱？" rows="3"></textarea>
        <div class="btn-row">
          <button class="btn btn-primary" id="translateBtn" onclick="doTranslate()">翻译</button>
          <button class="btn btn-icon" id="voiceBtn" onclick="voiceInput()" title="语音输入">🎤</button>
        </div>
      </div>
      <div id="resultArea"></div>
    </div>
  </div>

  <div class="page" id="page-history">
    <div class="history-page">
      <div class="search-bar">
        <input type="search" id="searchInput" placeholder="搜索中文或英文..." oninput="renderHistory()">
        <div class="search-hint">支持中文搜索和英文搜索</div>
      </div>
      <div class="history-count" id="historyCount"></div>
      <div class="history-list" id="historyList"></div>
    </div>
  </div>

  <div class="toast" id="toast"></div>
</div>

<script>
// ── Globals ──
const STORAGE_KEY = "im-speaking-champion-history";
const MAX_ITEMS = 500;

// ── Toast ──
let toastTimer;
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "success") + " show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

// ── Tab switching ──
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((el, i) => {
    el.classList.toggle("active", (i === 0 && name === "translate") || (i === 1 && name === "history"));
  });
  document.querySelectorAll(".page").forEach(el => {
    el.classList.toggle("active", el.id === "page-" + name);
  });
  if (name === "history") renderHistory();
}

// ── History storage ──
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveHistory(items) {
  try {
    if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded — remove oldest 50 and retry
    const all = loadHistory();
    all.splice(-50);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {}
  }
}

function addToHistory(chinese, english, explanations) {
  const items = loadHistory();
  items.unshift({
    id: Date.now().toString(),
    chinese,
    english,
    explanations: explanations || [],
    time: new Date().toISOString()
  });
  saveHistory(items);
}

// ── Translate ──
let translating = false;

async function doTranslate() {
  const input = document.getElementById("inputText");
  const text = input.value.trim();
  if (!text) { showToast("请输入中文", "error"); return; }
  if (translating) return;

  translating = true;
  const btn = document.getElementById("translateBtn");
  btn.disabled = true;
  btn.textContent = "翻译中...";

  try {
    const resp = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await resp.json();

    if (!resp.ok) {
      showToast(data.error || "翻译失败", "error");
      return;
    }

    addToHistory(text, data.english, data.explanations);
    showResult(data.english, data.explanations);
    showToast("已自动收藏", "success");
  } catch (e) {
    showToast("网络错误，请稍后再试", "error");
  } finally {
    translating = false;
    btn.disabled = false;
    btn.textContent = "翻译";
  }
}

function showResult(english, explanations) {
  const area = document.getElementById("resultArea");
  let expHtml = "";
  if (explanations && explanations.length > 0) {
    expHtml = `
      <div class="explanations">
        <h4>📖 词汇解析</h4>
        ${explanations.map(e => `<div class="exp-item"><b>${escapeHtml(e.word)}</b> — ${escapeHtml(e.meaning)}</div>`).join("")}
      </div>`;
  }

  area.innerHTML = `
    <div class="result-card">
      <div class="result-english">${escapeHtml(english)}</div>
      <div class="result-actions">
        <button class="btn-sm btn-us" onclick="speak('${escapeAttr(english)}', 'en-US')">🇺🇸 美音</button>
        <button class="btn-sm btn-uk" onclick="speak('${escapeAttr(english)}', 'en-GB')">🇬🇧 英音</button>
        <button class="btn-sm btn-copy" onclick="copyText('${escapeAttr(english)}')">📋 复制</button>
      </div>
      ${expHtml}
    </div>`;
}

// ── Speech ──
function speak(text, lang) {
  if (!window.speechSynthesis) {
    showToast("你的浏览器不支持发音功能", "error");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.85;
  // Find a native voice
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith(lang)) || voices.find(v => v.lang.startsWith("en"));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// Preload voices
if (window.speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ── Copy ──
function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast("已复制", "success"));
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("已复制", "success");
  }
}

// ── Voice Input ──
function voiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("你的浏览器不支持语音输入", "error");
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    document.getElementById("inputText").value = text;
    showToast("语音识别完成", "success");
  };
  rec.onerror = () => showToast("语音识别失败", "error");
  rec.start();
}

// ── History rendering ──
function renderHistory() {
  const query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  let items = loadHistory();

  if (query) {
    items = items.filter(item =>
      item.chinese.includes(query) || item.english.toLowerCase().includes(query)
    );
  }

  document.getElementById("historyCount").textContent =
    query ? `搜索 "${query}" — ${items.length} 条结果` : `共 ${items.length} 条记录`;

  const list = document.getElementById("historyList");
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">暂无记录</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const time = new Date(item.time);
    const timeStr = time.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const hl = (str) => query
      ? str.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi"), "<mark>$1</mark>")
      : escapeHtml(str);

    return `
      <div class="history-card">
        <div class="history-time">${timeStr}</div>
        <div class="history-chinese">${hl(item.chinese)}</div>
        <div class="history-english">${hl(item.english)}</div>
        <div class="history-actions">
          <button class="btn-sm btn-us" onclick="speak('${escapeAttr(item.english)}', 'en-US')">🇺🇸</button>
          <button class="btn-sm btn-uk" onclick="speak('${escapeAttr(item.english)}', 'en-GB')">🇬🇧</button>
          <button class="btn-sm btn-copy" onclick="copyText('${escapeAttr(item.english)}')">📋</button>
        </div>
      </div>`;
  }).join("");
}

// ── Helpers ──
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ── Keyboard shortcut: Enter to translate ──
document.getElementById("inputText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    doTranslate();
  }
});

// Initial history load on history page if visible
renderHistory();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify page loads**

```bash
# Ensure server is running
curl -s -o /dev/null -w "%{http_code}" http://localhost:3456/app.html
```

Expected: `200`

- [ ] **Step 3: Open in browser and verify responsiveness**

```bash
open http://localhost:3456/app.html
```

Verify: page loads, two tabs visible, gradient header, input area styled. Use browser dev tools responsive mode to check mobile layout.

- [ ] **Step 4: Commit**

```bash
cd /Users/liweixi/my-todo && git add public/app.html && git commit -m "feat: add speaking champion frontend — translate, speech, history, search"
```

---

### Task 3: End-to-end test and polish

**Files:**
- No new files

- [ ] **Step 1: Test translate flow end-to-end**

```bash
# Test backend API directly
curl -s -X POST http://localhost:3456/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，请问这个多少钱？"}' | python3 -m json.tool
```

Expected: `{ "english": "...", "explanations": [...] }`

- [ ] **Step 2: Test frontend in browser**

Open http://localhost:3456/app.html and:

1. Type Chinese text, click "翻译" — verify result appears with pronunciation buttons
2. Click 🇺🇸 美音 — verify English speech plays
3. Click 🇬🇧 英音 — verify different accent speech plays
4. Click 📋 复制 — verify text copied to clipboard
5. Switch to "收藏" tab — verify the translation appears in history list
6. Type in search box — verify both Chinese and English search work with highlighting
7. Test on a real phone — open http://<your-ip>:3456/app.html

- [ ] **Step 3: Commit**

```bash
cd /Users/liweixi/my-todo && git add -A && git commit -m "feat: end-to-end test — speaking champion app complete"
```
