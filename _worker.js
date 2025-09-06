// Single-file Cloudflare Worker (Pages-compatible) serving UI and API

// Minimal HTML UI
const INDEX_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>天气图像生成器</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px} .card{background:#fff;border-radius:16px;padding:24px;max-width:680px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.15)} h1{margin:0 0 16px;color:#333} .row{display:flex;gap:8px;margin:12px 0} input{flex:1;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px} button{padding:12px 18px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:10px;cursor:pointer} .hint{color:#666;margin:8px 0 16px;font-size:14px} .err{display:none;margin-top:12px;background:#fee;color:#c33;padding:10px;border-radius:8px} .err.active{display:block} .res{display:none;margin-top:16px} .res.active{display:block} .meta{color:#666;margin:6px 0} img{max-width:100%;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.12)}</style></head><body><div class="card"><h1>🌤️ 天气图像生成器</h1><div class="hint">输入城市（如：上海/北京），将生成包含地标的天气图像</div><div class="row"><input id="city" placeholder="输入城市名称"/><button id="go">生成</button></div><div class="err" id="err">生成失败，请重试</div><div class="res" id="res"><div class="meta" id="cityName"></div><div class="meta" id="weather"></div><img id="img" alt="天气图像"/></div></div><script>const cityInput=document.getElementById('city');const goBtn=document.getElementById('go');const err=document.getElementById('err');const res=document.getElementById('res');const cityName=document.getElementById('cityName');const weather=document.getElementById('weather');const img=document.getElementById('img');async function gen(){err.classList.remove('active');res.classList.remove('active');goBtn.disabled=true;try{const city=cityInput.value.trim();const url='/api/weather'+(city?'?city='+encodeURIComponent(city):'');const r=await fetch(url);const data=await r.json();if(!r.ok||!data||!data.success)throw new Error(data&&data.error||'请求失败');cityName.textContent='城市：'+(data.city||'未知');weather.textContent='天气：'+(data.weatherLine||'');img.src=data.image;res.classList.add('active')}catch(e){console.error(e);err.textContent='生成失败：'+e.message;err.classList.add('active')}finally{goBtn.disabled=false}}goBtn.addEventListener('click',gen);</script></body></html>`;

function pickWeatherLine(text){ if(!text) return null; const lines=text.split('\n').map(l=>l.trim()).filter(Boolean); for(const l of lines){ if(/°C|℃/.test(l)) return l } for(const l of lines){ if(/\b\d+\s*[~～\-]\s*\d+\s*°?C\b/i.test(l)) return l } return lines[0]||null }

function svgImage(city, weatherLine){ const title=weatherLine||`${city} 今日天气良好`; const fg='#333'; const accent='#667eea'; const w=1024,h=576; const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#fafaff"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><g transform="translate(0,0)"><circle cx="180" cy="160" r="60" fill="#ffd166" opacity="0.9"/><circle cx="230" cy="180" r="12" fill="#fff" opacity="0.9"/><circle cx="250" cy="170" r="18" fill="#fff" opacity="0.9"/><circle cx="270" cy="180" r="14" fill="#fff" opacity="0.9"/></g><g transform="translate(120,380)"><rect x="0" y="-160" width="80" height="160" fill="#b3c0ff"/><polygon points="40,-220 80,-160 0,-160" fill="#99aaff"/></g><g transform="translate(260,400)"><rect x="0" y="-120" width="100" height="120" fill="#c8d0ff"/><rect x="22" y="-100" width="16" height="80" fill="#fff" opacity=".6"/><rect x="62" y="-100" width="16" height="80" fill="#fff" opacity=".6"/></g><text x="50%" y="65%" text-anchor="middle" fill="${fg}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="34" font-weight="600">${city}</text><text x="50%" y="75%" text-anchor="middle" fill="${accent}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="28">${title}</text></svg>`; return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) }

async function callTextModel(city, apiKey, modelName){ const model = modelName || 'gemini-1.5-pro'; const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`; const prompt = `请基于公开常识，为“${city}”生成“今日天气与标志性建筑”的总结，要求：\n- 中文输出，信息精炼可信\n- 第一行给出天气一句话摘要，含温度区间（°C）\n- 第二行给出当地标志性建筑（1-2处）\n- 第三行给出一句旅行建议\n请严格只输出三行文本。`; const body = { contents: [{ role: 'user', parts: [{ text: prompt }]}] }; const r = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)}); if(!r.ok){ throw new Error(`Text API ${r.status}`) } const j = await r.json(); const parts = j?.candidates?.[0]?.content?.parts || []; const text = parts.map(p=>p.text||'').join('').trim(); if(!text) throw new Error('空响应'); return text }

async function callImageModel(prompt, apiKey, modelName){ const model = modelName || 'gemini-1.5-flash'; const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`; const body = { contents: [{ role:'user', parts:[{ text: prompt }]}], generationConfig: { responseMimeType: 'image/png' } }; const r = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)}); if(!r.ok){ throw new Error(`Image API ${r.status}`) } const j = await r.json(); const parts = j?.candidates?.[0]?.content?.parts || []; const imgPart = parts.find(p=>p.inlineData && p.inlineData.data); const data = imgPart?.inlineData?.data; if(!data) throw new Error('无图像数据'); return 'data:image/png;base64,' + data }

async function getRealtimeWeatherLine(city){
  try{
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
    const gr = await fetch(geoUrl);
    if(!gr.ok) throw new Error('geo');
    const gj = await gr.json();
    const loc = gj?.results?.[0];
    if(!loc) return null;
    const { latitude, longitude, name, country_code } = loc;
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`;
    const wr = await fetch(wUrl);
    if(!wr.ok) throw new Error('wx');
    const wj = await wr.json();
    const t = wj?.current?.temperature_2m;
    const code = wj?.current?.weather_code;
    const txt = weatherCodeText(code);
    if(typeof t === 'number' && txt){
      return `${name || city} ${txt}，${Math.round(t)}°C`;
    }
    return null;
  }catch(_){ return null }
}

function weatherCodeText(code){
  const m = {
    0:'晴朗', 1:'大致晴朗', 2:'局部多云', 3:'多云',
    45:'有雾', 48:'沉积雾', 51:'小毛毛雨', 53:'中毛毛雨', 55:'大毛毛雨',
    56:'小冻毛毛雨', 57:'大冻毛毛雨', 61:'小雨', 63:'中雨', 65:'大雨',
    66:'冻雨', 67:'强冻雨', 71:'小雪', 73:'中雪', 75:'大雪',
    77:'雪粒', 80:'小阵雨', 81:'中阵雨', 82:'强阵雨',
    85:'小阵雪', 86:'强阵雪', 95:'雷阵雨', 96:'雷阵雨伴冰雹', 99:'强雷雨伴冰雹'
  };
  return m[code] || '多云';
}

// 新增：英文天气文案与图标映射
function weatherCodeTextEn(code){
  const m = {
    0:'Clear', 1:'Mostly clear', 2:'Partly cloudy', 3:'Cloudy',
    45:'Fog', 48:'Depositing rime fog', 51:'Light drizzle', 53:'Moderate drizzle', 55:'Heavy drizzle',
    56:'Light freezing drizzle', 57:'Heavy freezing drizzle', 61:'Light rain', 63:'Moderate rain', 65:'Heavy rain',
    66:'Freezing rain', 67:'Heavy freezing rain', 71:'Light snow', 73:'Moderate snow', 75:'Heavy snow',
    77:'Snow grains', 80:'Light showers', 81:'Moderate showers', 82:'Heavy showers',
    85:'Light snow showers', 86:'Heavy snow showers', 95:'Thunderstorm', 96:'Thunderstorm with hail', 99:'Severe thunderstorm with hail'
  };
  return m[code] || 'Cloudy';
}
function weatherCodeIcon(code){
  if(code===0||code===1) return '☀️';
  if(code===2) return '🌤️';
  if(code===3) return '☁️';
  if(code===45||code===48) return '🌫️';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return '🌧️';
  if([71,73,75,77,85,86].includes(code)) return '🌨️';
  if([95,96,99].includes(code)) return '⛈️';
  return '☁️';
}

// 新增：获取含 min/max 的实时天气，并构造英文抬头
async function getRealtimeWeather(city){
  try{
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
    const gr = await fetch(geoUrl);
    if(!gr.ok) throw new Error('geo');
    const gj = await gr.json();
    const loc = gj?.results?.[0];
    if(!loc) return null;
    const { latitude, longitude, name } = loc;
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    const wr = await fetch(wUrl);
    if(!wr.ok) throw new Error('wx');
    const wj = await wr.json();
    const tCur = wj?.current?.temperature_2m;
    const code = wj?.current?.weather_code;
    const tMax = Array.isArray(wj?.daily?.temperature_2m_max) ? wj.daily.temperature_2m_max[0] : undefined;
    const tMin = Array.isArray(wj?.daily?.temperature_2m_min) ? wj.daily.temperature_2m_min[0] : undefined;
    const zh = weatherCodeText(code);
    const zhLine = (typeof tCur==='number' && zh) ? `${name || city} ${zh}，${Math.round(tCur)}°C` : null;
    const en = weatherCodeTextEn(code);
    const icon = weatherCodeIcon(code);
    let enHeader;
    if(typeof tMax==='number' && typeof tMin==='number'){
      enHeader = `${en}, ${Math.round(tMin)}～${Math.round(tMax)}°C ${icon}`;
    } else if (typeof tCur==='number'){
      enHeader = `${en}, ${Math.round(tCur)}°C ${icon}`;
    } else {
      enHeader = `${en} ${icon}`;
    }
    return { zhLine, enHeader, code, name, tCur, tMax, tMin };
  }catch(_){ return null }
}

// 新增：严格模板化图像生成提示词（等距微缩模型 + PBR + 英文抬头）
function buildImagePromptStrict(city, enHeader, landmarksZh){
  const header = (enHeader||'').trim();
  const lm = (landmarksZh||'').trim();
  return `${header}\n这是一座以等距微缩模型展现的${city}特色建筑场景，以清晰的45度俯视角度，巧妙地融合当天真实天气效果。整个画面采用基于物理的真实感渲染（PBR）与逼真的光照，背景为纯色以保持清晰简洁。居中构图以凸显三维模型精准而细腻的质感。\n场景需要包含该城市的标志性建筑（可参考：${lm||'该城市最具代表性的地标'}），建筑比例协调、错落有致，呈现具有城市辨识度的天际线或核心地标。材质表现需真实，如玻璃幕墙反射、金属与石材纹理等。\n天气效果与城市环境轻柔互动（如云影、光照方向与强度、地面反射与环境光），整体色彩柔和但具有层次。画面中不要出现文字与人物，仅保留建筑与环境要素。`;
}

// 新增：将 PNG 图像与英文抬头进行 SVG 叠加，确保抬头稳定呈现在图片上方
function wrapWithHeaderSVG(pngDataUri, enHeader){
  const w=1280, h=720, headH=88; const bg='#ffffff'; const text='#111';
  const esc = (s)=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
  <rect width='100%' height='100%' fill='${bg}'/>
  <rect x='0' y='0' width='100%' height='${headH}' fill='#f7f7fb'/>
  <text x='50%' y='56' text-anchor='middle' font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size='28' fill='${text}' font-weight='600'>${esc(enHeader)}</text>
  <image x='0' y='${headH}' width='${w}' height='${h-headH}' preserveAspectRatio='xMidYMid slice' href='${pngDataUri}'/>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// 新增：严格回退 SVG（含英文抬头）
function svgImageStrict(city, enHeader){
  const w=1280,h=720,headH=88; const fg='#333', accent='#667eea';
  const esc=(s)=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const bodyY= headH + 40;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#fafaff"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="0" y="0" width="100%" height="${headH}" fill="#f7f7fb"/>
  <text x="50%" y="56" text-anchor="middle" fill="#111" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="28" font-weight="600">${esc(enHeader||'Weather')}</text>
  <rect x="40" y="${bodyY}" rx="18" ry="18" width="${w-80}" height="${h-headH-80}" fill="url(#g)" stroke="#e5e7ff"/>
  <g transform="translate(180, ${bodyY+160})"><circle cx="0" cy="0" r="60" fill="#ffd166" opacity="0.9"/></g>
  <g transform="translate(280, ${bodyY+200})"><rect x="0" y="-120" width="100" height="120" fill="#c8d0ff"/><rect x="22" y="-100" width="16" height="80" fill="#fff" opacity=".6"/><rect x="62" y="-100" width="16" height="80" fill="#fff" opacity=".6"/></g>
  <text x="50%" y="${h-110}" text-anchor="middle" fill="${fg}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="34" font-weight="600">${esc(city)}</text>
  <text x="50%" y="${h-70}" text-anchor="middle" fill="${accent}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial" font-size="24">Isometric micro-city scene with PBR lighting</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if(url.pathname === '/'){
      return new Response(INDEX_HTML,{ headers:{ 'content-type':'text/html; charset=utf-8' } });
    }
    if(url.pathname === '/api/weather'){
      try{
        const city = (url.searchParams.get('city')||'上海').trim();
        const apiKey = env.GEMINI_API_KEY;
        const textModel = env.TEXT_MODEL || 'gemini-1.5-pro';
        const imageModel = env.IMAGE_MODEL || 'gemini-1.5-flash';

        // 先尝试获取真实天气（含英文抬头）
        const real = await getRealtimeWeather(city);
        const realWeatherLine = real?.zhLine || null;
        const weatherHeaderEn = real?.enHeader || null;

        let summary = '';
        if(!apiKey){
          summary = `${realWeatherLine || (city+' 今日多云，16°C~22°C。')}\n标志性建筑：城市地标。\n建议：适合步行观景。`;
        } else {
          const hint = realWeatherLine ? `（已知当前天气：${realWeatherLine}）` : '';
          const prompt = `请基于公开常识，为“${city}”生成“今日天气与标志性建筑”的总结。${hint}\n要求：\n- 中文输出，信息精炼可信\n- 第一行给出天气一句话摘要，含温度（°C）\n- 第二行给出当地标志性建筑（1-2处）\n- 第三行给出一句旅行建议\n请严格只输出三行文本。`;
          try {
            const model = textModel;
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const body = { contents: [{ role: 'user', parts: [{ text: prompt }]}] };
            const r = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)});
            if(!r.ok) throw new Error('Text API');
            const j = await r.json();
            const parts = j?.candidates?.[0]?.content?.parts || [];
            summary = parts.map(p=>p.text||'').join('').trim();
            if(!summary) throw new Error('空响应');
          } catch(e){
            summary = `${realWeatherLine || (city+' 今日多云，16°C~22°C。')}\n标志性建筑：外滩。\n建议：适合步行观景。`;
          }
        }

        const weatherLine = pickWeatherLine(summary) || realWeatherLine || `${city} 今日多云 16°C~22°C`;

        // 从总结中抽取“标志性建筑”行
        const summaryLines = (summary||'').split('\n').map(s=>s.trim()).filter(Boolean);
        const landmarksLine = (summaryLines[1]||'').replace(/^标志性建筑[：:]\s*/, '');

        // 严格模板的图像提示词
        const imagePrompt = buildImagePromptStrict(city, weatherHeaderEn || '', landmarksLine);

        let image;
        if(!apiKey){
          image = svgImageStrict(city, weatherHeaderEn || '');
        } else {
          try{
            const pngUri = await callImageModel(imagePrompt, apiKey, imageModel);
            image = wrapWithHeaderSVG(pngUri, weatherHeaderEn || '');
          }
          catch(_){ image = svgImageStrict(city, weatherHeaderEn || '') }
        }

        const body = { success:true, city, weatherLine, summary, image, usedFallback: !apiKey, realWeatherLine };
        return new Response(JSON.stringify(body),{ headers:{'content-type':'application/json'} });
      }catch(e){
        return new Response(JSON.stringify({success:false,error:e.message||'处理失败'}),{ status:500, headers:{'content-type':'application/json'} });
      }
    }
    return new Response('Not Found',{ status:404 });
  }
};