# Mita 构建与分发流程

本文档固定 Mita 桌面端的正式构建、GitHub Release、阿里云 OSS/CDN 下载入口和飞书群通知流程。

## 当前流水线

正式发布由两条 GitHub Actions 串联完成：

1. `Desktop Release`
   - 触发方式：推送 `v*` tag，例如 `v0.6.623`。
   - 发布前检查：tag 版本必须与 `src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的产品版本一致，否则流水线直接失败。
   - 构建内容：macOS universal `.dmg`、Windows x64 `.exe` 和 `.msi`。
   - macOS 正式签名：使用 `Developer ID Application: LILYN DYNAMICS (7NZP53ZJ4D)`，构建前签名资源目录和 universal target 中的 nested Mach-O 二进制，构建后验证 `.app` 与 `.dmg` 的签名、公证和 stapled ticket。
   - 自动更新：同步 Tauri updater 产物到阿里云 OSS/CDN，更新 `https://static.mitapp.cn/mita/latest.json`。
   - GitHub Release：基于上一个 release tag 到当前 tag 的 commit message 生成结构化 release notes，创建 GitHub Draft Release，并上传三个安装包。

2. `Release Distribution`
   - 触发方式：GitHub Release 从 Draft 发布为正式 Release 后自动触发；也可以手动补跑。
   - 分发内容：下载 GitHub Release 中的 `.dmg`、`.exe`、`.msi`。
   - 发布海报：基于 GitHub Release notes 中的“新增功能 / 问题修复 / 优化调整”列表调用井陉 `gpt-image-2` 生成新版本宣传海报。
   - CDN 下载入口：将 `.dmg`、`.exe`、`.msi` 同步到阿里云 OSS，并发布 `latest.json` 和 `/mita/download` 到阿里云 CDN；下载页会按用户系统跳转到最新 macOS 或 Windows 安装包。
   - 飞书通知：飞书应用机器人主动发送到指定群；第一条是固定格式消息卡片，卡片中包含本次更新、问题修复摘要、GitHub Release 和 CDN 下载入口；第二条是“宣传图：”文本，第三条是单独的新版本宣传海报图片。如果海报生成或上传失败，降级为只发送第一条无图卡片。

旧的 `Tauri Builder - Tag` 已改为仅手动触发，不再响应 tag push，避免与 `Desktop Release` 双重构建。

## GitHub Environment

两条 workflow 的发布相关 job 绑定到 GitHub Environment：

```text
release-distribution
```

`Desktop Release` 必需 secrets：

```text
CODE_SIGN_P12_BASE64
CODE_SIGN_P12_PASSWORD
NOTARIZE_P8_BASE64
NOTARY_ISSUER
NOTARY_KEY_ID
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
MITA_SIGNING_KEY
ALIYUN_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ZONE_ID
CLOUDFLARE_R2_BUCKET
```

`Release Distribution` 必需 secrets：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_RELEASE_CHAT_ID
ALIYUN_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET
```

可选 secrets：

```text
JINGXING_API_KEY
FEISHU_RELEASE_WEBHOOK
FEISHU_RELEASE_SECRET
```

Environment variables：

```text
ALIYUN_REGION=cn-hangzhou
ALIYUN_OSS_BUCKET=mita-static
ALIYUN_OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
ALIYUN_CDN_DOMAIN=static.mitapp.cn
UPDATES_CDN_BASE_URL=https://static.mitapp.cn
MITA_DOWNLOAD_MANIFEST_KEY=mita/download/latest.json
MITA_DOWNLOAD_PAGE_KEY=mita/download
MITA_DOWNLOAD_VERSION_ROOT=mita/download/releases
JINGXING_BASE_URL=https://api.jingxing.io/v1
RELEASE_POSTER_ENABLED=true
RELEASE_POSTER_STRICT=false
```

`CODE_SIGN_P12_BASE64` 和 `CODE_SIGN_P12_PASSWORD` 是 LILYN DYNAMICS 的 Developer ID Application 证书；`NOTARIZE_P8_BASE64`、`NOTARY_ISSUER`、`NOTARY_KEY_ID` 是 Apple notarization API key。`TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 用于 Tauri updater 签名。`CLOUDFLARE_*` secrets 用于把 legacy updater manifest 同步到 `updates.mita.so`。`FEISHU_RELEASE_CHAT_ID` 是目标飞书群会话 ID，通常形如 `oc_...`；也可以放在 environment variable 中。`FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 用于获取租户 token、上传海报图片以及由应用机器人主动发送卡片、文本和图片消息。`JINGXING_API_KEY` 用于生成飞书发布海报；如果缺失或接口失败，流程会降级发送无图卡片。`FEISHU_RELEASE_WEBHOOK` 和 `FEISHU_RELEASE_SECRET` 仅保留为旧 webhook 兜底。`ALIYUN_ACCESS_KEY_ID` 和 `ALIYUN_ACCESS_KEY_SECRET` 用于上传 OSS 对象并刷新阿里云 CDN，建议只授予目标 bucket 写入和 CDN 刷新权限。

默认公开下载入口：

```text
https://static.mitapp.cn/mita/latest.json
https://static.mitapp.cn/mita/download
https://static.mitapp.cn/mita/download/latest.json
```

`/mita/latest.json` 是桌面自动更新入口。`/mita/download` 是官网和控制台可直接使用的“下载最新版本”入口，会按系统跳转到最新 `.dmg` 或 `.exe`。`/mita/download/latest.json` 包含 `platforms.macos.url`、`platforms.windows.url`、`platforms.windowsMsi.url`、`primaryDownload`、`tagName` 和 GitHub 安装包信息；外部站点需要自己控制 UI 时读取它即可。

## 正式发布步骤

1. 确认本地要发布的改动已经提交，并选择下一个版本号，例如 `0.6.623`。

2. 更新产品版本号，检查通过后提交并推送到 `mita-main`：

```bash
yarn release:version 0.6.623
yarn release:check-version 0.6.623
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump desktop release version to 0.6.623"
git push origin mita-main
```

3. 创建并推送同版本 tag：

```bash
git tag v0.6.623
git push origin v0.6.623
```

4. 等待 `Desktop Release` 完成：

```bash
gh run watch --repo realerikk0/Mita <run-id> --exit-status
```

如果 `Desktop Release` 失败，先判断失败类型：

- 代码、workflow、签名配置或公证流程本身有问题：修复后 bump 到下一个 patch 版本，重新推送新的 `v*` tag；不要复用、强推或移动已经推送过的 release tag。
- GitHub runner、Apple notary 网络或临时服务故障，例如 `NSURLErrorDomain Code=-1009`：可以只重跑失败 job。

```bash
gh run rerun --repo realerikk0/Mita <run-id> --failed
```

5. 验证 macOS 正式签名和公证。`build-macos` 日志里必须看到：

- `scripts/sign-macos-binaries.mjs` 完成 nested Mach-O 签名，尤其是 `src-tauri/resources/computer-agent-runner/mita-computer-agent-runner` 和 `src-tauri/target/universal-apple-darwin/release/mita-computer-agent-runner`。
- `Notarize macOS DMGs` 对 `.dmg` 完成 `notarytool submit --wait`、`stapler staple` 和 `stapler validate`。
- `Verify macOS signing and notarization` 对 `.app` 完成 `codesign --verify --deep --strict` 和 `stapler validate`，并对 `.dmg` 完成 `stapler validate`。

6. 验证自动更新 CDN 与 legacy updater：

```bash
curl -fsS https://static.mitapp.cn/mita/latest.json -o /tmp/mita-latest-aliyun.json
curl -fsS https://updates.mita.so/mita/latest.json -o /tmp/mita-latest-legacy.json
jq -r '.version' /tmp/mita-latest-aliyun.json /tmp/mita-latest-legacy.json
cmp -s /tmp/mita-latest-aliyun.json /tmp/mita-latest-legacy.json
jq '.platforms' /tmp/mita-latest-aliyun.json
```

确认两个 manifest 的版本号都为当前发布版本，并且 byte-identical。macOS 和 Windows updater URL 都应指向 `https://static.mitapp.cn/mita/stable/<tag>/...`。这个检查保证当前版本和仍读取 `updates.mita.so` 的更早版本客户端都能收到自动更新。

7. 打开 GitHub Draft Release，确认包含以下三个包：

```text
*.dmg
*.exe
*.msi
```

8. 检查 Draft Release 正文。自动生成的结构应包含：

```markdown
## 新增功能

- ...

## 问题修复

- ...

## 优化调整

- ...

## 完整变更

https://github.com/realerikk0/Mita/compare/<previous-tag>...<current-tag>
```

发布为正式 Release 前，必须把“新增功能 / 问题修复 / 优化调整”的列表项整理成简体中文；如果自动分类不够准确，可以手动补充或调整。飞书卡片和宣传图都会读取这里的列表项，所以不要在正式发布后才改正文。

9. 将 Draft Release 发布为正式 Release。

10. 等待 `Release Distribution` 自动完成。成功后应看到：

```text
Publish download manifest to Aliyun OSS
Send Feishu release messages
```

两个步骤均为 success。

11. 验证用户下载 CDN：

```bash
curl -fsS https://static.mitapp.cn/mita/download/latest.json | jq '.tagName, .primaryDownload, .platforms'
curl -fsSI https://static.mitapp.cn/mita/download
```

确认 `tagName` 为当前 tag，`primaryDownload.type` 为 `aliyun-cdn`，macOS/Windows/MSI URL 都指向 `https://static.mitapp.cn/mita/download/releases/<tag>/...`。

## 手动补跑分发

如果 GitHub Release 已经发布，但 CDN 下载入口或飞书通知失败，可以手动补跑：

```bash
gh workflow run "Release Distribution" \
  --repo realerikk0/Mita \
  --ref mita-main \
  -f tag=v0.6.623 \
  -f dry_run=false
```

只渲染和校验，不上传 OSS、不刷新 CDN、不发飞书：

```bash
gh workflow run "Release Distribution" \
  --repo realerikk0/Mita \
  --ref mita-main \
  -f tag=v0.6.623 \
  -f dry_run=true
```

dry-run 产物里的 `feishu-card.json` 是待发送消息 payload 数组；互动卡片应包含“本次更新 / 问题修复”摘要，海报上传成功时应包含三项：互动卡片、`宣传图：` 文本、图片消息。

## 官网和控制台下载配置

jingxing.io 快速开始页面和控制台首页不要硬编码具体版本号或安装包文件名。

推荐配置：

```text
下载最新版：https://static.mitapp.cn/mita/download
结构化下载源：https://static.mitapp.cn/mita/download/latest.json
```

如果页面只有一个“下载桌面版”按钮，直接链接到 `/mita/download`。如果页面需要展示“下载 macOS / 下载 Windows / 下载 MSI”三个按钮，则服务端或前端读取 `/mita/download/latest.json`，使用：

```text
platforms.macos.url
platforms.windows.url
platforms.windowsMsi.url
tagName
version
```

这样每次发布新版本后，页面会自动拿到最新安装包，不需要改 jingxing.io 或控制台代码。

## 验收标准

正式发布完成后，需要确认：

- GitHub Release 已发布，不是 Draft。
- GitHub Release 正文包含结构化更新列表，而不是只有 `Full Changelog` 链接。
- GitHub Release 正文中的更新内容已经整理为简体中文；如果需要宣传图，`release-poster.json` 的 `status` 应为 `generated`。
- Release assets 包含 macOS `.dmg`、Windows `.exe`、Windows `.msi`。
- macOS `build-macos` 日志显示 nested binaries 已签名，`.app` 和 `.dmg` 都通过签名、公证和 stapled ticket 验证。
- 阿里云 CDN 上的 `/mita/latest.json` 已更新为当前 tag，桌面自动更新包指向 `https://static.mitapp.cn/mita/stable/<tag>/...`。
- legacy updater `https://updates.mita.so/mita/latest.json` 已更新为当前 tag，并且与阿里云 CDN 上的 `/mita/latest.json` byte-identical。
- 阿里云 CDN 上的 `/mita/download/latest.json` 已更新为当前 tag，并且 `/mita/download` 会按系统跳转到最新 macOS 或 Windows 安装包。
- 指定 `FEISHU_RELEASE_CHAT_ID` 的飞书群收到应用机器人发送的固定格式卡片，卡片中包含本次更新摘要、GitHub Release 地址和 CDN 下载地址。
- 如果海报凭据已配置，分发 artifact 中应包含 `release-poster.png`、`release-poster.json`；飞书群随后收到“宣传图：”文本和一条单独的新版本海报图片消息。

## 故障处理

- release tag 已推送后发现 workflow 或代码问题：不要移动或强推旧 tag；修复后 bump 下一个 patch 版本重新发。只有明确是临时基础设施问题时，才对同一个 run 使用 `gh run rerun --failed`。
- Apple notary 出现 `NSURLErrorDomain Code=-1009` 或类似网络错误：通常是临时网络/服务问题，优先重跑失败 job；如果仍失败，再检查 notary credentials 和 Apple 服务状态。
- `mita-computer-agent-runner: code object is not signed at all`：确认 `scripts/sign-macos-binaries.mjs` 同时签名资源目录里的 runner 和 `src-tauri/target/universal-apple-darwin/release/mita-computer-agent-runner`，并且 `make build` 仍在 Tauri 构建前执行该脚本。
- `.dmg` 没有 stapled ticket：确认 `Notarize macOS DMGs` 在上传 artifact 前运行，并且对每个 `.dmg` 都执行 `notarytool submit --wait`、`stapler staple`、`stapler validate`。
- 老版本用户没有自动更新提示：同时核对 `https://static.mitapp.cn/mita/latest.json` 和 `https://updates.mita.so/mita/latest.json`，两个 manifest 必须版本一致且 byte-identical。
- 阿里云上传失败：检查 `ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`、`ALIYUN_OSS_BUCKET`、`ALIYUN_OSS_ENDPOINT`，以及 RAM 权限是否允许写入目标 bucket 和刷新 CDN。
- CDN HEAD 校验失败：先确认 OSS 对象是否已上传，再检查 CDN 回源私有 OSS 鉴权、缓存刷新和 `UPDATES_CDN_BASE_URL`。
- 飞书未收到消息：检查 `FEISHU_RELEASE_CHAT_ID` 是否为目标群 `chat_id`，并确认飞书应用机器人已加入该群且拥有发送消息权限；如果使用旧 webhook 兜底，再检查 `FEISHU_RELEASE_WEBHOOK` 和 `FEISHU_RELEASE_SECRET`。
- 飞书没有收到第三条海报图片：检查 `release-poster.json` 中的 `status`、`feishuUploadStatus` 和错误信息；常见原因是缺少 `JINGXING_API_KEY`，或井陉/飞书图片接口暂时失败。
