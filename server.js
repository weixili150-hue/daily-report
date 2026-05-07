const express = require("express");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3456;
const PROJECT_DIR = __dirname;
const EMAIL_CONFIG_FILE = path.join(__dirname, ".email-config.json");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── Email Config ──
function loadEmailConfig() {
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

// ── Cache ──
const cache = { date: "", text: "", updating: false };

async function refreshCache() {
  const today = new Date().toISOString().slice(0, 10);
  if (cache.date === today && cache.text) return;

  cache.updating = true;
  try {
    cache.text = await generateTextReport(today);
    cache.date = today;
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
  const filesRaw = run(
    `git log --since="${sinceArg}" --until="${untilArg}" --name-only --format="" 2>/dev/null`
  );
  const files = filesRaw ? [...new Set(filesRaw.split("\n").filter(Boolean))] : [];
  const branch = run("git branch --show-current 2>/dev/null") || "unknown";
  const statusRaw = isToday ? run("git status --short 2>/dev/null") : "";

  const dataContext = [
    `日期：${date}`,
    `分支：${branch}`,
    "",
    commitsRaw ? `# Git 提交\n${commitsRaw}` : "# Git 提交\n（无）",
    "",
    files.length > 0 ? `# 提交中涉及的文件\n${files.join("\n")}` : "",
    "",
    isToday && statusRaw ? `# 还没提交的文件\n${statusRaw}` : "",
    "",
    getProjectContext(),
  ].join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6-20250501",
    max_tokens: 800,
    system: `你是一个工作日报助手。根据 git 数据生成简洁的中文日报。

关键要求：
- 分析项目文件结构和文件名，推断今天实际做了什么，不要复述 commit 原文
- 用通俗易懂的语言描述，让非技术人员也能看懂
- 备注里需要关注的事项写清楚，但不要冗长

严格按以下格式输出：
日期：<日期>  <分支>

## 今日完成
- <用大白话描述今天做了什么>

## 备注
- <需要关注的事项>`,
    messages: [{ role: "user", content: dataContext }],
  });

  return msg.content[0].text;
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

    if (date === today) {
      if (!cache.text) await refreshCache();
      return res.type("text/plain; charset=utf-8").send(cache.text);
    }

    const report = await generateTextReport(date);
    res.type("text/plain; charset=utf-8").send(report);
  } catch (err) {
    console.error("报告生成失败：", err.message);
    res.status(500).send("报告生成失败：" + err.message);
  }
});

app.post("/api/report/refresh", async (req, res) => {
  cache.text = "";
  await refreshCache();
  res.json({ ok: true, date: cache.date });
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
  refreshCache();
  scheduleNext();
});
