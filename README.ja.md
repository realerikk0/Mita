# Biyan（彼岩）

[中文](README.zh.md) · [English](README.md) · 日本語

Biyan は、クラウドモデル Provider と OpenAI 互換サービスに接続するクロスプラットフォームのデスクトップ AI クライアントです。Tauri、Rust、React、TypeScript を使用し、会話とアプリ設定を端末に保存します。

## 主な機能

- OpenAI、Anthropic、Google、Azure OpenAI、Groq、Mistral AI、OpenRouter、Hugging Face Inference、および互換エンドポイント。
- プロジェクト、アシスタント、画像、文書添付、MCP ツール、Web Research、リモート専用のローカル API ゲートウェイ。
- 以前の Mita、Silence、Jan 派生版からの会話・設定移行。

Biyan はローカル言語モデルをダウンロードまたは実行しません。従来の llama.cpp、MLX、Foundation Models、モデル Hub、RAG、Embedding、ベクトルデータベースのランタイムは廃止されています。

## ファイルと文書

- 画像は、画像入力をサポートする選択済み Provider/モデルにのみ送信されます。
- Provider がネイティブファイル入力をサポートする場合、そのファイル API を使用します。
- それ以外では、文書の全文を端末上で抽出してリクエストに含めます。
- 20 MB を超えるファイル、または全文が Provider/モデルのコンテキスト上限に収まらないファイルは送信を停止します。暗黙の切り捨てや自動要約は行いません。

クラウド Provider はリクエスト内容を処理します。機密情報を送信する前に、選択した Provider のデータポリシーを確認してください。

## はじめに

1. [Biyan ウェブサイト](https://biyan.ai/)からアプリをインストールします。
2. **Settings → Model Providers** を開きます。
3. Provider と API キーを設定し、チャットでモデルを選択します。

詳しい手順は [docs.biyan.ai](https://docs.biyan.ai/) を参照してください。

## ソースからビルド

Node.js 20 以降、Corepack 経由の Yarn 4.5.3、Rust/Cargo、Make、各プラットフォームの Tauri ビルドツールが必要です。

```bash
git clone https://github.com/realerikk0/Mita.git
cd Mita
corepack enable
yarn install
yarn dev
```

## 以前のリリースからの移行

正式なアップグレード順序は **current → A → B → C** です。後続リリースにも累積マイグレーターが含まれるため、長期間オフラインだった場合でも新しい版へ直接移行できます。

移行は対応データを Biyan の標準データ領域へコピーし、検証後にアトミックに切り替えます。旧データ、ダウンロード済みローカルモデル、旧 RAG/ベクトルデータを自動削除しません。

## サポート

お問い合わせは [help@biyan.ai](mailto:help@biyan.ai) までお送りください。API キー、完全なログ、非公開のプロンプト、元文書は添付しないでください。

## アップストリームとライセンス

Biyan は Jan デスクトップスタックから派生しています。元の著作権表示、ライセンス、帰属情報を保持し、履歴上の基準は [UPSTREAM_JAN_COMMIT.md](UPSTREAM_JAN_COMMIT.md) に記録しています。

適用される条件は [LICENSE](LICENSE) と各パッケージのライセンスファイルを参照してください。
