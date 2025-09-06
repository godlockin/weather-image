import { GoogleGenerativeAI } from '@google/generative-ai';

export class WeatherService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async getWeatherPrompt(city) {
    try {
      const promptTemplate = `请为{city}生成详细的今日天气预报，包含以下要素：

天气状况：描述今天的整体天气情况（晴、多云、雨、雪等）
温度范围：最高温度和最低温度（摄氏度）
体感温度：考虑湿度、风速等因素的实际感受温度
湿度：相对湿度百分比
风速风向：风速（km/h）和主要风向
降水概率：降雨或降雪的概率百分比
空气质量：AQI指数和空气质量等级
紫外线指数：UV指数和防晒建议
穿衣建议：根据温度和天气的穿衣推荐
出行建议：是否适合户外活动

请用简洁的中文描述，格式清晰，包含温度数据的行要突出显示摄氏度符号。示例格式：
上海今日天气：多云转晴，15°C~22°C，体感18°C，湿度65%，东北风3级，降水概率20%，空气质量良，适合外出活动。`;
      
      const prompt = promptTemplate.replace('{city}', city);

      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('获取天气信息失败:', error);
      throw new Error('无法获取天气信息');
    }
  }

  extractWeatherLine(text) {
    if (!text) return null;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    // 优先包含摄氏度符号的行
    for (const line of lines) {
      if (line.includes('°C') || line.includes('℃')) {
        return line;
      }
    }
    
    // 正则匹配温度区间
    const tempPatterns = [
      /\b\d+\s*[~～\-]\s*\d+\s*°?C\b/i,
      /\b\d+\s*to\s*\d+\s*°?C\b/i
    ];
    
    for (const line of lines) {
      if (tempPatterns.some(pattern => pattern.test(line))) {
        return line;
      }
    }
    
    return null;
  }

  async generateWeatherImage(prompt, weatherLine, city) {
    try {
      const overlay = weatherLine || 
        `${city}今日天气：晴朗，20°C~25°C，体感舒适，适合外出活动。`;
      
      // 在Cloudflare Workers环境中，直接返回文本描述的图像数据
      // 实际应用中可集成图像生成服务
      return {
        image: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), // 1x1透明像素
        mimeType: 'image/png',
        weatherLine: overlay
      };
    } catch (error) {
      console.error('生成图像失败:', error);
      throw new Error('无法生成天气图像');
    }
  }

  async processWeatherImage(city) {
    const prompt = await this.getWeatherPrompt(city);
    const weatherLine = this.extractWeatherLine(prompt);
    const imageResult = await this.generateWeatherImage(prompt, weatherLine, city);
    
    return {
      city,
      prompt,
      weatherLine: imageResult.weatherLine,
      image: imageResult.image,
      mimeType: imageResult.mimeType
    };
  }
}