# 彼岩（Biyan）

中文 · [English](README.md) · [日本語](README.ja.md)

彼岩是一款跨平台桌面 AI 客户端，面向云端模型 Provider 和 OpenAI-compatible 服务。应用基于 Tauri、Rust、React 与 TypeScript 构建，对话和应用设置保存在本机。

## 主要能力

- 支持 OpenAI、Anthropic、Google、Azure OpenAI、Groq、Mistral AI、OpenRouter、Hugging Face Inference 以及兼容的自定义服务。
- 支持项目、助手、图片、文档附件、MCP 工具、Web Research，以及仅代理远程 Provider 的本地 API 网关。
- 支持从旧 Mita、Silence 和 Jan 衍生版本平稳迁移本地对话与配置。

彼岩**不再下载或运行本地大模型**。旧 llama.cpp、MLX、Foundation Models、模型 Hub、RAG、Embedding 和向量数据库运行时均已退役。

## 图片与文档

- 图片只会发送给已选择且支持图片输入的 Provider/模型。
- Provider 支持原生文件输入时，彼岩使用其文件接口发送附件。
- 否则，彼岩在本机提取文档完整文本，并将文本加入请求。
- 文件超过 20 MB，或完整内容无法容纳在 Provider/模型上下文中时，彼岩会阻止发送并说明原因，不会静默截断或自动摘要。

云端 Provider 会处理请求中包含的内容。发送敏感信息前，请先阅读所选 Provider 的数据政策。

## 快速开始

1. 从[彼岩官网](https://biyan.ai/)安装应用。
2. 打开 **设置 → 模型 Provider**。
3. 配置 Provider 和 API Key，然后在聊天中选择其模型。

详细文档位于 [docs.biyan.ai](https://docs.biyan.ai/)。

## 从源码构建

需要 Node.js 20+、通过 Corepack 使用的 Yarn 4.5.3、Rust/Cargo、Make 和对应平台的 Tauri 构建工具。

```bash
git clone https://github.com/realerikk0/Mita.git
cd Mita
corepack enable
yarn install
yarn dev
```

常用检查：

```bash
yarn test
yarn test:web
yarn build:web
yarn build:tauri
```

## 旧版本迁移

正式升级路径为 **当前版本 → A → B → C**。每个后续版本也都永久携带完整的累计迁移器，因此长期离线用户直接安装较新版本时，仍会按顺序执行缺失的数据迁移。

迁移会把受支持的数据复制到彼岩标准数据目录，完成校验后再原子切换。旧源目录、已下载的本地模型以及旧 RAG/向量数据不会被修改或自动删除。清理前请阅读[数据迁移指南](https://docs.biyan.ai/docs/desktop/data-folder)。

## 支持

如需帮助，请发送邮件至 [help@biyan.ai](mailto:help@biyan.ai)。请勿主动附上 API Key、完整日志、私密提示词或原始文档。

## 上游与许可证

彼岩衍生自 Jan 桌面技术栈，保留原始版权、许可证与上游署名；历史基线记录在 [UPSTREAM_JAN_COMMIT.md](UPSTREAM_JAN_COMMIT.md)。

适用条款请查看 [LICENSE](LICENSE) 和各包的许可证文件。
