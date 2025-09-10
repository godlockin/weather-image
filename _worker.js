// Synthesis Prime - Complete & Refactored Cloudflare Worker
// Architecture: Modular, Data-Driven, Composition over Generation
// Deployed: This single file contains the UI, API, and all necessary logic.

// --- Configuration & Constants ---
const CONFIG = {
  ADSENSE: {
    DEFAULT_CLIENT_ID: 'ca-pub-7369080645100200',
    SELLER_ACCOUNT_ID: 'f08c47fec0942fa0'
  },
  CACHE: {
    WEATHER_TTL: 60 * 60 * 1000, // 60 minutes
    LANDMARK_TTL: 24 * 60 * 60 * 1000, // 24 hours
    MAX_SIZE: 100
  },
  NETWORK: {
    RETRIES: 3,
    TIMEOUT: 12000,
    BACKOFF_BASE: 400
  },
  RATE_LIMIT: {
    WINDOW_MS: 1000, // 1 second window
    MAX_REQUESTS: 5, // 5 req/s per IP
    CLEANUP_INTERVAL: 5 * 60 * 1000 // 5 minutes
  },
  IMAGE: {
    WIDTH: 1280,
    HEIGHT: 720,
    HEADER_HEIGHT: 88
  }
};

// --- Memory Cache Implementation (优化版) ---
class MemoryCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }
    
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, item);
    this.stats.hits++;
    return item.value;
  }
  
  set(key, value, ttl) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }
    
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }
  
  clear() {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
  
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, item] of this.cache) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
  
  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
    };
  }
}

// Global cache instances
const weatherCache = new MemoryCache(CONFIG.CACHE.MAX_SIZE);
const landmarkCache = new MemoryCache(CONFIG.CACHE.MAX_SIZE);

// ===================================================================================
// --- 1. 核心业务逻辑 (Core Business Logic) ---
// 职责：编排所有服务，实现从城市名称到最终天气图像的核心价值流。
// ===================================================================================

async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const city = validateCityName(url.searchParams.get('city') || '上海');
  
  // 步骤 1: 获取精准、结构化的实时天气数据（带缓存）
  const weatherData = await getRealtimeWeatherWithCache(city);
  if (!weatherData) {
    const fallbackSvg = svgImageStrict(city, 'Weather data unavailable');
    return buildJsonResponse({ success: true, city, image: fallbackSvg, usedFallback: true, usedFallbackReason: 'weather_api_failed' });
  }

  const { zhLine, enHeader } = weatherData;

  // 如果没有API Key，直接返回包含天气信息的回退SVG
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallbackSvg = svgImageStrict(city, enHeader);
    return buildJsonResponse({ success: true, city, weatherLine: zhLine, image: fallbackSvg, usedFallback: true, usedFallbackReason: 'no_api_key' });
  }

  try {
    // 步骤 2: 调用LLM，仅获取结构化的地标数据（带缓存）
    const landmarks = await getLandmarksFromLLMWithCache(city, apiKey, env.TEXT_MODEL);

    // 步骤 3: 构建纯图像生成Prompt (责任单一)
    const imagePrompt = buildImagePromptStrict(city, enHeader, landmarks.join(', '));
    
    // 步骤 4: 调用图像模型生成纯图像 (无文字)
    const pngDataUri = await generateImageFromLLM(imagePrompt, apiKey, env.IMAGE_MODEL);

    // 步骤 5: 服务端进行SVG组合，精确添加标题 (组合优于生成)
    const finalImage = wrapWithHeaderSVG(pngDataUri, enHeader, city);

    return buildJsonResponse({ success: true, city, weatherLine: zhLine, image: finalImage });

  } catch (e) {
    console.error(`Core logic failed for city "${city}":`, e);
    // 任何步骤失败，都回退到带天气信息的SVG
    const fallbackSvg = svgImageStrict(city, enHeader);
    return buildJsonResponse({ success: true, city, weatherLine: zhLine, image: fallbackSvg, usedFallback: true, usedFallbackReason: e.message || 'llm_or_processing_error' });
  }
}

// ===================================================================================
// --- 2. 服务客户端 (Service Clients) ---
// 职责：封装与外部API的交互，使其可复用、可替换。
// ===================================================================================

/**
 * [优化] 带缓存的LLM地标获取
 */
async function getLandmarksFromLLMWithCache(city, apiKey, modelName = 'gemini-1.5-flash') {
  const cacheKey = `landmarks:${city}:${modelName}`;
  const cached = landmarkCache.get(cacheKey);
  if (cached) return cached;

  const landmarks = await getLandmarksFromLLM(city, apiKey, modelName);
  landmarkCache.set(cacheKey, landmarks, CONFIG.CACHE.LANDMARK_TTL);
  return landmarks;
}

/**
 * [优化] 带缓存的天气数据获取
 */
async function getRealtimeWeatherWithCache(city) {
  const cacheKey = `weather:${city}`;
  const cached = weatherCache.get(cacheKey);
  if (cached) return cached;

  const weatherData = await getRealtimeWeather(city);
  if (weatherData) {
    weatherCache.set(cacheKey, weatherData, CONFIG.CACHE.WEATHER_TTL);
  }
  return weatherData;
}

/**
 * [重构] 调用LLM，以获取结构化的地标列表
 */
async function getLandmarksFromLLM(city, apiKey, modelName = 'gemini-1.5-flash') {
  const prompt = `You are a helpful assistant. Your task is to identify 1-2 iconic, visually distinct landmarks for the city "${city}".
RULES:
1. Return ONLY a single, valid JSON array of strings.
2. Do not include any other text, explanations, or markdown.
EXAMPLE for "Paris": ["Eiffel Tower", "Louvre Museum"]

Provide the JSON array for "${city}".`;

  try {
    const model = modelName;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    const r = await fetchWithRetry(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    if (!r.ok) throw new Error(`Landmark API ${r.status}`);
    const j = await r.json();
    const textResponse = j?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const cleanedText = textResponse.trim().replace(/^```json\s*|```\s*$/g, '');
    const landmarks = JSON.parse(cleanedText);
    return Array.isArray(landmarks) && landmarks.length > 0 ? landmarks : [`Iconic landmark of ${city}`];
  } catch (e) {
    console.warn(`Landmark LLM failed for "${city}", falling back. Error:`, e);
    return [`Iconic landmark of ${city}`]; // 提供稳健的回退
  }
}

/**
 * [重构] 图像生成客户端
 */
async function generateImageFromLLM(prompt, apiKey, modelName = 'gemini-1.5-flash-image-preview') {
    const model = modelName;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [{ role:'user', parts:[{ text: prompt }]}]
    };
    const r = await fetch(endpoint, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    });
  
    if(!r.ok){
      const errText = await r.text().catch(()=> '');
      throw new Error(`Image API ${r.status} ${errText}`);
    }
    const j = await r.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p=>p.inlineData && p.inlineData.data);
    const data = imgPart?.inlineData?.data;
    if(!data){
      console.log('generateImageFromLLM: no inlineData in parts', JSON.stringify(j).slice(0, 500));
      throw new Error('no_inline_image_data');
    }
    return 'data:image/png;base64,' + data;
}

/**
 * [优化] 天气API客户端 - 并发请求优化
 */
async function getRealtimeWeather(city) {
  try {
    // Smart geocoding to better support Chinese municipalities (e.g., 重庆、天津)
    const location = await geocodeCitySmart(city);
    if (!location) return null;

    const { latitude, longitude, name } = location;

    // Step 2: Get weather data in parallel with other requests if needed
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    const weatherResponse = await fetchWithRetry(weatherUrl);
    if (!weatherResponse.ok) throw new Error('wx');

    const weatherData = await weatherResponse.json();

    // Process weather data
    const currentTemp = weatherData?.current?.temperature_2m;
    const weatherCode = weatherData?.current?.weather_code;
    const maxTemp = Array.isArray(weatherData?.daily?.temperature_2m_max) ? weatherData.daily.temperature_2m_max[0] : undefined;
    const minTemp = Array.isArray(weatherData?.daily?.temperature_2m_min) ? weatherData.daily.temperature_2m_min[0] : undefined;

    // Generate text descriptions
    const zhWeather = weatherCodeText(weatherCode);
    const zhLine = (typeof currentTemp === 'number' && zhWeather) 
      ? `${name || city} ${zhWeather}，${Math.round(currentTemp)}°C` 
      : null;

    const enWeather = weatherCodeTextEn(weatherCode);
    const icon = weatherCodeIcon(weatherCode);

    // Build English header
    let enHeader;
    if (typeof maxTemp === 'number' && typeof minTemp === 'number') {
      enHeader = `${enWeather}, ${Math.round(minTemp)}~${Math.round(maxTemp)}°C, ${icon}`;
    } else if (typeof currentTemp === 'number') {
      enHeader = `${enWeather}, ${Math.round(currentTemp)}°C, ${icon}`;
    } else {
      enHeader = `${enWeather}, ${icon}`;
    }

    return { 
      zhLine, 
      enHeader, 
      code: weatherCode, 
      name, 
      tCur: currentTemp, 
      tMax: maxTemp, 
      tMin: minTemp 
    };

  } catch (error) { 
    console.error('getRealtimeWeather failed:', city, error);
    return null;
  }
}

// ===================================================================================
// --- 3. 模板与生成器 (Templates & Generators) ---
// 职责：负责内容（Prompt、SVG、HTML）的生成，与业务逻辑分离。
// ===================================================================================

/**
 * [重构] 图像生成Prompt (移除所有关于文字渲染的指令)
 */
function buildImagePromptStrict(city, enHeader, landmarksZh) {
  const weatherEffect = (enHeader||'').split(',')[0].trim();
  const lm = (landmarksZh||'').trim();
  return `An isometric diorama of ${city}, featuring its iconic landmarks: ${lm}.
The scene is presented as a beautifully crafted, detailed miniature model.
The lighting and atmosphere realistically match the day's weather: ${weatherEffect}.
Rendered with Physical-Based Rendering (PBR) for photorealistic materials and soft, layered lighting.
The background is a clean, solid neutral color to emphasize the model.
A clear 45-degree top-down view, centered on the main architectural elements.
Material details are crucial: reflections on glass facades, textures of metal and stone.
STRICTLY NO TEXT, NO CHARACTERS, NO PEOPLE. Focus only on the architectural scene.`;
}

/**
 * [优化] SVG文本工具函数
 */
function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * [优化] 动态字体大小计算器
 */
function calculateFontSize(text, baseSize = 48, maxSize = 55) {
  const length = text.length;
  if (length > maxSize) return 30;
  if (length > 40) return 36;
  return baseSize;
}

/**
 * [重构] 服务端SVG组合函数，用于精确添加标题（优化版）
 */
function wrapWithHeaderSVG(pngDataUri, enHeader, city) {
  const { WIDTH: w, HEIGHT: h } = CONFIG.IMAGE;
  const title = `${city}: ${enHeader}`;
  const fontSize = calculateFontSize(title);
  
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
    <defs>
      <filter id='textOutline' x='-2%' y='-2%' width='104%' height='104%'>
        <feMorphology in='SourceAlpha' operator='dilate' radius='4'/>
        <feGaussianBlur stdDeviation='2' result='blur'/>
        <feFlood flood-color='#000000' flood-opacity='0.8' result='glow'/>
        <feComposite in='glow' in2='blur' operator='in'/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in='SourceGraphic'/>
        </feMerge>
      </filter>
    </defs>
    
    <style>
      .title {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-size: ${fontSize}px;
        font-weight: 600;
        fill: #ffffff;
        text-anchor: middle;
        dominant-baseline: middle;
        filter: url(#textOutline);
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        letter-spacing: -0.5px;
      }
    </style>
    
    <image x='0' y='0' width='${w}' height='${h}' preserveAspectRatio='xMidYMid slice' href='${escapeXml(pngDataUri)}'/>
    <text x='50%' y='70' class='title'>${escapeXml(title)}</text>
  </svg>`;
  
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * [优化] 生成回退图像的SVG函数
 */
function svgImageStrict(city, enHeader) {
  const { WIDTH: w, HEIGHT: h, HEADER_HEIGHT: headH } = CONFIG.IMAGE;
  const fg = '#333';
  const accent = '#667eea';
  const bodyY = headH + 40;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="g" x1="0" x2="1">
        <stop offset="0" stop-color="#eef2ff"/>
        <stop offset="1" stop-color="#fafaff"/>
      </linearGradient>
    </defs>
    
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect x="0" y="0" width="100%" height="${headH}" fill="#f7f7fb"/>
    <text x="50%" y="56" text-anchor="middle" fill="#111" 
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" 
          font-size="28" font-weight="600">${escapeXml(enHeader || 'Weather')}</text>
    
    <rect x="40" y="${bodyY}" rx="18" ry="18" width="${w-80}" height="${h-headH-80}" 
          fill="url(#g)" stroke="#e5e7ff"/>
    
    <g transform="translate(180, ${bodyY + 160})">
      <circle cx="0" cy="0" r="60" fill="#ffd166" opacity="0.9"/>
    </g>
    
    <g transform="translate(280, ${bodyY + 200})">
      <rect x="0" y="-120" width="100" height="120" fill="#c8d0ff"/>
      <rect x="22" y="-100" width="16" height="80" fill="#fff" opacity=".6"/>
      <rect x="62" y="-100" width="16" height="80" fill="#fff" opacity=".6"/>
    </g>
    
    <text x="50%" y="${h - 110}" text-anchor="middle" fill="${fg}" 
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" 
          font-size="34" font-weight="600">${escapeXml(city)}</text>
    
    <text x="50%" y="${h - 70}" text-anchor="middle" fill="${accent}" 
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" 
          font-size="24">Image generation failed. This is a fallback.</text>
  </svg>`;
  
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * [优化] HTML样式生成器
 */
function generateStyles() {
  return `
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      margin: 0;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      max-width: 680px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0,0,0,.15);
    }
    h1 {
      margin: 0 0 16px;
      color: #333;
    }
    .row {
      display: flex;
      gap: 8px;
      margin: 12px 0;
    }
    input {
      flex: 1;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 10px;
      font-size: 16px;
    }
    button {
      padding: 12px 18px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      opacity: 0.9;
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .hint {
      color: #666;
      margin: 8px 0 16px;
      font-size: 14px;
    }
    .err {
      display: none;
      margin-top: 12px;
      background: #fee;
      color: #c33;
      padding: 10px;
      border-radius: 8px;
    }
    .err.active {
      display: block;
    }
    .res {
      display: none;
      margin-top: 16px;
    }
    .res.active {
      display: block;
    }
    .meta {
      color: #666;
      margin: 6px 0;
    }
    img {
      max-width: 100%;
      border-radius: 12px;
      box-shadow: 0 6px 18px rgba(0,0,0,.12);
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(255,255,255,.75);
      backdrop-filter: saturate(120%) blur(2px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }
    .overlay.active {
      display: flex;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 4px solid #dbe2ff;
      border-top-color: #667eea;
      animation: spin 1s linear infinite;
      box-shadow: 0 2px 8px rgba(0,0,0,.12);
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .ads-floating {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 100;
      opacity: 0.98;
    }
    @media (max-width: 420px) {
      .ads-floating ins {
        width: 280px !important;
        height: 50px !important;
      }
    }
  `;
}

/**
 * [优化] JavaScript代码生成器
 */
function generateJavaScript() {
  return `
    const tokenInput = document.getElementById('token');
    const cityInput = document.getElementById('city');
    const goBtn = document.getElementById('go');
    const err = document.getElementById('err');
    const res = document.getElementById('res');
    const cityName = document.getElementById('cityName');
    const weather = document.getElementById('weather');
    const img = document.getElementById('img');
    const loading = document.getElementById('loading');
    
    async function generate() {
      err.classList.remove('active');
      res.classList.remove('active');
      goBtn.disabled = true;
      loading.classList.add('active');
      
      try {
        const token = (tokenInput.value || '').trim();
        if (!token) {
          throw new Error('需要访问口令');
        }
        
        const city = cityInput.value.trim();
        const url = '/api/weather' + (city ? '?city=' + encodeURIComponent(city) : '');
        
        const response = await fetch(url, {
          headers: { 'X-Access-Token': token }
        });
        
        const data = await response.json();
        
        if (response.status === 401) throw new Error('口令无效或未提供');
        if (response.status === 429) throw new Error('Rate limit exceeded');
        if (!response.ok || !data || !data.success) {
          throw new Error(data && data.error || '请求失败');
        }
        
        cityName.textContent = '城市：' + (data.city || '未知');
        weather.textContent = '天气：' + (data.weatherLine || '');
        img.src = data.image;
        res.classList.add('active');
        
      } catch (e) {
        console.error(e);
        err.textContent = '生成失败：' + e.message;
        err.classList.add('active');
      } finally {
        loading.classList.remove('active');
        goBtn.disabled = false;
      }
    }
    
    goBtn.addEventListener('click', generate);
    
    // Enter key support
    cityInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') generate();
    });
    
    tokenInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') generate();
    });
  `;
}

/**
 * [优化] HTML主体结构生成器
 */
function generateHTMLBody(adsClient, adsenseEnabled) {
  const headAdsScript = adsenseEnabled 
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}" crossorigin="anonymous"><\/script>` 
    : '';
    
  const bodyFloatingAd = adsenseEnabled 
    ? `<div class="ads-floating"><ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" data-ad-client="${adsClient}" data-ad-slot="1233673426"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});<\/script></div>` 
    : '';
  
  return `
    <div class="card">
      <h1>🌤️ 天气图像生成器</h1>
      <div class="hint">输入城市（如：上海/北京），将生成包含地标的天气图像</div>
      
      <div class="row">
        <input id="token" placeholder="输入访问口令（必填）" type="password" autocomplete="off"/>
      </div>
      
      <div class="row">
        <input id="city" placeholder="输入城市名称"/>
        <button id="go">生成</button>
      </div>
      
      <div class="err" id="err">生成失败，请重试</div>
      
      <div class="res" id="res">
        <div class="meta" id="cityName"></div>
        <div class="meta" id="weather"></div>
        <img id="img" alt="天气图像"/>
      </div>
    </div>
    
    <div class="overlay" id="loading">
      <div class="spinner"></div>
    </div>
    
    ${bodyFloatingAd}
  `;
}

/**
 * [保留] 用于渲染前端界面的HTML函数（重构版）
 */
function renderIndexHtml(env) {
  const adsenseEnabled = String(env.ADSENSE_ENABLED || '').toLowerCase() === 'true';
  const adsClient = getAdsClientId(env);
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>天气图像生成器</title>
  ${adsenseEnabled ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}" crossorigin="anonymous"></script>` : ''}
  <style>${generateStyles()}</style>
</head>
<body>
  ${generateHTMLBody(adsClient, adsenseEnabled)}
  <script>${generateJavaScript()}</script>
</body>
</html>`;
}


// ===================================================================================
// --- 4. 基础设施与安全 (Infrastructure & Security) ---
// 职责：提供通用能力，如网络、认证、限流、数据转换等。
// ===================================================================================

// --- AdSense Helpers (优化版) ---
function getAdsClientId(env) {
  return (env.ADSENSE_CLIENT_ID || CONFIG.ADSENSE.DEFAULT_CLIENT_ID).trim();
}

function getAdsPubId(env) {
  const explicit = (env.ADSENSE_PUB_ID || '').trim();
  if (explicit) return explicit.startsWith('pub-') ? explicit : `pub-${explicit}`;
  
  const client = getAdsClientId(env);
  const pubMatch = client.match(/(?:^|-)pub-(\d+)$/);
  if (pubMatch) return `pub-${pubMatch[1]}`;
  
  const fallbackMatch = client.match(/(\d{10,})$/);
  return fallbackMatch ? `pub-${fallbackMatch[1]}` : 'pub-0000000000000000';
}

// --- Network Helper (已优化，见下文) --

// --- Security Helpers ---
let AUTH_READY = false;
let EXPECTED_TOKEN_HASH = null;
async function ensureAuth(env){
  if (AUTH_READY) return;
  const hashed = (env.TOKEN_HASH || env.TOKEN_SHA256 || '').trim();
  if (hashed) {
    EXPECTED_TOKEN_HASH = hashed.toLowerCase();
  } else if (env.TOKEN) {
    EXPECTED_TOKEN_HASH = (await sha256Hex(String(env.TOKEN))).toLowerCase();
  } else {
    EXPECTED_TOKEN_HASH = null;
  }
  AUTH_READY = true;
}

async function isAuthorized(request, env){
    const providedHeader = request.headers.get('x-access-token') || (request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!providedHeader || !EXPECTED_TOKEN_HASH){
        return false;
    }
    const digestCalc = (await sha256Hex(providedHeader)).toLowerCase();
    return timingSafeEqual(digestCalc, EXPECTED_TOKEN_HASH);
}

function timingSafeEqual(a,b){
  if(typeof a!== 'string' || typeof b!== 'string') return false;
  const len = Math.max(a.length, b.length);
  let out = 0;
  for(let i=0;i<len;i++){
    const ca = a.charCodeAt(i) || 0;
    const cb = b.charCodeAt(i) || 0;
    out |= (ca ^ cb);
  }
  return a.length === b.length && out === 0;
}

async function sha256Hex(str){
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// --- Rate Limiting Helper (优化版) ---
const rateLimitStore = new Map();
let rateLimitCleanupScheduled = false;

function scheduleRateLimitCleanup() {
  if (rateLimitCleanupScheduled) return;
  rateLimitCleanupScheduled = true;
  
  setInterval(() => {
    const now = Date.now();
    let deleted = 0;
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) {
        rateLimitStore.delete(key);
        deleted++;
      }
    }
    if (deleted > 0) {
      console.log(`Rate limit cleanup: removed ${deleted} expired entries`);
    }
  }, CONFIG.RATE_LIMIT.CLEANUP_INTERVAL);
}

function checkRateLimit(request, env) {
  // Initialize cleanup on first call
  scheduleRateLimitCleanup();
  
  const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS || CONFIG.RATE_LIMIT.WINDOW_MS, 10);
  const maxReq = parseInt(env.RATE_LIMIT_MAX || CONFIG.RATE_LIMIT.MAX_REQUESTS, 10);
  const ip = getClientIp(request);
  const now = Date.now();
  
  let entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitStore.set(ip, entry);
  }
  
  entry.count++;
  return entry.count > maxReq;
}

/**
 * [优化] 城市名称验证和清理
 */
function validateCityName(city) {
  if (!city || typeof city !== 'string') return '上海';
  
  // Remove potentially dangerous characters
  const cleaned = city
    .trim()
    .replace(/[<>\"'&]/g, '')
    .slice(0, 50); // Limit length
    
  return cleaned || '上海';
}

/**
 * [优化] 网络请求优化，使用配置常量
 */
async function fetchWithRetry(url, options = {}, retries = CONFIG.NETWORK.RETRIES, timeoutMs = CONFIG.NETWORK.TIMEOUT) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(t);
      return r;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i === retries) break;
      const backoff = CONFIG.NETWORK.BACKOFF_BASE * Math.pow(2, i);
      await new Promise(rs => setTimeout(rs, backoff));
    }
  }
  throw lastErr || new Error('network_error');
}

// --- General Helpers ---
function getClientIp(request){
  return (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// 新增：更稳健的地理编码函数，支持中文直辖市与多候选筛选
function isChinese(str){
  return /[\u4e00-\u9fa5]/.test(str);
}

function buildGeoQueryCandidates(city){
  const c = (city || '').trim();
  const candidates = new Set();
  if (!c) return [];

  // 统一移除常见行政后缀（仅作为额外候选，不替换原词）
  const stripAdminSuffix = (s) => s.replace(/(市|区|县|州|盟|旗|自治州|自治区|地区|特别行政区)$/u, '');
  const cNoSuffix = stripAdminSuffix(c);

  // 基础候选
  candidates.add(c);
  // 添加常见“市”变体，有助于如“湖州”→“湖州市”的检索
  if (!/市$/u.test(c)) candidates.add(c + '市');

  // 无后缀变体
  if (cNoSuffix && cNoSuffix !== c) candidates.add(cNoSuffix);

  // 常见中文-英文映射兜底（避免外部依赖）
  const map = {
    '重庆': 'Chongqing', '重庆市': 'Chongqing',
    '天津': 'Tianjin',   '天津市': 'Tianjin',
    '北京': 'Beijing',   '北京市': 'Beijing',
    '上海': 'Shanghai',  '上海市': 'Shanghai',
    '广州': 'Guangzhou', '广州市': 'Guangzhou',
    '深圳': 'Shenzhen',  '深圳市': 'Shenzhen',
    '西安': "Xi'an",    '西安市': "Xi'an",
    // 重点补充：难命中的县级与变体
    '墨脱': '墨脱县', '墨脱县': '墨脱县',
    // 湖州补充：部分地理编码接口对“湖州市”命中更稳定
    '湖州': 'Huzhou', '湖州市': 'Huzhou',
    // 英文变体兜底（常见拼写）
    'Motuo': 'Motuo', 'Medog': 'Medog'
  };
  if (map[c]) candidates.add(map[c]);
  if (map[cNoSuffix]) candidates.add(map[cNoSuffix]);

  // 限制候选总量，避免过多请求（保留插入顺序）
  const arr = Array.from(candidates).filter(Boolean);
  return arr.slice(0, 10);
}

async function geocodeCitySmart(city){
  const baseQueries = buildGeoQueryCandidates(city);
  const preferCN = isChinese(city);

  // 定义一个查询函数（可切换语言与附加关键词）
  const search = async (q, lang = 'zh') => {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=${lang}&format=json`;
    const r = await fetchWithRetry(geoUrl);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.results) ? j.results : [];
  };

  // 第一轮：原始候选（中文优先），每个候选先 zh
  for (const q of baseQueries) {
    const arr = await search(q, 'zh');
    const best = pickBestLocation(city, arr, preferCN);
    if (best) return best;
  }

  // 第二轮：中文候选 + “ 中国” 限定（帮助 disambiguation）
  if (preferCN) {
    for (const q of baseQueries) {
      const arr = await search(`${q} 中国`, 'zh');
      const best = pickBestLocation(city, arr, true);
      if (best) return best;
    }
  }

  // 第三轮：英文检索（可能部分城市中文名称不可用）
  for (const q of baseQueries) {
    const arr = await search(q, 'en');
    const best = pickBestLocation(city, arr, preferCN);
    if (best) return best;
  }
  
  return null;
}

function pickBestLocation(originalCity, results, preferCN){
  if (!results || results.length === 0) return null;
  let arr = results.slice();

  // 优先精确名称匹配（含“市”变体）
  const exactNames = new Set([originalCity, originalCity.replace(/[市]$/u,''), originalCity + '市']);
  const exact = arr.find(x => exactNames.has(String(x.name||'')));
  if (exact) return exact;

  // 优先中国境内
  if (preferCN) {
    const cnList = arr.filter(x => (x.country_code||'').toUpperCase() === 'CN');
    if (cnList.length) arr = cnList;
  }

  // 按人口倒序（大城市优先，如直辖市）
  arr.sort((a,b)=> (b.population||0) - (a.population||0));
  return arr[0] || null;
}

function weatherCodeText(code){
  const m={0:'晴朗',1:'大致晴朗',2:'局部多云',3:'多云',45:'有雾',48:'沉积雾',51:'小毛毛雨',53:'中毛毛雨',55:'大毛毛雨',56:'小冻毛毛雨',57:'大冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'强冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'中阵雨',82:'强阵雨',85:'小阵雪',86:'强阵雪',95:'雷阵雨',96:'雷阵雨伴冰雹',99:'强雷雨伴冰雹'};
  return m[code] || '多云';
}
function weatherCodeTextEn(code){
  const m={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Cloudy',45:'Fog',48:'Depositing rime fog',51:'Light drizzle',53:'Moderate drizzle',55:'Heavy drizzle',56:'Light freezing drizzle',57:'Heavy freezing drizzle',61:'Light rain',63:'Moderate rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Light snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains',80:'Light showers',81:'Moderate showers',82:'Heavy showers',85:'Light snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Severe thunderstorm with hail'};
  return m[code] || 'Cloudy';
}
function weatherCodeIcon(code){
  if(code===0||code===1) return '☀️'; if(code===2) return '🌤️'; if(code===3) return '☁️'; if(code===45||code===48) return '🌫️'; if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return '🌧️'; if([71,73,75,77,85,86].includes(code)) return '🌨️'; if([95,96,99].includes(code)) return '⛈️';
  return '☁️';
}
function buildJsonResponse(body, status = 200, corsHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status: status,
        headers: { 
          'content-type': 'application/json; charset=utf-8',
          ...corsHeaders
        }
    });
}

// ===================================================================================
// --- 5. 主路由/入口 (Main Router / Entrypoint) ---
// ===================================================================================

export default {
  async fetch(request, env) {
    try {
      await ensureAuth(env);
      const url = new URL(request.url);
      
      // Add CORS headers for all responses
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Access-Token, Authorization',
        'Access-Control-Max-Age': '86400'
      };

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // --- Public Routes ---
      if (url.pathname === '/ads.txt') {
        const pubId = getAdsPubId(env);
        const content = `google.com, ${pubId}, DIRECT, ${CONFIG.ADSENSE.SELLER_ACCOUNT_ID}\n`;
        return new Response(content, { 
          headers: { 
            'content-type': 'text/plain; charset=utf-8', 
            'cache-control': 'public, max-age=3600',
            ...corsHeaders 
          } 
        });
      }

      // --- Health Check ---
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ 
          status: 'ok', 
          timestamp: Date.now(),
          cache: {
            weather: weatherCache.getStats(),
            landmarks: landmarkCache.getStats(),
            rateLimit: rateLimitStore.size
          }
        }), { 
          headers: { 
            'content-type': 'application/json',
            ...corsHeaders 
          } 
        });
      }

      // If TOKEN is not configured at all, deny access to all protected routes
      if (!EXPECTED_TOKEN_HASH) {
        return new Response('Unauthorized: Application TOKEN is not configured.', { 
          status: 401, 
          headers: { 
            'content-type': 'text/plain; charset=utf-8',
            ...corsHeaders 
          }
        });
      }

      // --- UI Route ---
      if (url.pathname === '/') {
        return new Response(renderIndexHtml(env), { 
          headers: { 
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=300',
            ...corsHeaders 
          } 
        });
      }

      // --- API Route ---
      if (url.pathname === '/api/weather') {
        // Security Layer 1: Authorization
        if (!(await isAuthorized(request, env))) {
          return buildJsonResponse({ success: false, error: 'Unauthorized' }, 401, corsHeaders);
        }
        
        // Security Layer 2: Rate Limiting
        if (checkRateLimit(request, env)) {
          return buildJsonResponse({ success: false, error: 'Rate limit exceeded' }, 429, corsHeaders);
        }

        // Business Logic Layer
        try {
          const response = await handleApiRequest(request, env);
          // Add CORS headers to the response
          Object.entries(corsHeaders).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
          return response;
        } catch (e) {
          console.error('Unhandled exception in API handler:', e);
          return buildJsonResponse({ success: false, error: e.message || 'Internal Server Error' }, 500, corsHeaders);
        }
      }

      return new Response('Not Found', { 
        status: 404, 
        headers: { 
          'content-type': 'text/plain',
          ...corsHeaders 
        } 
      });
      
    } catch (error) {
      console.error('Global error handler:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};