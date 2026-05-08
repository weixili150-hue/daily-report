const express = require("express");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3456;
const PROJECT_DIR = __dirname;
const EMAIL_CONFIG_FILE = path.join(__dirname, ".email-config.json");

const AI_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY;
const AI_BASE_URL = process.env.DEEPSEEK_API_KEY ? "https://api.deepseek.com/v1" : "https://api.anthropic.com/v1";
const AI_MODEL = process.env.DEEPSEEK_API_KEY ? "deepseek-chat" : "claude-sonnet-4-6-20250501";

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── Email Config ──
function loadEmailConfig() {
  // Priority: env vars (for cloud deployment), then config file (local)
  if (process.env.EMAIL_USER) {
    return {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
      to: process.env.EMAIL_TO,
      host: process.env.EMAIL_HOST || "smtp.163.com",
      port: parseInt(process.env.EMAIL_PORT) || 465,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(EMAIL_CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveEmailConfig(cfg) {
  fs.writeFileSync(EMAIL_CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function sendEmail(report) {
  const cfg = loadEmailConfig();
  if (!cfg || !cfg.to) {
    console.log("📧 未配置邮件，跳过发送");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host || "smtp.gmail.com",
    port: cfg.port || 587,
    secure: cfg.secure !== undefined ? cfg.secure : (cfg.port === 465),
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const date = new Date().toISOString().slice(0, 10);
  await transporter.sendMail({
    from: cfg.user,
    to: cfg.to,
    subject: `每日工作总结 — ${date}`,
    text: report,
  });

  console.log(`📧 报告已发送至 ${cfg.to}`);
}

// ── Auto-commit at 21:55 daily ──
function autoCommit() {
  try {
    const status = run("git status --porcelain 2>/dev/null");
    if (!status) { console.log("📦 无变更，跳过自动提交"); return; }

    run("git add -A 2>/dev/null");
    const date = new Date().toISOString().slice(0, 10);
    run(`git commit -m "自动提交 — ${date}" 2>/dev/null`);
    console.log(`📦 自动提交完成：${date}`);
  } catch (e) {
    console.error("自动提交失败：", e.message);
  }
}

function scheduleAutoCommit() {
  const now = new Date();
  const t = new Date(now);
  t.setHours(21, 55, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);

  const ms = t - now;
  console.log(`📦 下次自动提交：${t.toLocaleString("zh-CN")}`);
  setTimeout(() => {
    autoCommit();
    scheduleAutoCommit();
  }, ms);
}

// ── Cache ──
const CACHE_FILE = path.join(__dirname, "data", "latest-report.txt");
const cache = loadCache();

function loadCache() {
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (d.date && d.text) return { date: d.date, text: d.text, updating: false };
  } catch {}
  // 回退到仓库中的纯文本报告（随代码部署自带）
  const textFile = path.join(__dirname, "data", "latest-report.txt");
  try {
    const text = fs.readFileSync(textFile, "utf8").trim();
    const today = new Date().toISOString().slice(0, 10);
    if (text && text.includes(today)) return { date: today, text, updating: false };
  } catch {}
  return { date: "", text: "", updating: false };
}

function saveCache() {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ date: cache.date, text: cache.text }), "utf8");
  // Also write plain text version committed to repo
  const textFile = path.join(__dirname, "data", "latest-report.txt");
  fs.writeFileSync(textFile, cache.text, "utf8");
}

async function refreshCache() {
  const today = new Date().toISOString().slice(0, 10);

  // 已有高质量报告 → 直接发邮件，不重新生成
  if (cache.date === today && cache.text && !cache.text.includes("AI 报告生成失败")) {
    console.log(`📝 报告已存在，直接发送邮件：${today}`);
    await sendEmail(cache.text);
    return;
  }

  cache.updating = true;
  try {
    cache.text = await generateTextReport(today);
    cache.date = today;
    saveCache();
    console.log(`📝 报告已更新：${today}`);
    await sendEmail(cache.text);
  } catch (e) {
    console.error("缓存更新失败：", e.message);
  } finally {
    cache.updating = false;
  }
}

// ── Scheduler ──
let nextTarget = null;

function getNextTarget() {
  const now = new Date();
  const t = new Date(now);
  t.setHours(22, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}

function scheduleNext() {
  nextTarget = getNextTarget();
  const ms = nextTarget - new Date();
  console.log(`⏰ 下次自动更新：${nextTarget.toLocaleString("zh-CN")}`);
  setTimeout(() => {
    refreshCache();
    scheduleNext();
  }, ms);
}

// ── Helpers ──
function run(cmd) {
  try {
    return execSync(cmd, { cwd: PROJECT_DIR, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function getDateRange(date) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    sinceArg: date === today ? "today 00:00" : `${date}T00:00:00`,
    untilArg: `${date}T23:59:59`,
    isToday: date === today,
  };
}

function getProjectContext() {
  const tree = run(
    "find . -not -path './node_modules/*' -not -path './.git/*' -not -name '.DS_Store' | sort 2>/dev/null"
  );
  const pkg = run("cat package.json 2>/dev/null | head -20");
  return [
    "# 项目文件结构",
    tree || "（空目录）",
    "",
    pkg ? `# package.json\n${pkg}` : "",
  ].filter(Boolean).join("\n");
}

async function generateTextReport(date) {
  const { sinceArg, untilArg, isToday } = getDateRange(date);

  const commitsRaw = run(
    `git log --since="${sinceArg}" --until="${untilArg}" --format="%h %s（%an %ad）" --date=format:"%H:%M" 2>/dev/null`
  );
  const diffStat = run(
    `git log --since="${sinceArg}" --until="${untilArg}" --stat --format="" 2>/dev/null | tail -30`
  );
  const filesRaw = run(
    `git log --since="${sinceArg}" --until="${untilArg}" --name-only --format="" 2>/dev/null`
  );
  const files = filesRaw ? [...new Set(filesRaw.split("\n").filter(Boolean))] : [];
  const branch = run("git branch --show-current 2>/dev/null") || "unknown";
  const statusRaw = isToday ? run("git status --short 2>/dev/null") : "";

  // Read daily notes (non-code work tracking)
  let dailyNotes = "";
  try { dailyNotes = fs.readFileSync(getNotesFile(date), "utf8"); } catch {}

  const dataContext = [
    `日期：${date}`,
    `分支：${branch}`,
    `今天：${isToday ? "是" : "否（历史记录）"}`,
    "",
    dailyNotes ? `# 今日手动记录（非代码工作）\n${dailyNotes}` : "",
    "",
    commitsRaw ? `# Git 提交记录\n${commitsRaw}` : "# Git 提交记录\n（无提交）",
    "",
    diffStat ? `# 代码变更量\n${diffStat}` : "",
    "",
    files.length > 0 ? `# 涉及文件\n${files.join("\n")}` : "",
    "",
    isToday && statusRaw ? `# 未提交的变更\n${statusRaw}` : "",
    "",
    getProjectContext(),
  ].join("\n");

  try {
    const systemPrompt = `你是一个资深程序员，每天下班前写工作日报。你要根据提供的 git 数据生成一份准确、详细的中文日报。

核心原则：
1. 仔细阅读每条 commit message，理解其中的技术含义，用自己的话重写
2. 结合文件结构和文件名，推断项目的整体架构和今天做的工作
3. 把技术细节翻译成通俗语言，但保留关键术语（如 Express、API、SMTP 等）
4. 细节要丰富，不要一笔带过。比如"搭建了Web应用"不够，要写"用Express搭建了后端服务，包含报告生成、邮件发送、自动提交等功能"
5. 不要胡编乱造，只根据提供的数据来描述
6. 如果今天没有任何提交，但有很多未提交的变更，根据文件名推断正在做的工作

严格按以下格式输出（不要加任何开场白、结尾语、引号或代码块标记，使用 ## 二级标题）：

日期：<日期>  <分支名>

## 今日完成
- <具体、详细的工作描述，每项一行>
- <如果今天没有提交但有未提交变更，根据文件名推断描述>
- <如果完全没有活动，写"今日暂无工作记录">

## 备注
- <需要关注的事项，如未提交的文件数量、建议等>
- <如果一切正常，写"无特别事项">`;

    const body = { model: AI_MODEL, max_tokens: 1000, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: dataContext }] };
    // DeepSeek 思考模式：提升报告质量
    if (process.env.DEEPSEEK_API_KEY) {
      body.thinking = { type: "enabled" };
    }

    const resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AI_API_KEY}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`${resp.status} ${JSON.stringify(data)}`);
        return data.choices[0].message.content;
  } catch (e) {
    console.error("AI 报告生成失败：", e.message);
    return `日期：${date}  ${branch}

## 今日完成
- ${commitsRaw ? commitsRaw.split("\n").length + " 个提交（详见下方原始记录）" : ""}${!commitsRaw && statusRaw ? "有未提交的变更（见备注）" : ""}${!commitsRaw && !statusRaw && !dailyNotes ? "今日暂无工作记录" : ""}
${dailyNotes ? "- " + dailyNotes.split("\n").filter(Boolean).join("\n- ") : ""}

## 备注
- AI 报告生成失败：${e.message}
${statusRaw ? "- 未提交的变更：\n" + statusRaw.split("\n").slice(0, 10).map(l => "  " + l).join("\n") : ""}`;
  }
}

// ── API ──
app.get("/api/report", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { sinceArg, untilArg, isToday } = getDateRange(date);

  const commitsRaw = run(
    `git log --since="${sinceArg}" --until="${untilArg}" --format="%h|%s|%an|%ad" --date=format:"%H:%M" 2>/dev/null`
  );
  const commits = commitsRaw
    ? commitsRaw.split("\n").map((line) => {
        const [hash, message, author, time] = line.split("|");
        return { hash, message, author, time };
      })
    : [];

  const files = run(
    `git log --since="${sinceArg}" --until="${untilArg}" --name-only --format="" 2>/dev/null`
  ).split("\n").filter(Boolean).filter((f, i, arr) => arr.indexOf(f) === i);

  const branch = run("git branch --show-current 2>/dev/null") || "unknown";
  const statusRaw = run("git status --short 2>/dev/null");
  const changes = isToday
    ? statusRaw.split("\n").filter(Boolean).map((line) => {
        const s = line.slice(0, 2).trim();
        const f = line.slice(3);
        const type = s === "??" ? "new" : s.startsWith("M") ? "modified" : s.startsWith("D") ? "deleted" : "changed";
        return { file: f, type };
      })
    : [];

  res.json({ date, branch, commits, files, changes, stats: { totalCommits: commits.length, totalFiles: files.length } });
});

app.get("/api/report/text", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // /daily-report 推送的报告 → 直接使用（保证和终端输出一致）
    if (date === today && cache.text && cache.date === today) {
      return res.type("text/plain; charset=utf-8").send(cache.text);
    }

    // 今天还没有推送 → 不自动生成，保证质量
    if (date === today) {
      return res.type("text/plain; charset=utf-8").send(`日期：${today}  —

## 今日完成
- 请运行 /daily-report 命令生成今日报告

## 备注
- 网页端只展示 /daily-report 推送的内容，以确保报告质量`);
    }

    // 历史日期 → 只能自动生成
    const report = await generateTextReport(date);
    res.type("text/plain; charset=utf-8").send(report);
  } catch (err) {
    console.error("报告生成失败：", err.message);
    res.status(500).send("报告生成失败：" + err.message);
  }
});

// Manual report override: when the skill pushes a report, use it instead of AI-generated
app.post("/api/report/text", express.text({ type: "text/plain" }), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  cache.text = req.body;
  cache.date = today;
  saveCache();
  console.log(`📝 手动报告已保存：${today}`);
  res.json({ ok: true, date: cache.date });
});

app.post("/api/report/refresh", async (req, res) => {
  cache.text = "";
  await refreshCache();
  res.json({ ok: true, date: cache.date });
});

// ── Notes API ──
const NOTES_DIR = path.join(__dirname, "notes");
function getNotesFile(date) { return path.join(NOTES_DIR, `${date}.md`); }

app.get("/api/notes", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const content = fs.readFileSync(getNotesFile(date), "utf8");
    res.type("text/plain; charset=utf-8").send(content);
  } catch {
    res.type("text/plain; charset=utf-8").send("");
  }
});

app.post("/api/notes", express.text({ type: "text/plain" }), (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  try {
    if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
    fs.writeFileSync(getNotesFile(date), req.body, "utf8");
    res.json({ ok: true, date });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dates", (req, res) => {
  const datesRaw = run(`git log --format="%ad" --date=format:"%Y-%m-%d" 2>/dev/null`);
  const dates = datesRaw ? [...new Set(datesRaw.split("\n").filter(Boolean))] : [new Date().toISOString().slice(0, 10)];
  res.json(dates);
});

app.get("/api/next-refresh", (req, res) => {
  const t = getNextTarget();
  res.json({ next: t.toISOString(), label: t.toLocaleString("zh-CN") });
});

// ── Email Config API ──
app.get("/api/email-config", (req, res) => {
  const cfg = loadEmailConfig();
  res.json(cfg ? { configured: true, to: cfg.to, user: cfg.user } : { configured: false });
});

app.post("/api/email-config", (req, res) => {
  const { user, pass, to, host, port } = req.body;
  if (!user || !pass || !to) {
    return res.status(400).json({ error: "缺少 user、pass 或 to 参数" });
  }
  saveEmailConfig({ user, pass, to, host: host || "smtp.163.com", port: port || 465 });
  res.json({ ok: true });
});

app.post("/api/email-test", async (req, res) => {
  try {
    await sendEmail("这是一封测试邮件，如果你收到说明邮件配置成功。");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──
app.listen(PORT, "0.0.0.0", () => {
  console.log(`📊 每日总结已启动 → http://localhost:${PORT}`);
  // 不在启动时自动生成报告（云端部署重启会清空已推送的报告）
  scheduleAutoCommit();
  scheduleNext();
});
