# Mita 构建与分发流程

本文档固定 Mita 桌面端的正式构建、GitHub Release、阿里云 OSS/CDN、百度网盘兜底分发和飞书群通知流程。

## 当前流水线

正式发布由两条 GitHub Actions 串联完成：

1. `Desktop Release`
   - 触发方式：推送 `v*` tag，例如 `v0.6.606`。
   - 发布前检查：tag 版本必须与 `src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的产品版本一致，否则流水线直接失败。
   - 构建内容：macOS universal `.dmg`、Windows x64 `.exe` 和 `.msi`。
   - 输出结果：基于上一个 release tag 到当前 tag 的 commit message 生成结构化 release notes，创建 GitHub Draft Release，并上传三个安装包。

2. `Release Distribution`
   - 触发方式：GitHub Release 从 Draft 发布为正式 Release 后自动触发。
   - 分发内容：下载 GitHub Release 中的 `.dmg`、`.exe`、`.msi`。
   - 发布海报：基于 GitHub Release notes 中的“新增功能 / 问题修复 / 优化调整”列表调用井陉 `gpt-image-2` 生成新版本宣传海报。
   - 百度网盘：上传到 `/Mita/releases/<tag>/`，创建长期公开分享链接，作为国内直链异常时的兜底入口。
   - CDN 下载入口：将 `.dmg`、`.exe`、`.msi` 同步到阿里云 OSS，并发布 `latest.json` 和 `/mita/download` 到阿里云 CDN；下载页会按用户系统跳转到最新 macOS 或 Windows 安装包。
   - 飞书通知：飞书应用机器人主动发送到指定群；第一条是固定格式消息卡片，卡片中包含本次更新和问题修复摘要；第二条是“宣传图：”文本，第三条是单独的新版本宣传海报图片。如果海报生成或上传失败，降级为只发送第一条无图卡片。

旧的 `Tauri Builder - Tag` 已改为仅手动触发，不再响应 tag push，避免与 `Desktop Release` 双重构建。

## GitHub Environment

`Release Distribution` job 绑定到 GitHub Environment：

```text
release-distribution
```

必需 secrets：

```text
BAIDUPCS_GO_COOKIES
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_RELEASE_CHAT_ID
ALIYUN_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET
```

建议 secrets：

```text
BAIDU_SHARE_PASSWORD
JINGXING_API_KEY
FEISHU_RELEASE_WEBHOOK
FEISHU_RELEASE_SECRET
```

备用百度登录 secrets：

```text
BAIDUPCS_GO_BDUSS
BAIDUPCS_GO_STOKEN
BAIDUPCS_GO_PTOKEN
```

Environment variables：

```text
BAIDUPCS_VERSION=v4.0.1
BAIDU_REMOTE_ROOT=/Mita/releases
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

`BAIDUPCS_GO_COOKIES` 是百度网盘网页登录态，可能过期。更新时不要包含最外层引号。
`FEISHU_RELEASE_CHAT_ID` 是目标飞书群会话 ID，通常形如 `oc_...`；也可以放在 environment variable 中。`FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 用于获取租户 token、上传海报图片以及由应用机器人主动发送卡片、文本和图片消息。`JINGXING_API_KEY` 用于生成飞书发布海报；如果缺失或接口失败，流程会降级发送无图卡片。`FEISHU_RELEASE_WEBHOOK` 和 `FEISHU_RELEASE_SECRET` 仅保留为旧 webhook 兜底。`ALIYUN_ACCESS_KEY_ID` 和 `ALIYUN_ACCESS_KEY_SECRET` 用于上传 OSS 对象并刷新阿里云 CDN，建议只授予目标 bucket 写入和 CDN 刷新权限。

默认公开下载入口：

```text
https://static.mitapp.cn/mita/latest.json
https://static.mitapp.cn/mita/download
https://static.mitapp.cn/mita/download/latest.json
```

`/mita/latest.json` 是桌面自动更新入口。`/mita/download` 是官网和控制台可直接使用的“下载最新版本”入口，会按系统跳转到最新 `.dmg` 或 `.exe`。`/mita/download/latest.json` 包含 `platforms.macos.url`、`platforms.windows.url`、`platforms.windowsMsi.url`、`baidu`、`primaryDownload`、`tagName` 和 GitHub 安装包信息；外部站点需要自己控制 UI 时读取它即可。

## 正式发布步骤

1. 确认本地要发布的改动已经提交，并选择下一个版本号，例如 `0.6.617`。

2. 更新产品版本号，检查通过后提交并推送到 `mita-main`：

```bash
yarn release:version 0.6.617
yarn release:check-version 0.6.617
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump desktop release version to 0.6.617"
git push origin mita-main
```

3. 创建并推送同版本 tag：

```bash
git tag v0.6.617
git push origin v0.6.617
```

4. 等待 `Desktop Release` 完成：

```bash
gh run watch --repo realerikk0/Mita <run-id> --exit-status
```

5. 打开 GitHub Draft Release，确认包含以下三个包：

```text
*.dmg
*.exe
*.msi
```

6. 检查 Draft Release 正文。自动生成的结构应包含：

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

如果自动分类不够准确，可以在发布前手动补充或调整这些列表项；飞书卡片和宣传图都会读取这里的列表项。

7. 将 Draft Release 发布为正式 Release。

8. 等待 `Release Distribution` 自动完成。成功后应看到：

```text
Upload assets to Baidu Netdisk
Publish download manifest to Aliyun OSS
Send Feishu release messages
```

两个步骤均为 success。

## 手动补跑分发

如果 GitHub Release 已经发布，但百度上传或飞书通知失败，可以手动补跑：

```bash
gh workflow run "Release Distribution" \
  --repo realerikk0/Mita \
  --ref mita-main \
  -f tag=v0.6.606 \
  -f dry_run=false \
  -f probe_only=false
```

只渲染和校验，不上传、不发飞书：

```bash
gh workflow run "Release Distribution" \
  --repo realerikk0/Mita \
  --ref mita-main \
  -f tag=v0.6.606 \
  -f dry_run=true \
  -f probe_only=false
```

dry-run 产物里的 `feishu-card.json` 是待发送消息 payload 数组；互动卡片应包含“本次更新 / 问题修复”摘要，海报上传成功时应包含三项：互动卡片、`宣传图：` 文本、图片消息。

`dry_run=true` 不会上传百度网盘正式安装包，也不会发布公开 CDN 下载入口。只有正式分发成功创建百度分享链接后，才会刷新 `latest.json`、`/mita/download` 和版本化安装包。

## 百度凭据探针

如果怀疑 `BAIDUPCS_GO_COOKIES` 过期，先跑轻量探针，不上传正式安装包，也不发飞书群消息：

```bash
gh workflow run "Release Distribution" \
  --repo realerikk0/Mita \
  --ref mita-main \
  -f tag=credential-probe \
  -f dry_run=false \
  -f probe_only=true
```

成功标准：

```text
百度帐号登录成功
上传文件成功
shareID
```

## 验收标准

正式发布完成后，需要确认：

- GitHub Release 已发布，不是 Draft。
- GitHub Release 正文包含结构化更新列表，而不是只有 `Full Changelog` 链接。
- Release assets 包含 macOS `.dmg`、Windows `.exe`、Windows `.msi`。
- 百度网盘目录 `/Mita/releases/<tag>/` 下包含同一批安装包。
- 阿里云 CDN 上的 `/mita/latest.json` 已更新为当前 tag，桌面自动更新包指向 `https://static.mitapp.cn/mita/stable/<tag>/...`。
- 阿里云 CDN 上的 `/mita/download/latest.json` 已更新为当前 tag，并且 `/mita/download` 会按系统跳转到最新 macOS 或 Windows 安装包。
- 百度分享链接可作为 fallback 打开，提取码可用。
- 指定 `FEISHU_RELEASE_CHAT_ID` 的飞书群收到应用机器人发送的固定格式卡片，卡片中包含本次更新摘要、GitHub Release 地址和百度网盘地址。
- 如果海报凭据已配置，分发 artifact 中应包含 `release-poster.png`、`release-poster.json`；飞书群随后收到“宣传图：”文本和一条单独的新版本海报图片消息。

## 故障处理

- `BAIDUPCS_GO_COOKIES` 失效：重新从已登录百度网盘网页复制 Cookie，并更新 environment secret。
- BaiduPCS-Go 下载 404：检查 `BAIDUPCS_VERSION` 是否与 GitHub Release 文件名一致，例如 `v4.0.1`。
- 大包上传时间过长：先用 `probe_only=true` 验证凭据，再重跑正式分发。
- 飞书未收到消息：检查 `FEISHU_RELEASE_CHAT_ID` 是否为目标群 `chat_id`，并确认飞书应用机器人已加入该群且拥有发送消息权限；如果使用旧 webhook 兜底，再检查 `FEISHU_RELEASE_WEBHOOK` 和 `FEISHU_RELEASE_SECRET`。
- 飞书没有收到第三条海报图片：检查 `release-poster.json` 中的 `status`、`feishuUploadStatus` 和错误信息；常见原因是缺少 `JINGXING_API_KEY`，或井陉/飞书图片接口暂时失败。
