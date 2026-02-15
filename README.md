# AI Sidekick

一个 Chrome 扩展，在侧边栏同时向多个 AI 模型发送问题，对比回答。

## 支持的模型

- ChatGPT (chatgpt.com)
- Gemini (gemini.google.com)
- Kimi (kimi.moonshot.cn)
- 通义千问 (tongyi.aliyun.com)
- 智谱清言 (chatglm.cn)
- DeepSeek (chat.deepseek.com)

## 功能

- **多模型并发提问** — 选择多个模型，一次发送，同时获取回答
- **列表视图** — 消息按问题分组，模型回答以竖线分组展示
- **对比视图** — Tab 切换式对比，全宽展示每个模型的完整回答
- **反思模式** — 所有模型回答完毕后，一键让各模型综合分析所有回答，求同存异
- **辩论模式** — 选择多个模型进行多轮辩论
- **转发** — 将某个模型的回答转发给其他模型评价
- **导出** — 将对话导出为 Markdown 文件
- **快速模板** — 内置常用 prompt 模板
- **Markdown 渲染** — 支持标题、列表、代码高亮、表格、引用块

## 安装

```bash
npm install
npm run build
```

1. 打开 Chrome → `chrome://extensions/` → 开启开发者模式
2. 点击"加载已解压的扩展程序"，选择 `dist` 目录

## 使用

1. 打开任意支持的 AI 网站标签页（需要先登录）
2. 点击扩展图标打开侧边栏
3. 勾选要同时询问的模型（绿色圆点表示已连接）
4. 输入问题，按 Enter 或点击发送
5. 模型生成中会显示蓝色脉冲指示器，完成后自动停止
6. 所有模型回答完毕后，点击 🔍 按钮进入反思模式

## 开发

```bash
npm run dev      # 启动 Vite 开发服务器
npm run build    # 构建到 dist/
npm run lint     # ESLint 检查
```

## 架构

```
用户输入 → Sidepanel → Background (SEND_PROMPT) → Content Script (INPUT_PROMPT)
                                                         ↓
                                                   DOM 操作 + 发送
                                                         ↓
Content Script (MutationObserver + 文本稳定性检测) → Background → Sidepanel (AI_RESPONSE)
```

- **Background Service Worker** — 消息路由，管理标签页连接状态
- **Content Scripts** — 每个 AI 平台一个，负责输入填充、按钮点击、响应监听
- **Sidepanel** — React 19 + Tailwind CSS，管理 UI 状态和消息展示

## 已知限制

- 各 AI 平台的 DOM 结构可能随更新变化，导致选择器失效
- 部分平台在后台标签页时 MutationObserver 可能延迟触发，通过轮询机制补偿
