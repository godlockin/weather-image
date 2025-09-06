var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-QLU0Hx/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// _worker.js
var INDEX_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>\u5929\u6C14\u56FE\u50CF\u751F\u6210\u5668</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px} .card{background:#fff;border-radius:16px;padding:24px;max-width:680px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.15)} h1{margin:0 0 16px;color:#333} .row{display:flex;gap:8px;margin:12px 0} input{flex:1;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px} button{padding:12px 18px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:10px;cursor:pointer} .hint{color:#666;margin:8px 0 16px;font-size:14px} .err{display:none;margin-top:12px;background:#fee;color:#c33;padding:10px;border-radius:8px} .err.active{display:block} .res{display:none;margin-top:16px} .res.active{display:block} .meta{color:#666;margin:6px 0} img{max-width:100%;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)}</style></head><body><div class="card"><h1>\u{1F324}\uFE0F \u5929\u6C14\u56FE\u50CF\u751F\u6210\u5668</h1><div class="hint">\u8F93\u5165\u57CE\u5E02\uFF08\u5982\uFF1A\u4E0A\u6D77/\u5317\u4EAC\uFF09\uFF0C\u5C06\u751F\u6210\u5305\u542B\u5730\u6807\u7684\u5929\u6C14\u56FE\u50CF</div><div class="row"><input id="city" placeholder="\u8F93\u5165\u57CE\u5E02\u540D\u79F0"/><button id="go">\u751F\u6210</button></div><div class="err" id="err">\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5</div><div class="res" id="res"><div class="meta" id="cityName"></div><div class="meta" id="weather"></div><img id="img" alt="\u5929\u6C14\u56FE\u50CF"/></div></div><script>const cityInput=document.getElementById('city');const goBtn=document.getElementById('go');const err=document.getElementById('err');const res=document.getElementById('res');const cityName=document.getElementById('cityName');const weather=document.getElementById('weather');const img=document.getElementById('img');async function gen(){err.classList.remove('active');res.classList.remove('active');goBtn.disabled=true;try{const city=cityInput.value.trim();const url='/api/weather'+(city?'?city='+encodeURIComponent(city):'');const r=await fetch(url);const data=await r.json();if(!r.ok||!data||!data.success)throw new Error(data&&data.error||'\u8BF7\u6C42\u5931\u8D25');cityName.textContent='\u57CE\u5E02\uFF1A'+(data.city||'\u672A\u77E5');weather.textContent='\u5929\u6C14\uFF1A'+(data.weatherLine||'');img.src=data.image;res.classList.add('active')}catch(e){console.error(e);err.textContent='\u751F\u6210\u5931\u8D25\uFF1A'+e.message;err.classList.add('active')}finally{goBtn.disabled=false}}goBtn.addEventListener('click',gen);<\/script></body></html>`;
function pickWeatherLine(text) {
  if (!text)
    return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (/°C|℃/.test(l))
      return l;
  }
  for (const l of lines) {
    if (/\b\d+\s*[~～\-]\s*\d+\s*°?C\b/i.test(l))
      return l;
  }
  return lines[0] || null;
}
__name(pickWeatherLine, "pickWeatherLine");
async function callImageModel(prompt, apiKey, modelName) {
  const model = modelName || "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "image/png" } };
  const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    throw new Error(`Image API ${r.status}`);
  }
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
  const data = imgPart?.inlineData?.data;
  if (!data)
    throw new Error("\u65E0\u56FE\u50CF\u6570\u636E");
  return "data:image/png;base64," + data;
}
__name(callImageModel, "callImageModel");
function weatherCodeText(code) {
  const m = {
    0: "\u6674\u6717",
    1: "\u5927\u81F4\u6674\u6717",
    2: "\u5C40\u90E8\u591A\u4E91",
    3: "\u591A\u4E91",
    45: "\u6709\u96FE",
    48: "\u6C89\u79EF\u96FE",
    51: "\u5C0F\u6BDB\u6BDB\u96E8",
    53: "\u4E2D\u6BDB\u6BDB\u96E8",
    55: "\u5927\u6BDB\u6BDB\u96E8",
    56: "\u5C0F\u51BB\u6BDB\u6BDB\u96E8",
    57: "\u5927\u51BB\u6BDB\u6BDB\u96E8",
    61: "\u5C0F\u96E8",
    63: "\u4E2D\u96E8",
    65: "\u5927\u96E8",
    66: "\u51BB\u96E8",
    67: "\u5F3A\u51BB\u96E8",
    71: "\u5C0F\u96EA",
    73: "\u4E2D\u96EA",
    75: "\u5927\u96EA",
    77: "\u96EA\u7C92",
    80: "\u5C0F\u9635\u96E8",
    81: "\u4E2D\u9635\u96E8",
    82: "\u5F3A\u9635\u96E8",
    85: "\u5C0F\u9635\u96EA",
    86: "\u5F3A\u9635\u96EA",
    95: "\u96F7\u9635\u96E8",
    96: "\u96F7\u9635\u96E8\u4F34\u51B0\u96F9",
    99: "\u5F3A\u96F7\u96E8\u4F34\u51B0\u96F9"
  };
  return m[code] || "\u591A\u4E91";
}
__name(weatherCodeText, "weatherCodeText");
function weatherCodeTextEn(code) {
  const m = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Heavy drizzle",
    56: "Light freezing drizzle",
    57: "Heavy freezing drizzle",
    61: "Light rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers",
    81: "Moderate showers",
    82: "Heavy showers",
    85: "Light snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail"
  };
  return m[code] || "Cloudy";
}
__name(weatherCodeTextEn, "weatherCodeTextEn");
function weatherCodeIcon(code) {
  if (code === 0 || code === 1)
    return "\u2600\uFE0F";
  if (code === 2)
    return "\u{1F324}\uFE0F";
  if (code === 3)
    return "\u2601\uFE0F";
  if (code === 45 || code === 48)
    return "\u{1F32B}\uFE0F";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return "\u{1F327}\uFE0F";
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return "\u{1F328}\uFE0F";
  if ([95, 96, 99].includes(code))
    return "\u26C8\uFE0F";
  return "\u2601\uFE0F";
}
__name(weatherCodeIcon, "weatherCodeIcon");
async function getRealtimeWeather(city) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
    const gr = await fetch(geoUrl);
    if (!gr.ok)
      throw new Error("geo");
    const gj = await gr.json();
    const loc = gj?.results?.[0];
    if (!loc)
      return null;
    const { latitude, longitude, name } = loc;
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    const wr = await fetch(wUrl);
    if (!wr.ok)
      throw new Error("wx");
    const wj = await wr.json();
    const tCur = wj?.current?.temperature_2m;
    const code = wj?.current?.weather_code;
    const tMax = Array.isArray(wj?.daily?.temperature_2m_max) ? wj.daily.temperature_2m_max[0] : void 0;
    const tMin = Array.isArray(wj?.daily?.temperature_2m_min) ? wj.daily.temperature_2m_min[0] : void 0;
    const zh = weatherCodeText(code);
    const zhLine = typeof tCur === "number" && zh ? `${name || city} ${zh}\uFF0C${Math.round(tCur)}\xB0C` : null;
    const en = weatherCodeTextEn(code);
    const icon = weatherCodeIcon(code);
    let enHeader;
    if (typeof tMax === "number" && typeof tMin === "number") {
      enHeader = `${en}, ${Math.round(tMin)}\uFF5E${Math.round(tMax)}\xB0C ${icon}`;
    } else if (typeof tCur === "number") {
      enHeader = `${en}, ${Math.round(tCur)}\xB0C ${icon}`;
    } else {
      enHeader = `${en} ${icon}`;
    }
    return { zhLine, enHeader, code, name, tCur, tMax, tMin };
  } catch (_) {
    return null;
  }
}
__name(getRealtimeWeather, "getRealtimeWeather");
function buildImagePromptStrict(city, enHeader, landmarksZh) {
  const header = (enHeader || "").trim();
  const lm = (landmarksZh || "").trim();
  return `${header}
\u8FD9\u662F\u4E00\u5EA7\u4EE5\u7B49\u8DDD\u5FAE\u7F29\u6A21\u578B\u5C55\u73B0\u7684${city}\u7279\u8272\u5EFA\u7B51\u573A\u666F\uFF0C\u4EE5\u6E05\u6670\u768445\u5EA6\u4FEF\u89C6\u89D2\u5EA6\uFF0C\u5DE7\u5999\u5730\u878D\u5408\u5F53\u5929\u771F\u5B9E\u5929\u6C14\u6548\u679C\u3002\u6574\u4E2A\u753B\u9762\u91C7\u7528\u57FA\u4E8E\u7269\u7406\u7684\u771F\u5B9E\u611F\u6E32\u67D3\uFF08PBR\uFF09\u4E0E\u903C\u771F\u7684\u5149\u7167\uFF0C\u80CC\u666F\u4E3A\u7EAF\u8272\u4EE5\u4FDD\u6301\u6E05\u6670\u7B80\u6D01\u3002\u5C45\u4E2D\u6784\u56FE\u4EE5\u51F8\u663E\u4E09\u7EF4\u6A21\u578B\u7CBE\u51C6\u800C\u7EC6\u817B\u7684\u8D28\u611F\u3002
\u573A\u666F\u9700\u8981\u5305\u542B\u8BE5\u57CE\u5E02\u7684\u6807\u5FD7\u6027\u5EFA\u7B51\uFF08\u53EF\u53C2\u8003\uFF1A${lm || "\u8BE5\u57CE\u5E02\u6700\u5177\u4EE3\u8868\u6027\u7684\u5730\u6807"}\uFF09\uFF0C\u5EFA\u7B51\u6BD4\u4F8B\u534F\u8C03\u3001\u9519\u843D\u6709\u81F4\uFF0C\u5448\u73B0\u5177\u6709\u57CE\u5E02\u8FA8\u8BC6\u5EA6\u7684\u5929\u9645\u7EBF\u6216\u6838\u5FC3\u5730\u6807\u3002\u6750\u8D28\u8868\u73B0\u9700\u771F\u5B9E\uFF0C\u5982\u73BB\u7483\u5E55\u5899\u53CD\u5C04\u3001\u91D1\u5C5E\u4E0E\u77F3\u6750\u7EB9\u7406\u7B49\u3002
\u5929\u6C14\u6548\u679C\u4E0E\u57CE\u5E02\u73AF\u5883\u8F7B\u67D4\u4E92\u52A8\uFF08\u5982\u4E91\u5F71\u3001\u5149\u7167\u65B9\u5411\u4E0E\u5F3A\u5EA6\u3001\u5730\u9762\u53CD\u5C04\u4E0E\u73AF\u5883\u5149\uFF09\uFF0C\u6574\u4F53\u8272\u5F69\u67D4\u548C\u4F46\u5177\u6709\u5C42\u6B21\u3002\u753B\u9762\u4E2D\u4E0D\u8981\u51FA\u73B0\u6587\u5B57\u4E0E\u4EBA\u7269\uFF0C\u4EC5\u4FDD\u7559\u5EFA\u7B51\u4E0E\u73AF\u5883\u8981\u7D20\u3002`;
}
__name(buildImagePromptStrict, "buildImagePromptStrict");
function wrapWithHeaderSVG(pngDataUri, enHeader) {
  const w = 1280, h = 720, headH = 88;
  const bg = "#ffffff";
  const text = "#111";
  const esc = /* @__PURE__ */ __name((s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), "esc");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
  <rect width='100%' height='100%' fill='${bg}'/>
  <rect x='0' y='0' width='100%' height='${headH}' fill='#f7f7fb'/>
  <text x='50%' y='56' text-anchor='middle' font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size='28' fill='${text}' font-weight='600'>${esc(enHeader)}</text>
  <image x='0' y='${headH}' width='${w}' height='${h - headH}' preserveAspectRatio='xMidYMid slice' href='${pngDataUri}'/>
</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
__name(wrapWithHeaderSVG, "wrapWithHeaderSVG");
function svgImageStrict(city, enHeader) {
  const w = 1280, h = 720, headH = 88;
  const fg = "#333", accent = "#667eea";
  const esc = /* @__PURE__ */ __name((s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), "esc");
  const bodyY = headH + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#fafaff"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="0" y="0" width="100%" height="${headH}" fill="#f7f7fb"/>
  <text x="50%" y="56" text-anchor="middle" fill="#111" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="28" font-weight="600">${esc(enHeader || "Weather")}</text>
  <rect x="40" y="${bodyY}" rx="18" ry="18" width="${w - 80}" height="${h - headH - 80}" fill="url(#g)" stroke="#e5e7ff"/>
  <g transform="translate(180, ${bodyY + 160})"><circle cx="0" cy="0" r="60" fill="#ffd166" opacity="0.9"/></g>
  <g transform="translate(280, ${bodyY + 200})"><rect x="0" y="-120" width="100" height="120" fill="#c8d0ff"/><rect x="22" y="-100" width="16" height="80" fill="#fff" opacity=".6"/><rect x="62" y="-100" width="16" height="80" fill="#fff" opacity=".6"/></g>
  <text x="50%" y="${h - 110}" text-anchor="middle" fill="${fg}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="34" font-weight="600">${esc(city)}</text>
  <text x="50%" y="${h - 70}" text-anchor="middle" fill="${accent}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="24">Isometric micro-city scene with PBR lighting</text>
</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
__name(svgImageStrict, "svgImageStrict");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/api/weather") {
      try {
        const city = (url.searchParams.get("city") || "\u4E0A\u6D77").trim();
        const apiKey = env.GEMINI_API_KEY;
        const textModel = env.TEXT_MODEL || "gemini-1.5-pro";
        const imageModel = env.IMAGE_MODEL || "gemini-1.5-flash";
        const real = await getRealtimeWeather(city);
        const realWeatherLine = real?.zhLine || null;
        const weatherHeaderEn = real?.enHeader || null;
        let summary = "";
        if (!apiKey) {
          summary = `${realWeatherLine || city + " \u4ECA\u65E5\u591A\u4E91\uFF0C16\xB0C~22\xB0C\u3002"}
\u6807\u5FD7\u6027\u5EFA\u7B51\uFF1A\u57CE\u5E02\u5730\u6807\u3002
\u5EFA\u8BAE\uFF1A\u9002\u5408\u6B65\u884C\u89C2\u666F\u3002`;
        } else {
          const hint = realWeatherLine ? `\uFF08\u5DF2\u77E5\u5F53\u524D\u5929\u6C14\uFF1A${realWeatherLine}\uFF09` : "";
          const prompt = `\u8BF7\u57FA\u4E8E\u516C\u5F00\u5E38\u8BC6\uFF0C\u4E3A\u201C${city}\u201D\u751F\u6210\u201C\u4ECA\u65E5\u5929\u6C14\u4E0E\u6807\u5FD7\u6027\u5EFA\u7B51\u201D\u7684\u603B\u7ED3\u3002${hint}
\u8981\u6C42\uFF1A
- \u4E2D\u6587\u8F93\u51FA\uFF0C\u4FE1\u606F\u7CBE\u70BC\u53EF\u4FE1
- \u7B2C\u4E00\u884C\u7ED9\u51FA\u5929\u6C14\u4E00\u53E5\u8BDD\u6458\u8981\uFF0C\u542B\u6E29\u5EA6\uFF08\xB0C\uFF09
- \u7B2C\u4E8C\u884C\u7ED9\u51FA\u5F53\u5730\u6807\u5FD7\u6027\u5EFA\u7B51\uFF081-2\u5904\uFF09
- \u7B2C\u4E09\u884C\u7ED9\u51FA\u4E00\u53E5\u65C5\u884C\u5EFA\u8BAE
\u8BF7\u4E25\u683C\u53EA\u8F93\u51FA\u4E09\u884C\u6587\u672C\u3002`;
          try {
            const model = textModel;
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const body2 = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
            const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body2) });
            if (!r.ok)
              throw new Error("Text API");
            const j = await r.json();
            const parts = j?.candidates?.[0]?.content?.parts || [];
            summary = parts.map((p) => p.text || "").join("").trim();
            if (!summary)
              throw new Error("\u7A7A\u54CD\u5E94");
          } catch (e) {
            summary = `${realWeatherLine || city + " \u4ECA\u65E5\u591A\u4E91\uFF0C16\xB0C~22\xB0C\u3002"}
\u6807\u5FD7\u6027\u5EFA\u7B51\uFF1A\u5916\u6EE9\u3002
\u5EFA\u8BAE\uFF1A\u9002\u5408\u6B65\u884C\u89C2\u666F\u3002`;
          }
        }
        const weatherLine = pickWeatherLine(summary) || realWeatherLine || `${city} \u4ECA\u65E5\u591A\u4E91 16\xB0C~22\xB0C`;
        const summaryLines = (summary || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const landmarksLine = (summaryLines[1] || "").replace(/^标志性建筑[：:]\s*/, "");
        const imagePrompt = buildImagePromptStrict(city, weatherHeaderEn || "", landmarksLine);
        let image;
        if (!apiKey) {
          image = svgImageStrict(city, weatherHeaderEn || "");
        } else {
          try {
            const pngUri = await callImageModel(imagePrompt, apiKey, imageModel);
            image = wrapWithHeaderSVG(pngUri, weatherHeaderEn || "");
          } catch (_) {
            image = svgImageStrict(city, weatherHeaderEn || "");
          }
        }
        const body = { success: true, city, weatherLine, summary, image, usedFallback: !apiKey, realWeatherLine };
        return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message || "\u5904\u7406\u5931\u8D25" }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("Not Found", { status: 404 });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-QLU0Hx/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-QLU0Hx/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=bundledWorker-0.9321140302648939.mjs.map
