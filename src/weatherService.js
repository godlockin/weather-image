import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';

export class WeatherService {
  constructor(apiKey) {
    this.genai = new GoogleGenAI({ apiKey });
  }

  async getWeatherPrompt(city) {
    try {
      const promptTemplate = await readFile(
        new URL('../prompt_template.txt', import.meta.url),
        'utf-8'
      );
      const prompt = promptTemplate.replace('{city}', city);

      const { text } = await this.genai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingBudget: -1 }
        }
      });

      return text;
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
        `Top-center English weather text for ${city} today (condition, temp range in °C, with emoji).`;
      
      const imagePrompt = `${prompt}\n\nRENDERING INSTRUCTIONS (CRITICAL):\n- Place the following weather text at the TOP-CENTER as visible typography, high contrast, crisp: "${overlay}"\n- The text must be clearly visible in the final image and not cropped.\n- Keep pure-color background and centered composition.\n- PBR materials, realistic lighting.`;

      const { candidates } = await this.genai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: [{ role: 'user', parts: [{ text: imagePrompt }] }],
        config: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      });

      if (!candidates?.[0]?.content?.parts?.[0]?.inlineData) {
        throw new Error('无法生成图像');
      }

      const imageData = candidates[0].content.parts[0].inlineData;
      return {
        image: imageData.data,
        mimeType: imageData.mimeType,
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