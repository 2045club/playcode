# Playcode （WEB CODEX & CLAUDE）

![新会话](readme/screenshot1.png)

English version: [README.md](./README.md)

Playcode 一个集成了 Codex SDK 和 Claude AGENT SDK 的web终端，可以运行在windows , mac , linux 环境。不依赖本地的codex cli 和 claude code cli 。支持在 Windows、macOS、Linux 等常见 Node.js 运行环境中部署和使用

本项目参考codex app 界面设计，体验和codex app一样的交互效果。

## 适合什么场景

- 想要同时使用codex和claude的场景
- 想要使用多个provider的场景
- 突破大模型并发限制，支持大量会话的场景
- Linux服务器部署codex和claude的场景

## 主要能力
- 在一个项目中，能够同时使用codex和claude进行会话。
- 支持使用多个provider。并提供Provider负载能力，支持设置单个Provider同时执行会话数量。
- 添加任意本地目录作为项目
- 按项目维护多个会话，查看消息、运行状态、token 用量和历史记录
- Codex 与 Claude 可以在同一工作区内并行运行
- 配置多个 Codex / Claude Provider，按需启用、切换默认值和调整模型
- 为单个 Codex Provider 设置并发上限，避免某个 Provider 被过量任务挤满

## 技术栈
- Nodejs
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- SQLite

模型调用默认通过服务端 SDK 直接完成，不要求预先安装 Codex CLI 或 Claude CLI。Provider 的 API key、base URL、模型和并发策略都可以在应用的设置页里配置。

## 快速开始

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

首次访问时会进入登录页。如果数据库中还没有管理员账号，系统会自动切换到初始化流程，先创建管理员，再进入工作区。

## 常见使用流程

1. 先完成管理员初始化或登录
2. 在设置页配置系统连接、Codex Provider 和 Claude Provider
3. 将本地目录添加为项目
4. 在项目下创建一个或多个会话
5. 根据任务类型选择 Codex 或 Claude 继续推进
6. 需要时查看 Git 信息、文件预览和变更回放

## 常用脚本

- `npm run dev` - 本地开发
- `npm run build` - 构建生产版本
- `npm run start` - 启动生产版本
- `npm run lint` - ESLint 检查
- `npm run typecheck` - TypeScript 类型检查