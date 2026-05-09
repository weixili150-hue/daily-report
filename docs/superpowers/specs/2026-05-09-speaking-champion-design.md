# 我是世界口活冠军 — 设计文档

## 概述

一个移动优先的英语口语学习网页工具。用户输入中文，获得地道的美式英语翻译、发音（美音/英音）、难词解析。所有查询自动保存并收藏，支持中英文搜索复习。

## 技术架构

- **后端**: 在现有 Express 服务中新增 `/api/translate` 路由，调用 DeepSeek API 做翻译
- **前端**: 单个 HTML 页面 `public/app.html`，原生 JS + CSS，无框架
- **存储**: 浏览器 localStorage（查询历史 + 自动收藏）
- **发音**: Web Speech API（`speechSynthesis`），`en-US` 和 `en-GB` 语音
- **搜索**: 前端本地过滤 localStorage，不经过后端

## 页面结构

单页应用，顶部导航切换两个 Tab：

### Tab 1: 翻译

- 输入框（textarea），支持中文输入
- 翻译按钮（或回车提交）
- 结果卡片：英文翻译（大字）+ 美音播放 + 英音播放 + 复制按钮
- 词汇解析区：难词列表，每个词附带中文解释
- （可选）语音输入按钮，调浏览器 SpeechRecognition

### Tab 2: 收藏/历史

- 顶部搜索栏，实时过滤
- 历史卡片列表：时间 + 中文原文 + 英文翻译 + 发音按钮
- 搜索高亮匹配关键词
- 无限滚动（或"加载更多"）

## API 设计

### POST /api/translate

```
请求: { "text": "这个菜怎么做？" }
响应: {
  "english": "How do you make this dish?",
  "explanations": [
    { "word": "dish", "meaning": "一道菜，比food更具体常用" }
  ]
}
错误: { "error": "翻译失败，请稍后再试" }  // HTTP 500
```

### DeepSeek Prompt

- 系统提示：翻译成简单、地道的美式日常英语，返回 JSON
- 难词标注：CEFR B1 以上词汇给出中文解释
- 输出格式严格控制为 JSON

## 数据模型（localStorage）

```js
// key: "im-speaking-champion-history"
[
  {
    id: "1705200000000",
    chinese: "这个菜怎么做？",
    english: "How do you make this dish?",
    explanations: [{ word: "dish", meaning: "一道菜" }],
    time: "2026-05-09T14:32:00"
  }
]
```

上限 500 条，超出删最旧记录。

## 错误处理

- API 调用失败 → 红色 toast 提示，输入内容不清空
- Web Speech API 不可用 → 隐藏发音按钮，不报错
- localStorage 写入失败（配额满）→ 静默删除最旧 50 条后重试
- DeepSeek 返回非 JSON → 前端容错，显示原始翻译文本

## 移动端适配

- 最大宽度 480px 居中
- 字体大小用 rem，触摸目标 ≥ 44px
- viewport meta 标签，禁止缩放
- 输入框自动聚焦时不遮挡结果区
