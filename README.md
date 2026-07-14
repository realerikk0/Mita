# Biyan (彼岩)

[中文](README.zh.md) · [日本語](README.ja.md) · English

Biyan is a cross-platform desktop AI client for working with cloud and OpenAI-compatible model providers. It is built with Tauri, Rust, React, and TypeScript and keeps conversations and application settings on your device.

## What Biyan supports

- Cloud providers including OpenAI, Anthropic, Google, Azure OpenAI, Groq, Mistral AI, OpenRouter, Hugging Face Inference, and compatible custom endpoints.
- Projects, assistants, images, document attachments, MCP tools, web research, and a remote-only local API gateway.
- Local conversation storage and controlled migration from earlier Mita, Silence, and Jan-derived installations.

Biyan does **not** download or run local language models. The former llama.cpp, MLX, Foundation Models, model Hub, RAG, embedding, and vector-database runtimes have been retired.

## Files and documents

- Images are sent only to a selected provider/model that supports image input.
- If a provider supports native file input, Biyan sends the attachment through that provider's file interface.
- Otherwise Biyan extracts the full document text locally and includes it in the request.
- Biyan blocks the send when a file exceeds 20 MB or cannot fit within the provider/model context limit. It does not silently truncate or summarize the document.

Cloud providers process the content included in their requests. Review the selected provider's data policy before sending sensitive information.

## Getting started

1. Install Biyan from the [Biyan website](https://biyan.ai/).
2. Open **Settings → Model Providers**.
3. Configure a provider and API key, then select one of its models in a chat.

Detailed instructions are available at [docs.biyan.ai](https://docs.biyan.ai/).

## Build from source

### Requirements

- Node.js 20 or later
- Yarn 4.5.3 via Corepack
- Rust and Cargo
- Make
- Platform build tools for Tauri

```bash
git clone https://github.com/realerikk0/Mita.git
cd Mita
corepack enable
yarn install
yarn dev
```

Common checks:

```bash
yarn test
yarn test:web
yarn build:web
yarn build:tauri
```

## Upgrading from an earlier release

The supported upgrade train is **current → A → B → C**. Each later release also carries the complete cumulative migrator, so a user who was offline may install a later version directly.

Migration copies supported data into Biyan's canonical data location, validates it, and switches atomically. It does not modify or automatically delete the old source directory, downloaded local models, or former RAG/vector data. See the [data migration guide](https://docs.biyan.ai/docs/desktop/data-folder) before cleaning up old files.

## Support

For help, email [help@biyan.ai](mailto:help@biyan.ai). Do not include API keys, full logs, private prompts, or original documents unless specifically requested through a trusted support channel.

## Upstream and license

Biyan is derived from the Jan desktop stack. Original copyright notices, licenses, and attribution are retained; the historical baseline is recorded in [UPSTREAM_JAN_COMMIT.md](UPSTREAM_JAN_COMMIT.md).

See [LICENSE](LICENSE) and package-level license files for the applicable terms.
