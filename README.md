# AI Sidekick

一个浏览器扩展，让你在侧边栏同时向多个 AI 模型发送问题。

## 支持的模型

- ChatGPT (chatgpt.com)
- Gemini (gemini.google.com)
- Kimi (kimi.moonshot.cn)
- 通义千问 (tongyi.aliyun.com)
- 智谱清言 (chatglm.cn)
- DeepSeek (chat.deepseek.com)

## 安装

1. `npm install`
2. `npm run build`
3. 打开 Chrome → `chrome://extensions/` → 开启开发者模式
4. 点击"加载已解压的扩展程序"，选择 `dist` 目录

## 使用

1. 打开任意支持的 AI 网站标签页
2. 点击扩展图标打开侧边栏
3. 勾选要同时询问的模型
4. 输入问题，点击发送

## 已知问题

- 后台标签页的响应更新可能需要手动切换标签页才能触发
