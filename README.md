# 天气图像生成器（Cloudflare Worker + Gemini）

一个部署在 Cloudflare（Workers/Pages）的极简应用：输入城市，自动获取天气摘要并生成等距微缩模型风格的图像。项目采用单文件 `_worker.js` 同时提供前端页面与 `/api/weather` API。

## 功能特性
- 一体化架构：单个 `_worker.js` 同时服务静态页面与 API
- Gemini 模型：文本模型生成天气摘要，图像模型生成城市微缩模型图
- 安全防刷：
  - 必填访问口令（支持明文 TOKEN 或已加密 TOKEN_HASH）
  - 后端仅做哈希对比（SHA-256）+ 恒时序比较
  - 简单速率限制（每实例、每 IP，可配置）
  - 前端不持久化口令（刷新/关闭页面需重新输入）

## 目录结构
```
.
├── _worker.js         # Cloudflare Worker 入口（页面 + API）
├── package.json       # 脚本与依赖
├── wrangler.toml      # Wrangler 配置
└── README.md
```

## 本地开发
前置条件：Node.js 18+、Cloudflare Wrangler，以及可用的 Gemini API Key。

1) 安装依赖
```bash
npm i
```

2) 配置本地环境变量（推荐 .dev.vars，Wrangler 原生支持）
在项目根目录创建/编辑 `.dev.vars`：
```ini
# 必填：Gemini API Key
GEMINI_API_KEY=your_gemini_api_key

# 访问口令（二选一，推荐 TOKEN_HASH）
# 明文：首次启动时会被计算为 SHA-256 用于比对
TOKEN=your_plain_token
# 或直接提供十六进制哈希：
# TOKEN_HASH=sha256_hex_of_token

# 可选：速率限制（默认 10 次 / 60 秒）
# RATE_LIMIT_MAX=10
# RATE_LIMIT_WINDOW_MS=60000
```
注意：修改 `.dev.vars` 后需要重启 `wrangler dev` 才会生效。

3) 启动本地服务
```bash
npx wrangler dev --local
```
启动成功后访问：http://localhost:8787/

## 使用说明
- 页面输入“访问口令”和城市名称后点击“生成”即可
- 首次加载/刷新页面不会记住口令（不持久化）

## API 说明
- 方法与路径：GET `/api/weather?city=上海`
- 认证方式：请求头 `X-Access-Token: <你的口令>`（必填）
- 成功响应（示例）：
```json
{
  "success": true,
  "city": "上海",
  "weatherLine": "多云，28℃ ...",
  "image": "data:image/svg+xml;base64,..." // 或 PNG 的 data URI
}
```
- 失败响应：
  - 401 未授权：未配置 TOKEN/TOKEN_HASH，或口令错误/未提供
  - 429 触发限流：请稍后重试

提示：在开发模式下，控制台可能打印 `usageMetadata.totalTokenCount` 帮助估算调用 Token（用于成本评估）。

## 部署到 Cloudflare Pages
1) 部署
```bash
wrangler pages deploy . --project-name=weather-image-gen
```
2) 在 Cloudflare 控制台（或 wrangler）为对应环境配置变量：
- 必填：`GEMINI_API_KEY`、`TOKEN` 或 `TOKEN_HASH`
- 可选：`RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW_MS`

## 常见问题（FAQ）
- 访问页面即返回 401 Unauthorized: TOKEN not configured
  - 未在环境中配置 `TOKEN`/`TOKEN_HASH`。本地请在 `.dev.vars` 配置并重启 dev；线上请在 Pages/Workers 环境变量中配置。
- 明明修改了 `.dev.vars`，却没有生效
  - Wrangler 仅在启动时读取 `.dev.vars`，修改后需要重启。
- 提示 401 Unauthorized
  - 口令未提供或错误；若使用 `TOKEN_HASH`，请确保提供的口令与哈希匹配（哈希算法为 SHA-256 十六进制）。
- 提示 429 Rate limit exceeded
  - 命中内存速率限制（每实例、每 IP）。可调节 `RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW_MS`。

## 许可证
本项目用于演示与学习，按需自定许可证。