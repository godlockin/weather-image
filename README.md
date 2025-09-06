# 天气图像生成器

这个脚本整合了Gemini 2.5 Pro和Gemini 2.5 Flash Image，可以自动获取城市天气信息并生成对应的等距微缩模型场景图像。

## 功能特点

- **自动天气获取**: 使用Gemini 2.5 Pro联网获取实时天气信息
- **智能Prompt生成**: 基于天气信息生成详细的图像生成prompt
- **高质量图像生成**: 使用Gemini 2.5 Flash Image生成等距微缩模型场景
- **日期管理**: 按日期自动保存生成的图像文件
- **多城市支持**: 支持生成不同城市的天气图像

## 安装要求

```bash
pip install google-genai
```

## 使用方法

### 1. 设置API密钥

在运行脚本前，需要设置Gemini API密钥：

```bash
export GEMINI_API_KEY="your_api_key_here"
```

### 2. 运行脚本

默认生成上海的天气图像：
```bash
python weather_image_generator.py
```

指定其他城市：
```bash
python weather_image_generator.py 北京
```

### 3. 输出结果

生成的图像会自动保存到`weather_images/`目录下，文件名格式为：
```
{city}_{YYYYMMDD}_{index}.png
```

例如：
```
上海_20240905_0.png
北京_20240905_0.png
```

## 工作流程

1. **天气信息获取**: 脚本首先调用Gemini 2.5 Pro，联网获取指定城市的实时天气信息
2. **Prompt生成**: 基于获取的天气信息，生成详细的图像生成prompt，包含：
   - 当前天气状况（温度、天气类型、图标）
   - 城市标志性建筑描述
   - 等距微缩模型场景要求
   - PBR渲染和光照效果要求
3. **图像生成**: 使用生成的prompt调用Gemini 2.5 Flash Image生成图像
4. **文件保存**: 将生成的图像按日期和城市分类保存

## 图像特点

生成的图像具有以下特点：
- 等距微缩模型视角（45度俯视）
- 基于物理的真实渲染（PBR）
- 纯色背景，突出模型细节
- 居中构图
- 包含天气信息英文显示
- 融合天气效果与城市场景

## 注意事项

- 确保网络连接正常，以便获取实时天气信息
- API密钥需要有效的Gemini API访问权限
- 生成的图像质量和数量取决于API响应
- 建议在稳定的网络环境下运行，避免API调用超时

## 文件结构

```
.
├── weather_image_generator.py    # 主脚本
├── sample_2.5_pro.py           # Gemini 2.5 Pro示例脚本
├── sample_nano.py              # Gemini 2.5 Flash Image示例脚本
├── weather_images/             # 生成的图像保存目录
│   ├── 上海_20240905_0.png
│   └── 北京_20240905_0.png
└── README.md                   # 使用说明
```