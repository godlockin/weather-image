import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WeatherService } from './weatherService.js';

const app = new Hono();

// 启用 CORS
app.use('/*', cors());

// 获取 IP 地理位置
async function getGeoFromIP(ip, ipstackKey) {
  try {
    const url = `http://api.ipstack.com/${ip}?access_key=${ipstackKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.info || 'IP地理位置获取失败');
    }
    
    return {
      city: data.city || 'Shanghai',
      country: data.country_name || 'China',
      latitude: data.latitude,
      longitude: data.longitude
    };
  } catch (error) {
    console.error('IP地理位置获取失败:', error);
    // 失败时返回默认上海
    return { city: 'Shanghai', country: 'China', latitude: 31.2304, longitude: 121.4737 };
  }
}

// 获取客户端真实 IP
function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '8.8.8.8'; // 测试用默认IP
}

// API 路由：获取天气图片
app.get('/api/weather', async (c) => {
  try {
    const ipstackKey = c.env.IPSTACK_API_KEY;
    const geminiKey = c.env.GEMINI_API_KEY;
    
    if (!ipstackKey || !geminiKey) {
      return c.json({ error: 'API密钥未配置' }, 500);
    }

    const weatherService = new WeatherService(geminiKey);
    
    // 获取城市参数，优先用户输入，其次IP定位
    let city = c.req.query('city');
    if (!city) {
      const clientIP = getClientIP(c.req.raw);
      const geo = await getGeoFromIP(clientIP, ipstackKey);
      city = geo.city;
    }

    // 生成天气图片
    const result = await weatherService.processWeatherImage(city);
    
    // 将图片转换为 base64
    const imageBase64 = Buffer.from(result.image).toString('base64');
    
    return c.json({
      success: true,
      city: result.city,
      weatherLine: result.weatherLine,
      prompt: result.prompt,
      image: `data:${result.mimeType};base64,${imageBase64}`
    });
    
  } catch (error) {
    console.error('API处理失败:', error);
    return c.json({ error: error.message || '处理失败' }, 500);
  }
});

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok' }));

// 404 处理
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    console.log('定时任务执行');
  }
};