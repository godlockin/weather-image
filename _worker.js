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
    HEIGHT: 900,
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
    /* 自适应：根据视口高度柔性设置展示区域高度 */
    .res {
      min-height: clamp(420px, 64vh, 900px);
    }
    #img {
      display: block;
      width: 100%;
      height: auto;
    }
    @media (max-width: 768px) {
      .res { min-height: clamp(360px, 58vh, 720px); }
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

  // 中国城市分级映射 + 全球一线城市映射（避免外部依赖）
  const map = {
    // === 中国所有城市 (All Chinese Cities) ===
    // 直辖市 (Municipalities)
    '北京': 'Beijing', '北京市': 'Beijing',
    '上海': 'Shanghai', '上海市': 'Shanghai',
    '天津': 'Tianjin', '天津市': 'Tianjin',
    '重庆': 'Chongqing', '重庆市': 'Chongqing',
    
    // 安徽省 (Anhui Province)
    '合肥': 'Hefei', '合肥市': 'Hefei',
    '安庆': 'Anqing', '安庆市': 'Anqing',
    '蚌埠': 'Bengbu', '蚌埠市': 'Bengbu',
    '亳州': 'Bozhou', '亳州市': 'Bozhou',
    '池州': 'Chizhou', '池州市': 'Chizhou',
    '滁州': 'Chuzhou', '滁州市': 'Chuzhou',
    '阜阳': 'Fuyang', '阜阳市': 'Fuyang',
    '淮北': 'Huaibei', '淮北市': 'Huaibei',
    '淮南': 'Huainan', '淮南市': 'Huainan',
    '黄山': 'Huangshan', '黄山市': 'Huangshan',
    '六安': 'Luan', '六安市': 'Luan',
    '马鞍山': 'Maanshan', '马鞍山市': 'Maanshan',
    '宿州': 'Suzhou', '宿州市': 'Suzhou',
    '铜陵': 'Tongling', '铜陵市': 'Tongling',
    '芜湖': 'Wuhu', '芜湖市': 'Wuhu',
    '宣城': 'Xuancheng', '宣城市': 'Xuancheng',
    
    // 福建省 (Fujian Province)
    '福州': 'Fuzhou', '福州市': 'Fuzhou',
    '厦门': 'Xiamen', '厦门市': 'Xiamen',
    '龙岩': 'Longyan', '龙岩市': 'Longyan',
    '南平': 'Nanping', '南平市': 'Nanping',
    '宁德': 'Ningde', '宁德市': 'Ningde',
    '莆田': 'Putian', '莆田市': 'Putian',
    '泉州': 'Quanzhou', '泉州市': 'Quanzhou',
    '三明': 'Sanming', '三明市': 'Sanming',
    '漳州': 'Zhangzhou', '漳州市': 'Zhangzhou',
    
    // 甘肃省 (Gansu Province)
    '酒泉': 'Jiuquan', '酒泉市': 'Jiuquan',
    '嘉峪关': 'Jiayuguan', '嘉峪关市': 'Jiayuguan',
    '张掖': 'Zhangye', '张掖市': 'Zhangye',
    '金昌': 'Jinchang', '金昌市': 'Jinchang',
    '武威': 'Wuwei', '武威市': 'Wuwei',
    '白银': 'Baiyin', '白银市': 'Baiyin',
    '兰州': 'Lanzhou', '兰州市': 'Lanzhou',
    '定西': 'Dingxi', '定西市': 'Dingxi',
    '陇南': 'Longnan', '陇南市': 'Longnan',
    '天水': 'Tianshui', '天水市': 'Tianshui',
    '平凉': 'Pingliang', '平凉市': 'Pingliang',
    '庆阳': 'Qingyang', '庆阳市': 'Qingyang',
    
    // 广东省 (Guangdong Province)
    '广州': 'Guangzhou', '广州市': 'Guangzhou',
    '深圳': 'Shenzhen', '深圳市': 'Shenzhen',
    '珠海': 'Zhuhai', '珠海市': 'Zhuhai',
    '汕头': 'Shantou', '汕头市': 'Shantou',
    '佛山': 'Foshan', '佛山市': 'Foshan',
    '韶关': 'Shaoguan', '韶关市': 'Shaoguan',
    '湛江': 'Zhanjiang', '湛江市': 'Zhanjiang',
    '茂名': 'Maoming', '茂名市': 'Maoming',
    '肇庆': 'Zhaoqing', '肇庆市': 'Zhaoqing',
    '惠州': 'Huizhou', '惠州市': 'Huizhou',
    '梅州': 'Meizhou', '梅州市': 'Meizhou',
    '汕尾': 'Shanwei', '汕尾市': 'Shanwei',
    '河源': 'Heyuan', '河源市': 'Heyuan',
    '阳江': 'Yangjiang', '阳江市': 'Yangjiang',
    '清远': 'Qingyuan', '清远市': 'Qingyuan',
    '东莞': 'Dongguan', '东莞市': 'Dongguan',
    '中山': 'Zhongshan', '中山市': 'Zhongshan',
    '江门': 'Jiangmen', '江门市': 'Jiangmen',
    '云浮': 'Yunfu', '云浮市': 'Yunfu',
    '揭阳': 'Jieyang', '揭阳市': 'Jieyang',
    
    // 广西壮族自治区 (Guangxi Zhuang Autonomous Region)
    '南宁': 'Nanning', '南宁市': 'Nanning',
    '柳州': 'Liuzhou', '柳州市': 'Liuzhou',
    '桂林': 'Guilin', '桂林市': 'Guilin',
    '梧州': 'Wuzhou', '梧州市': 'Wuzhou',
    '北海': 'Beihai', '北海市': 'Beihai',
    '防城港': 'Fangchenggang', '防城港市': 'Fangchenggang',
    '钦州': 'Qinzhou', '钦州市': 'Qinzhou',
    '贵港': 'Guigang', '贵港市': 'Guigang',
    '玉林': 'Yulin', '玉林市': 'Yulin',
    '百色': 'Baise', '百色市': 'Baise',
    '贺州': 'Hezhou', '贺州市': 'Hezhou',
    '河池': 'Hechi', '河池市': 'Hechi',
    '来宾': 'Laibin', '来宾市': 'Laibin',
    '崇左': 'Chongzuo', '崇左市': 'Chongzuo',
    
    // 贵州省 (Guizhou Province)
    '贵阳': 'Guiyang', '贵阳市': 'Guiyang',
    '六盘水': 'Liupanshui', '六盘水市': 'Liupanshui',
    '遵义': 'Zunyi', '遵义市': 'Zunyi',
    '安顺': 'Anshun', '安顺市': 'Anshun',
    '毕节': 'Bijie', '毕节市': 'Bijie',
    '铜仁': 'Tongren', '铜仁市': 'Tongren',
    
    // 海南省 (Hainan Province)
    '海口': 'Haikou', '海口市': 'Haikou',
    '三亚': 'Sanya', '三亚市': 'Sanya',
    '儋州': 'Danzhou', '儋州市': 'Danzhou',
    '三沙': 'Sansha', '三沙市': 'Sansha',
    
    // 河北省 (Hebei Province)
    '石家庄': 'Shijiazhuang', '石家庄市': 'Shijiazhuang',
    '唐山': 'Tangshan', '唐山市': 'Tangshan',
    '秦皇岛': 'Qinhuangdao', '秦皇岛市': 'Qinhuangdao',
    '邯郸': 'Handan', '邯郸市': 'Handan',
    '邢台': 'Xingtai', '邢台市': 'Xingtai',
    '保定': 'Baoding', '保定市': 'Baoding',
    '张家口': 'Zhangjiakou', '张家口市': 'Zhangjiakou',
    '承德': 'Chengde', '承德市': 'Chengde',
    '沧州': 'Cangzhou', '沧州市': 'Cangzhou',
    '廊坊': 'Langfang', '廊坊市': 'Langfang',
    '衡水': 'Hengshui', '衡水市': 'Hengshui',
    
    // 黑龙江省 (Heilongjiang Province)
    '哈尔滨': 'Harbin', '哈尔滨市': 'Harbin',
    '齐齐哈尔': 'Qiqihar', '齐齐哈尔市': 'Qiqihar',
    '牡丹江': 'Mudanjiang', '牡丹江市': 'Mudanjiang',
    '佳木斯': 'Jiamusi', '佳木斯市': 'Jiamusi',
    '鹤岗': 'Hegang', '鹤岗市': 'Hegang',
    '双鸭山': 'Shuangyashan', '双鸭山市': 'Shuangyashan',
    '七台河': 'Qitaihe', '七台河市': 'Qitaihe',
    '大庆': 'Daqing', '大庆市': 'Daqing',
    '伊春': 'Yichun', '伊春市': 'Yichun',
    '黑河': 'Heihe', '黑河市': 'Heihe',
    '绥化': 'Suihua', '绥化市': 'Suihua',
    
    // 河南省 (Henan Province)
    '郑州': 'Zhengzhou', '郑州市': 'Zhengzhou',
    '开封': 'Kaifeng', '开封市': 'Kaifeng',
    '洛阳': 'Luoyang', '洛阳市': 'Luoyang',
    '平顶山': 'Pingdingshan', '平顶山市': 'Pingdingshan',
    '安阳': 'Anyang', '安阳市': 'Anyang',
    '鹤壁': 'Hebi', '鹤壁市': 'Hebi',
    '新乡': 'Xinxiang', '新乡市': 'Xinxiang',
    '焦作': 'Jiaozuo', '焦作市': 'Jiaozuo',
    '濮阳': 'Puyang', '濮阳市': 'Puyang',
    '许昌': 'Xuchang', '许昌市': 'Xuchang',
    '漯河': 'Luohe', '漯河市': 'Luohe',
    '三门峡': 'Sanmenxia', '三门峡市': 'Sanmenxia',
    '南阳': 'Nanyang', '南阳市': 'Nanyang',
    '商丘': 'Shangqiu', '商丘市': 'Shangqiu',
    '信阳': 'Xinyang', '信阳市': 'Xinyang',
    '周口': 'Zhoukou', '周口市': 'Zhoukou',
    '驻马店': 'Zhumadian', '驻马店市': 'Zhumadian',
    
    // 湖北省 (Hubei Province)
    '武汉': 'Wuhan', '武汉市': 'Wuhan',
    '黄石': 'Huangshi', '黄石市': 'Huangshi',
    '十堰': 'Shiyan', '十堰市': 'Shiyan',
    '宜昌': 'Yichang', '宜昌市': 'Yichang',
    '襄阳': 'Xiangyang', '襄阳市': 'Xiangyang',
    '鄂州': 'Ezhou', '鄂州市': 'Ezhou',
    '荆门': 'Jingmen', '荆门市': 'Jingmen',
    '孝感': 'Xiaogan', '孝感市': 'Xiaogan',
    '荆州': 'Jingzhou', '荆州市': 'Jingzhou',
    '黄冈': 'Huanggang', '黄冈市': 'Huanggang',
    '咸宁': 'Xianning', '咸宁市': 'Xianning',
    '随州': 'Suizhou', '随州市': 'Suizhou',
    
    // 湖南省 (Hunan Province)
    '长沙': 'Changsha', '长沙市': 'Changsha',
    '株洲': 'Zhuzhou', '株洲市': 'Zhuzhou',
    '湘潭': 'Xiangtan', '湘潭市': 'Xiangtan',
    '衡阳': 'Hengyang', '衡阳市': 'Hengyang',
    '邵阳': 'Shaoyang', '邵阳市': 'Shaoyang',
    '岳阳': 'Yueyang', '岳阳市': 'Yueyang',
    '常德': 'Changde', '常德市': 'Changde',
    '张家界': 'Zhangjiajie', '张家界市': 'Zhangjiajie',
    '益阳': 'Yiyang', '益阳市': 'Yiyang',
    '郴州': 'Chenzhou', '郴州市': 'Chenzhou',
    '永州': 'Yongzhou', '永州市': 'Yongzhou',
    '怀化': 'Huaihua', '怀化市': 'Huaihua',
    '娄底': 'Loudi', '娄底市': 'Loudi',
    
    // 内蒙古自治区 (Inner Mongolia Autonomous Region)
    '呼和浩特': 'Hohhot', '呼和浩特市': 'Hohhot',
    '包头': 'Baotou', '包头市': 'Baotou',
    '鄂尔多斯': 'Ordos', '鄂尔多斯市': 'Ordos',
    '赤峰': 'Chifeng', '赤峰市': 'Chifeng',
    '通辽': 'Tongliao', '通辽市': 'Tongliao',
    '呼伦贝尔': 'Hulunbuir', '呼伦贝尔市': 'Hulunbuir',
    '巴彦淖尔': 'Bayannur', '巴彦淖尔市': 'Bayannur',
    '乌兰察布': 'Ulanqab', '乌兰察布市': 'Ulanqab',
    '乌海': 'Wuhai', '乌海市': 'Wuhai',
    
    // 江苏省 (Jiangsu Province)
    '南京': 'Nanjing', '南京市': 'Nanjing',
    '无锡': 'Wuxi', '无锡市': 'Wuxi',
    '徐州': 'Xuzhou', '徐州市': 'Xuzhou',
    '常州': 'Changzhou', '常州市': 'Changzhou',
    '苏州': 'Suzhou', '苏州市': 'Suzhou',
    '南通': 'Nantong', '南通市': 'Nantong',
    '连云港': 'Lianyungang', '连云港市': 'Lianyungang',
    '淮安': 'Huaian', '淮安市': 'Huaian',
    '盐城': 'Yancheng', '盐城市': 'Yancheng',
    '扬州': 'Yangzhou', '扬州市': 'Yangzhou',
    '镇江': 'Zhenjiang', '镇江市': 'Zhenjiang',
    '泰州': 'Taizhou', '泰州市': 'Taizhou',
    '宿迁': 'Suqian', '宿迁市': 'Suqian',
    
    // 江西省 (Jiangxi Province)
    '南昌': 'Nanchang', '南昌市': 'Nanchang',
    '九江': 'Jiujiang', '九江市': 'Jiujiang',
    '赣州': 'Ganzhou', '赣州市': 'Ganzhou',
    '宜春': 'Yichun', '宜春市': 'Yichun',
    '抚州': 'Fuzhou', '抚州市': 'Fuzhou',
    '萍乡': 'Pingxiang', '萍乡市': 'Pingxiang',
    '吉安': 'Jian', '吉安市': 'Jian',
    '新余': 'Xinyu', '新余市': 'Xinyu',
    '鹰潭': 'Yingtan', '鹰潭市': 'Yingtan',
    '景德镇': 'Jingdezhen', '景德镇市': 'Jingdezhen',
    '上饶': 'Shangrao', '上饶市': 'Shangrao',
    
    // 吉林省 (Jilin Province)
    '长春': 'Changchun', '长春市': 'Changchun',
    '吉林': 'Jilin', '吉林市': 'Jilin',
    '四平': 'Siping', '四平市': 'Siping',
    '辽源': 'Liaoyuan', '辽源市': 'Liaoyuan',
    '通化': 'Tonghua', '通化市': 'Tonghua',
    '白山': 'Baishan', '白山市': 'Baishan',
    '白城': 'Baicheng', '白城市': 'Baicheng',
    '松原': 'Songyuan', '松原市': 'Songyuan',
    
    // 辽宁省 (Liaoning Province)
    '沈阳': 'Shenyang', '沈阳市': 'Shenyang',
    '大连': 'Dalian', '大连市': 'Dalian',
    '鞍山': 'Anshan', '鞍山市': 'Anshan',
    '本溪': 'Benxi', '本溪市': 'Benxi',
    '丹东': 'Dandong', '丹东市': 'Dandong',
    '抚顺': 'Fushun', '抚顺市': 'Fushun',
    '阜新': 'Fuxin', '阜新市': 'Fuxin',
    '辽阳': 'Liaoyang', '辽阳市': 'Liaoyang',
    '盘锦': 'Panjin', '盘锦市': 'Panjin',
    '铁岭': 'Tieling', '铁岭市': 'Tieling',
    '营口': 'Yingkou', '营口市': 'Yingkou',
    '朝阳': 'Chaoyang', '朝阳市': 'Chaoyang',
    '葫芦岛': 'Huludao', '葫芦岛市': 'Huludao',
    '锦州': 'Jinzhou', '锦州市': 'Jinzhou',
    '芜湖': 'Wuhu', '芜湖市': 'Wuhu',

    '湛江': 'Zhanjiang', '湛江市': 'Zhanjiang',
    '兰州': 'Lanzhou', '兰州市': 'Lanzhou',
    '西宁': 'Xining', '西宁市': 'Xining',
    
    // === 中国四线城市 (Tier 4) - 重要地级市 ===
    '安阳': 'Anyang', '安阳市': 'Anyang',
    '鞍山': 'Anshan', '鞍山市': 'Anshan',
    '蚌埠': 'Bengbu', '蚌埠市': 'Bengbu',
    '包头': 'Baotou', '包头市': 'Baotou',
    '本溪': 'Benxi', '本溪市': 'Benxi',
    '沧州': 'Cangzhou', '沧州市': 'Cangzhou',
    '常德': 'Changde', '常德市': 'Changde',
    '承德': 'Chengde', '承德市': 'Chengde',
    '赤峰': 'Chifeng', '赤峰市': 'Chifeng',
    '大庆': 'Daqing', '大庆市': 'Daqing',
    '德州': 'Dezhou', '德州市': 'Dezhou',
    '东营': 'Dongying', '东营市': 'Dongying',
    '鄂尔多斯': 'Ordos', '鄂尔多斯市': 'Ordos',
    '抚顺': 'Fushun', '抚顺市': 'Fushun',
    '阜阳': 'Fuyang', '阜阳市': 'Fuyang',
    '赣州': 'Ganzhou', '赣州市': 'Ganzhou',
    '桂林': 'Guilin', '桂林市': 'Guilin',
    '邯郸': 'Handan', '邯郸市': 'Handan',
    '衡阳': 'Hengyang', '衡阳市': 'Hengyang',
    '呼伦贝尔': 'Hulunbuir', '呼伦贝尔市': 'Hulunbuir',
    '淮安': 'Huaian', '淮安市': 'Huaian',
    '黄冈': 'Huanggang', '黄冈市': 'Huanggang',
    '惠州': 'Huizhou', '惠州市': 'Huizhou',
    '佳木斯': 'Jiamusi', '佳木斯市': 'Jiamusi',
    '焦作': 'Jiaozuo', '焦作市': 'Jiaozuo',
    '荆州': 'Jingzhou', '荆州市': 'Jingzhou',
    '九江': 'Jiujiang', '九江市': 'Jiujiang',
    '开封': 'Kaifeng', '开封市': 'Kaifeng',
    '廊坊': 'Langfang', '廊坊市': 'Langfang',
    '连云港': 'Lianyungang', '连云港市': 'Lianyungang',
    '聊城': 'Liaocheng', '聊城市': 'Liaocheng',
    '临沂': 'Linyi', '临沂市': 'Linyi',
    '柳州': 'Liuzhou', '柳州市': 'Liuzhou',
    '龙岩': 'Longyan', '龙岩市': 'Longyan',
    '泸州': 'Luzhou', '泸州市': 'Luzhou',
    '马鞍山': 'Maanshan', '马鞍山市': 'Maanshan',
    '牡丹江': 'Mudanjiang', '牡丹江市': 'Mudanjiang',
    '南充': 'Nanchong', '南充市': 'Nanchong',
    '南阳': 'Nanyang', '南阳市': 'Nanyang',
    '宁德': 'Ningde', '宁德市': 'Ningde',
    '盘锦': 'Panjin', '盘锦市': 'Panjin',
    '莆田': 'Putian', '莆田市': 'Putian',
    '齐齐哈尔': 'Qiqihar', '齐齐哈尔市': 'Qiqihar',
    '秦皇岛': 'Qinhuangdao', '秦皇岛市': 'Qinhuangdao',
    '衢州': 'Quzhou', '衢州市': 'Quzhou',
    '三明': 'Sanming', '三明市': 'Sanming',
    '上饶': 'Shangrao', '上饶市': 'Shangrao',
    '绍兴': 'Shaoxing', '绍兴市': 'Shaoxing',
    '泰安': 'Taian', '泰安市': 'Taian',
    '泰州': 'Taizhou', '泰州市': 'Taizhou',
    '唐山': 'Tangshan', '唐山市': 'Tangshan',
    '通辽': 'Tongliao', '通辽市': 'Tongliao',
    '芜湖': 'Wuhu', '芜湖市': 'Wuhu',
    '武威': 'Wuwei', '武威市': 'Wuwei',
    '咸阳': 'Xianyang', '咸阳市': 'Xianyang',
    '襄阳': 'Xiangyang', '襄阳市': 'Xiangyang',
    '孝感': 'Xiaogan', '孝感市': 'Xiaogan',
    '忻州': 'Xinzhou', '忻州市': 'Xinzhou',
    '宜昌': 'Yichang', '宜昌市': 'Yichang',
    '营口': 'Yingkou', '营口市': 'Yingkou',
    '岳阳': 'Yueyang', '岳阳市': 'Yueyang',
    '张家口': 'Zhangjiakou', '张家口市': 'Zhangjiakou',
    '湛江': 'Zhanjiang', '湛江市': 'Zhanjiang',
    '肇庆': 'Zhaoqing', '肇庆市': 'Zhaoqing',
    '株洲': 'Zhuzhou', '株洲市': 'Zhuzhou',
    '舟山': 'Zhoushan', '舟山市': 'Zhoushan',
    
    // === 中国五线城市 (Tier 5) - 重要县级市和地级市 ===
    '阿克苏': 'Aksu', '阿克苏市': 'Aksu',
    '安康': 'Ankang', '安康市': 'Ankang',
    '安顺': 'Anshun', '安顺市': 'Anshun',
    '巴彦淖尔': 'Bayannur', '巴彦淖尔市': 'Bayannur',
    '白城': 'Baicheng', '白城市': 'Baicheng',
    '白山': 'Baishan', '白山市': 'Baishan',
    '百色': 'Baise', '百色市': 'Baise',
    '蚌埠': 'Bengbu', '蚌埠市': 'Bengbu',
    '毕节': 'Bijie', '毕节市': 'Bijie',
    '滨州': 'Binzhou', '滨州市': 'Binzhou',
    '博尔塔拉': 'Bortala', '博尔塔拉蒙古自治州': 'Bortala',
    '昌吉': 'Changji', '昌吉回族自治州': 'Changji',
    '朝阳': 'Chaoyang', '朝阳市': 'Chaoyang',
    '池州': 'Chizhou', '池州市': 'Chizhou',
    '崇左': 'Chongzuo', '崇左市': 'Chongzuo',
    '达州': 'Dazhou', '达州市': 'Dazhou',
    '大同': 'Datong', '大同市': 'Datong',
    '大兴安岭': 'Daxinganling', '大兴安岭地区': 'Daxinganling',
    '德阳': 'Deyang', '德阳市': 'Deyang',
    '定西': 'Dingxi', '定西市': 'Dingxi',
    '鄂州': 'Ezhou', '鄂州市': 'Ezhou',
    '恩施': 'Enshi', '恩施土家族苗族自治州': 'Enshi',
    '防城港': 'Fangchenggang', '防城港市': 'Fangchenggang',
    '抚州': 'Fuzhou', '抚州市': 'Fuzhou',
    '甘南': 'Gannan', '甘南藏族自治州': 'Gannan',
    '甘孜': 'Garze', '甘孜藏族自治州': 'Garze',
    '广安': 'Guangan', '广安市': 'Guangan',
    '广元': 'Guangyuan', '广元市': 'Guangyuan',
    '贵港': 'Guigang', '贵港市': 'Guigang',
    '桂林': 'Guilin', '桂林市': 'Guilin',
    '哈密': 'Hami', '哈密市': 'Hami',
    '汉中': 'Hanzhong', '汉中市': 'Hanzhong',
    '河池': 'Hechi', '河池市': 'Hechi',
    '河源': 'Heyuan', '河源市': 'Heyuan',
    '贺州': 'Hezhou', '贺州市': 'Hezhou',
    '黑河': 'Heihe', '黑河市': 'Heihe',
    '红河': 'Honghe', '红河哈尼族彝族自治州': 'Honghe',
    '怀化': 'Huaihua', '怀化市': 'Huaihua',
    '淮北': 'Huaibei', '淮北市': 'Huaibei',
    '淮南': 'Huainan', '淮南市': 'Huainan',
    '黄山': 'Huangshan', '黄山市': 'Huangshan',
    '黄石': 'Huangshi', '黄石市': 'Huangshi',
    '惠州': 'Huizhou', '惠州市': 'Huizhou',
    '鸡西': 'Jixi', '鸡西市': 'Jixi',
    '吉安': 'Jian', '吉安市': 'Jian',
    '吉林': 'Jilin', '吉林市': 'Jilin',
    '济宁': 'Jining', '济宁市': 'Jining',
    '晋城': 'Jincheng', '晋城市': 'Jincheng',
    '晋中': 'Jinzhong', '晋中市': 'Jinzhong',
    '荆门': 'Jingmen', '荆门市': 'Jingmen',
    '景德镇': 'Jingdezhen', '景德镇市': 'Jingdezhen',
    '酒泉': 'Jiuquan', '酒泉市': 'Jiuquan',
    '喀什': 'Kashgar', '喀什地区': 'Kashgar',
    '克拉玛依': 'Karamay', '克拉玛依市': 'Karamay',
    '来宾': 'Laibin', '来宾市': 'Laibin',
    '莱芜': 'Laiwu', '莱芜市': 'Laiwu',
    '乐山': 'Leshan', '乐山市': 'Leshan',
    '丽江': 'Lijiang', '丽江市': 'Lijiang',
    '丽水': 'Lishui', '丽水市': 'Lishui',
    '临汾': 'Linfen', '临汾市': 'Linfen',
    '临夏': 'Linxia', '临夏回族自治州': 'Linxia',
    '六安': 'Luan', '六安市': 'Luan',
    '六盘水': 'Liupanshui', '六盘水市': 'Liupanshui',
    '娄底': 'Loudi', '娄底市': 'Loudi',
    '吕梁': 'Lvliang', '吕梁市': 'Lvliang',
    '眉山': 'Meishan', '眉山市': 'Meishan',
    '梅州': 'Meizhou', '梅州市': 'Meizhou',
    '绵阳': 'Mianyang', '绵阳市': 'Mianyang',
    '内江': 'Neijiang', '内江市': 'Neijiang',
    '南平': 'Nanping', '南平市': 'Nanping',
    '攀枝花': 'Panzhihua', '攀枝花市': 'Panzhihua',
    '平顶山': 'Pingdingshan', '平顶山市': 'Pingdingshan',
    '萍乡': 'Pingxiang', '萍乡市': 'Pingxiang',
    '普洱': 'Puer', '普洱市': 'Puer',
    '清远': 'Qingyuan', '清远市': 'Qingyuan',
    '庆阳': 'Qingyang', '庆阳市': 'Qingyang',
    '曲靖': 'Qujing', '曲靖市': 'Qujing',
    '日照': 'Rizhao', '日照市': 'Rizhao',
    '三门峡': 'Sanmenxia', '三门峡市': 'Sanmenxia',
    '汕尾': 'Shanwei', '汕尾市': 'Shanwei',
    '商洛': 'Shangluo', '商洛市': 'Shangluo',
    '商丘': 'Shangqiu', '商丘市': 'Shangqiu',
    '韶关': 'Shaoguan', '韶关市': 'Shaoguan',
    '邵阳': 'Shaoyang', '邵阳市': 'Shaoyang',
    '十堰': 'Shiyan', '十堰市': 'Shiyan',
    '朔州': 'Shuozhou', '朔州市': 'Shuozhou',
    '四平': 'Siping', '四平市': 'Siping',
    '松原': 'Songyuan', '松原市': 'Songyuan',
    '遂宁': 'Suining', '遂宁市': 'Suining',
    '随州': 'Suizhou', '随州市': 'Suizhou',
    '塔城': 'Tacheng', '塔城地区': 'Tacheng',
    '天水': 'Tianshui', '天水市': 'Tianshui',
    '铁岭': 'Tieling', '铁岭市': 'Tieling',
    '通化': 'Tonghua', '通化市': 'Tonghua',
    '铜川': 'Tongchuan', '铜川市': 'Tongchuan',
    '铜陵': 'Tongling', '铜陵市': 'Tongling',
    '铜仁': 'Tongren', '铜仁市': 'Tongren',
    '吐鲁番': 'Turpan', '吐鲁番市': 'Turpan',
    '威海': 'Weihai', '威海市': 'Weihai',
    '渭南': 'Weinan', '渭南市': 'Weinan',
    '文山': 'Wenshan', '文山壮族苗族自治州': 'Wenshan',
    '乌海': 'Wuhai', '乌海市': 'Wuhai',
    '乌兰察布': 'Ulanqab', '乌兰察布市': 'Ulanqab',
    '梧州': 'Wuzhou', '梧州市': 'Wuzhou',
    '西双版纳': 'Xishuangbanna', '西双版纳傣族自治州': 'Xishuangbanna',
    '仙桃': 'Xiantao', '仙桃市': 'Xiantao',
    '咸宁': 'Xianning', '咸宁市': 'Xianning',
    '湘潭': 'Xiangtan', '湘潭市': 'Xiangtan',
    '新乡': 'Xinxiang', '新乡市': 'Xinxiang',
    '信阳': 'Xinyang', '信阳市': 'Xinyang',
    '兴安盟': 'Xingan', '兴安盟': 'Xingan',
    '宣城': 'Xuancheng', '宣城市': 'Xuancheng',
    '许昌': 'Xuchang', '许昌市': 'Xuchang',
    '雅安': 'Yaan', '雅安市': 'Yaan',
    '延安': 'Yanan', '延安市': 'Yanan',
    '延边': 'Yanbian', '延边朝鲜族自治州': 'Yanbian',
    '盐城': 'Yancheng', '盐城市': 'Yancheng',
    '阳江': 'Yangjiang', '阳江市': 'Yangjiang',
    '阳泉': 'Yangquan', '阳泉市': 'Yangquan',
    '伊春': 'Yichun', '伊春市': 'Yichun',
    '伊犁': 'Ili', '伊犁哈萨克自治州': 'Ili',
    '宜宾': 'Yibin', '宜宾市': 'Yibin',
    '宜春': 'Yichun', '宜春市': 'Yichun',
    '益阳': 'Yiyang', '益阳市': 'Yiyang',
    '永州': 'Yongzhou', '永州市': 'Yongzhou',
    '玉林': 'Yulin', '玉林市': 'Yulin',
    '玉溪': 'Yuxi', '玉溪市': 'Yuxi',
    '岳阳': 'Yueyang', '岳阳市': 'Yueyang',
    '云浮': 'Yunfu', '云浮市': 'Yunfu',
    '运城': 'Yuncheng', '运城市': 'Yuncheng',
    '枣庄': 'Zaozhuang', '枣庄市': 'Zaozhuang',
    '张家界': 'Zhangjiajie', '张家界市': 'Zhangjiajie',
    '张掖': 'Zhangye', '张掖市': 'Zhangye',
    '漳州': 'Zhangzhou', '漳州市': 'Zhangzhou',
    '昭通': 'Zhaotong', '昭通市': 'Zhaotong',
    '肇庆': 'Zhaoqing', '肇庆市': 'Zhaoqing',
    '镇江': 'Zhenjiang', '镇江市': 'Zhenjiang',
    '中卫': 'Zhongwei', '中卫市': 'Zhongwei',
    '周口': 'Zhoukou', '周口市': 'Zhoukou',
    '驻马店': 'Zhumadian', '驻马店市': 'Zhumadian',
    '资阳': 'Ziyang', '资阳市': 'Ziyang',
    '淄博': 'Zibo', '淄博市': 'Zibo',
    '自贡': 'Zigong', '自贡市': 'Zigong',
    '遵义': 'Zunyi', '遵义市': 'Zunyi',
    
    // 宁夏回族自治区 (Ningxia Hui Autonomous Region)
    '银川': 'Yinchuan', '银川市': 'Yinchuan',
    '石嘴山': 'Shizuishan', '石嘴山市': 'Shizuishan',
    '吴忠': 'Wuzhong', '吴忠市': 'Wuzhong',
    '固原': 'Guyuan', '固原市': 'Guyuan',
    '中卫': 'Zhongwei', '中卫市': 'Zhongwei',
    
    // 青海省 (Qinghai Province)
    '西宁': 'Xining', '西宁市': 'Xining',
    '海东': 'Haidong', '海东市': 'Haidong',
    
    // 陕西省 (Shaanxi Province)
    '西安': "Xi'an", '西安市': "Xi'an",
    '铜川': 'Tongchuan', '铜川市': 'Tongchuan',
    '宝鸡': 'Baoji', '宝鸡市': 'Baoji',
    '咸阳': 'Xianyang', '咸阳市': 'Xianyang',
    '渭南': 'Weinan', '渭南市': 'Weinan',
    '延安': 'Yanan', '延安市': 'Yanan',
    '汉中': 'Hanzhong', '汉中市': 'Hanzhong',
    '安康': 'Ankang', '安康市': 'Ankang',
    '商洛': 'Shangluo', '商洛市': 'Shangluo',
    
    // 山东省 (Shandong Province)
    '济南': 'Jinan', '济南市': 'Jinan',
    '青岛': 'Qingdao', '青岛市': 'Qingdao',
    '淄博': 'Zibo', '淄博市': 'Zibo',
    '枣庄': 'Zaozhuang', '枣庄市': 'Zaozhuang',
    '东营': 'Dongying', '东营市': 'Dongying',
    '烟台': 'Yantai', '烟台市': 'Yantai',
    '潍坊': 'Weifang', '潍坊市': 'Weifang',
    '济宁': 'Jining', '济宁市': 'Jining',
    '泰安': 'Taian', '泰安市': 'Taian',
    '威海': 'Weihai', '威海市': 'Weihai',
    '日照': 'Rizhao', '日照市': 'Rizhao',
    '滨州': 'Binzhou', '滨州市': 'Binzhou',
    '德州': 'Dezhou', '德州市': 'Dezhou',
    '聊城': 'Liaocheng', '聊城市': 'Liaocheng',
    '临沂': 'Linyi', '临沂市': 'Linyi',
    '菏泽': 'Heze', '菏泽市': 'Heze',
    
    // 山西省 (Shanxi Province)
    '太原': 'Taiyuan', '太原市': 'Taiyuan',
    '大同': 'Datong', '大同市': 'Datong',
    '阳泉': 'Yangquan', '阳泉市': 'Yangquan',
    '长治': 'Changzhi', '长治市': 'Changzhi',
    '晋城': 'Jincheng', '晋城市': 'Jincheng',
    '朔州': 'Shuozhou', '朔州市': 'Shuozhou',
    '晋中': 'Jinzhong', '晋中市': 'Jinzhong',
    '运城': 'Yuncheng', '运城市': 'Yuncheng',
    '忻州': 'Xinzhou', '忻州市': 'Xinzhou',
    '临汾': 'Linfen', '临汾市': 'Linfen',
    '吕梁': 'Lvliang', '吕梁市': 'Lvliang',
    
    // 四川省 (Sichuan Province)
    '成都': 'Chengdu', '成都市': 'Chengdu',
    '自贡': 'Zigong', '自贡市': 'Zigong',
    '攀枝花': 'Panzhihua', '攀枝花市': 'Panzhihua',
    '泸州': 'Luzhou', '泸州市': 'Luzhou',
    '德阳': 'Deyang', '德阳市': 'Deyang',
    '绵阳': 'Mianyang', '绵阳市': 'Mianyang',
    '广元': 'Guangyuan', '广元市': 'Guangyuan',
    '遂宁': 'Suining', '遂宁市': 'Suining',
    '内江': 'Neijiang', '内江市': 'Neijiang',
    '乐山': 'Leshan', '乐山市': 'Leshan',
    '南充': 'Nanchong', '南充市': 'Nanchong',
    '眉山': 'Meishan', '眉山市': 'Meishan',
    '宜宾': 'Yibin', '宜宾市': 'Yibin',
    '广安': 'Guangan', '广安市': 'Guangan',
    '达州': 'Dazhou', '达州市': 'Dazhou',
    '雅安': 'Yaan', '雅安市': 'Yaan',
    '巴中': 'Bazhong', '巴中市': 'Bazhong',
    '资阳': 'Ziyang', '资阳市': 'Ziyang',
    
    // 西藏自治区 (Tibet Autonomous Region)
    '拉萨': 'Lhasa', '拉萨市': 'Lhasa',
    '日喀则': 'Shigatse', '日喀则市': 'Shigatse',
    '昌都': 'Chamdo', '昌都市': 'Chamdo',
    '林芝': 'Nyingchi', '林芝市': 'Nyingchi',
    '山南': 'Shannan', '山南市': 'Shannan',
    '那曲': 'Nagqu', '那曲市': 'Nagqu',
    
    // 新疆维吾尔自治区 (Xinjiang Uyghur Autonomous Region)
    '乌鲁木齐': 'Urumqi', '乌鲁木齐市': 'Urumqi',
    '克拉玛依': 'Karamay', '克拉玛依市': 'Karamay',
    '吐鲁番': 'Turpan', '吐鲁番市': 'Turpan',
    '哈密': 'Hami', '哈密市': 'Hami',
    
    // 云南省 (Yunnan Province)
    '昆明': 'Kunming', '昆明市': 'Kunming',
    '曲靖': 'Qujing', '曲靖市': 'Qujing',
    '玉溪': 'Yuxi', '玉溪市': 'Yuxi',
    '保山': 'Baoshan', '保山市': 'Baoshan',
    '昭通': 'Zhaotong', '昭通市': 'Zhaotong',
    '丽江': 'Lijiang', '丽江市': 'Lijiang',
    '普洱': 'Puer', '普洱市': 'Puer',
    '临沧': 'Lincang', '临沧市': 'Lincang',
    
    // 浙江省 (Zhejiang Province)
    '杭州': 'Hangzhou', '杭州市': 'Hangzhou',
    '宁波': 'Ningbo', '宁波市': 'Ningbo',
    '温州': 'Wenzhou', '温州市': 'Wenzhou',
    '绍兴': 'Shaoxing', '绍兴市': 'Shaoxing',
    '湖州': 'Huzhou', '湖州市': 'Huzhou',
    '嘉兴': 'Jiaxing', '嘉兴市': 'Jiaxing',
    '金华': 'Jinhua', '金华市': 'Jinhua',
    '衢州': 'Quzhou', '衢州市': 'Quzhou',
    '舟山': 'Zhoushan', '舟山市': 'Zhoushan',
    '台州': 'Taizhou', '台州市': 'Taizhou',
    '丽水': 'Lishui', '丽水市': 'Lishui',
    
    // 特殊地区和难命中的地名
    '墨脱': '墨脱县', '墨脱县': '墨脱县',
    'Motuo': 'Motuo', 'Medog': 'Medog',
    
    // === 全球一线城市 (Alpha++ & Alpha+) ===
    // Alpha++
    'London': 'London', '伦敦': 'London',
    'New York': 'New York', '纽约': 'New York',
    
    // Alpha+
    'Dubai': 'Dubai', '迪拜': 'Dubai',
    'Hong Kong': 'Hong Kong', '香港': 'Hong Kong',
    'Paris': 'Paris', '巴黎': 'Paris',
    'Singapore': 'Singapore', '新加坡': 'Singapore',
    'Sydney': 'Sydney', '悉尼': 'Sydney',
    'Tokyo': 'Tokyo', '东京': 'Tokyo',
    
    // === 全球二线城市 (Alpha) ===
    'Amsterdam': 'Amsterdam', '阿姆斯特丹': 'Amsterdam',
    'Bangkok': 'Bangkok', '曼谷': 'Bangkok',
    'Chicago': 'Chicago', '芝加哥': 'Chicago',
    'Frankfurt': 'Frankfurt', '法兰克福': 'Frankfurt',
    'Guangzhou': 'Guangzhou', '广州': 'Guangzhou',
    'Istanbul': 'Istanbul', '伊斯坦布尔': 'Istanbul',
    'Jakarta': 'Jakarta', '雅加达': 'Jakarta',
    'Kuala Lumpur': 'Kuala Lumpur', '吉隆坡': 'Kuala Lumpur',
    'Los Angeles': 'Los Angeles', '洛杉矶': 'Los Angeles',
    'Madrid': 'Madrid', '马德里': 'Madrid',
    'Mexico City': 'Mexico City', '墨西哥城': 'Mexico City',
    'Milan': 'Milan', '米兰': 'Milan',
    'Mumbai': 'Mumbai', '孟买': 'Mumbai',
    'São Paulo': 'São Paulo', '圣保罗': 'São Paulo',
    'Seoul': 'Seoul', '首尔': 'Seoul',
    'Toronto': 'Toronto', '多伦多': 'Toronto',
    'Warsaw': 'Warsaw', '华沙': 'Warsaw',
    
    // === 全球三线城市 (Beta+) ===
    'Athens': 'Athens', '雅典': 'Athens',
    'Atlanta': 'Atlanta', '亚特兰大': 'Atlanta',
    'Auckland': 'Auckland', '奥克兰': 'Auckland',
    'Barcelona': 'Barcelona', '巴塞罗那': 'Barcelona',
    'Bengaluru': 'Bengaluru', '班加罗尔': 'Bengaluru',
    'Bogotá': 'Bogotá', '波哥大': 'Bogotá',
    'Bucharest': 'Bucharest', '布加勒斯特': 'Bucharest',
    'Budapest': 'Budapest', '布达佩斯': 'Budapest',
    'Chengdu': 'Chengdu', '成都': 'Chengdu',
    'Dallas': 'Dallas', '达拉斯': 'Dallas',
    'Doha': 'Doha', '多哈': 'Doha',
    'Hamburg': 'Hamburg', '汉堡': 'Hamburg',
    'Hangzhou': 'Hangzhou', '杭州': 'Hangzhou',
    'Ho Chi Minh City': 'Ho Chi Minh City', '胡志明市': 'Ho Chi Minh City',
    'Lima': 'Lima', '利马': 'Lima',
    'Miami': 'Miami', '迈阿密': 'Miami',
    'Montreal': 'Montreal', '蒙特利尔': 'Montreal',
    'Prague': 'Prague', '布拉格': 'Prague',
    'Rome': 'Rome', '罗马': 'Rome',
    'Tianjin': 'Tianjin', '天津': 'Tianjin',
    
    // === 全球三线城市 (Beta) ===
    'Abu Dhabi': 'Abu Dhabi', '阿布扎比': 'Abu Dhabi',
    'Brisbane': 'Brisbane', '布里斯班': 'Brisbane',
    'Cairo': 'Cairo', '开罗': 'Cairo',
    'Calgary': 'Calgary', '卡尔加里': 'Calgary',
    'Chongqing': 'Chongqing', '重庆': 'Chongqing',
    'Copenhagen': 'Copenhagen', '哥本哈根': 'Copenhagen',
    'Dalian': 'Dalian', '大连': 'Dalian',
    'Geneva': 'Geneva', '日内瓦': 'Geneva',
    'Hanoi': 'Hanoi', '河内': 'Hanoi',
    'Jinan': 'Jinan', '济南': 'Jinan',
    'Kyiv': 'Kyiv', '基辅': 'Kyiv',
    'Manama': 'Manama', '麦纳麦': 'Manama',
    'Manila': 'Manila', '马尼拉': 'Manila',
    'Nairobi': 'Nairobi', '内罗毕': 'Nairobi',
    'Nanjing': 'Nanjing', '南京': 'Nanjing',
    'Oslo': 'Oslo', '奥斯陆': 'Oslo',
    'Perth': 'Perth', '珀斯': 'Perth',
    'Shenyang': 'Shenyang', '沈阳': 'Shenyang',
    'Suzhou': 'Suzhou', '苏州': 'Suzhou',
    'Tel Aviv': 'Tel Aviv', '特拉维夫': 'Tel Aviv',
    'Wuhan': 'Wuhan', '武汉': 'Wuhan',
    'Xiamen': 'Xiamen', '厦门': 'Xiamen',
    'Zhengzhou': 'Zhengzhou', '郑州': 'Zhengzhou',
    
    // === 全球三线城市 (Beta-) ===
    'Beirut': 'Beirut', '贝鲁特': 'Beirut',
    'Belgrade': 'Belgrade', '贝尔格莱德': 'Belgrade',
    'Bratislava': 'Bratislava', '布拉迪斯拉发': 'Bratislava',
    'Caracas': 'Caracas', '加拉加斯': 'Caracas',
    'Casablanca': 'Casablanca', '卡萨布兰卡': 'Casablanca',
    'Changsha': 'Changsha', '长沙': 'Changsha',
    'Chennai': 'Chennai', '钦奈': 'Chennai',
    'Denver': 'Denver', '丹佛': 'Denver',
    'Hefei': 'Hefei', '合肥': 'Hefei',
    'Helsinki': 'Helsinki', '赫尔辛基': 'Helsinki',
    'Karachi': 'Karachi', '卡拉奇': 'Karachi',
    'Kunming': 'Kunming', '昆明': 'Kunming',
    'Lagos': 'Lagos', '拉各斯': 'Lagos',
    'Lyon': 'Lyon', '里昂': 'Lyon',
    'Manchester': 'Manchester', '曼彻斯特': 'Manchester',
    'Montevideo': 'Montevideo', '蒙得维的亚': 'Montevideo',
    'Nicosia': 'Nicosia', '尼科西亚': 'Nicosia',
    'Panama City': 'Panama City', '巴拿马城': 'Panama City',
    'Philadelphia': 'Philadelphia', '费城': 'Philadelphia',
    'Port Louis': 'Port Louis', '路易港': 'Port Louis',
    'Qingdao': 'Qingdao', '青岛': 'Qingdao',
    'Rio de Janeiro': 'Rio de Janeiro', '里约热内卢': 'Rio de Janeiro',
    'Seattle': 'Seattle', '西雅图': 'Seattle',
    'Sofia': 'Sofia', '索菲亚': 'Sofia',
    'Stuttgart': 'Stuttgart', '斯图加特': 'Stuttgart',
    'Vancouver': 'Vancouver', '温哥华': 'Vancouver',
    "Xi'an": "Xi'an", '西安': "Xi'an",
    'Zagreb': 'Zagreb', '萨格勒布': 'Zagreb',
    
    // === 其他重要国际城市 ===
    'Zurich': 'Zurich', '苏黎世': 'Zurich',
    'Brussels': 'Brussels', '布鲁塞尔': 'Brussels',
    'Moscow': 'Moscow', '莫斯科': 'Moscow',
    'Boston': 'Boston', '波士顿': 'Boston',
    'San Francisco': 'San Francisco', '旧金山': 'San Francisco',
    'Washington': 'Washington', '华盛顿': 'Washington',
    'Berlin': 'Berlin', '柏林': 'Berlin',
    'Munich': 'Munich', '慕尼黑': 'Munich',
    'Vienna': 'Vienna', '维也纳': 'Vienna',
    'Stockholm': 'Stockholm', '斯德哥尔摩': 'Stockholm',
    'Lisbon': 'Lisbon', '里斯本': 'Lisbon',
    'Edinburgh': 'Edinburgh', '爱丁堡': 'Edinburgh',
    'Dublin': 'Dublin', '都柏林': 'Dublin',
    'Tel Aviv': 'Tel Aviv', '特拉维夫': 'Tel Aviv',
    'Riyadh': 'Riyadh', '利雅得': 'Riyadh',
    'Kuwait City': 'Kuwait City', '科威特城': 'Kuwait City',
    'Taipei': 'Taipei', '台北': 'Taipei',
    'Osaka': 'Osaka', '大阪': 'Osaka',
    'Yokohama': 'Yokohama', '横滨': 'Yokohama',
    'Busan': 'Busan', '釜山': 'Busan',
    'Kolkata': 'Kolkata', '加尔各答': 'Kolkata',
    'Delhi': 'Delhi', '德里': 'Delhi',
    'Hyderabad': 'Hyderabad', '海得拉巴': 'Hyderabad',
    'Pune': 'Pune', '浦那': 'Pune',
    'Ahmedabad': 'Ahmedabad', '艾哈迈达巴德': 'Ahmedabad'
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