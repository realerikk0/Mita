# Mita 构建与分发流程

本文档固定 Mita 桌面端的正式构建、GitHub Release、百度网盘分发和飞书群通知流程。

## 当前流水线

正式发布由两条 GitHub Actions 串联完成：

1. `Desktop Release`
   - 触发方式：推送 `v*` tag，例如 `v0.6.606`。
   - 构建内容：macOS universal `.dmg`、Windows x64 `.exe` 和 `.msi`。
   - 输出结果：创建 GitHub Draft Release，并上传三个安装包。

2. `Release Distribution`
   - 触发方式：GitHub Release 从 Draft 发布为正式 Release 后自动触发。
   - 分发内容：下载 GitHub Release 中的 `.dmg`、`.exe`、`.msi`。
   - 发布海报：基于 GitHub Release notes 调用井陉 `gpt-image-2` 生成新版本宣传海报。
   - 百度网盘：上传到 `/Mita/releases/<tag>/`，创建长期公开分享链接。
   - 飞书通知：飞书应用机器人主动发送固定格式消息卡片到指定群；如果海报生成和上传成功，卡片顶部会展示海报图片。

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
JINGXING_BASE_URL=https://api.jingxing.io/v1
RELEASE_POSTER_ENABLED=true
RELEASE_POSTER_STRICT=false
```

`BAIDUPCS_GO_COOKIES` 是百度网盘网页登录态，可能过期。更新时不要包含最外层引号。
`FEISHU_RELEASE_CHAT_ID` 是目标飞书群会话 ID，通常形如 `oc_...`；也可以放在 environment variable 中。`FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 用于获取租户 token、上传海报图片以及由应用机器人主动发送卡片。`JINGXING_API_KEY` 用于生成飞书发布海报；如果缺失或接口失败，流程会降级发送无图卡片。`FEISHU_RELEASE_WEBHOOK` 和 `FEISHU_RELEASE_SECRET` 仅保留为旧 webhook 兜底。

## 正式发布步骤

1. 确认本地要发布的改动已经提交并推送到 `mita-main`。

2. 创建并推送新 tag：

```bash
git tag v0.6.606
git push origin v0.6.606
```

3. 等待 `Desktop Release` 完成：

```bash
gh run watch --repo realerikk0/Mita <run-id> --exit-status
```

4. 打开 GitHub Draft Release，确认包含以下三个包：

```text
*.dmg
*.exe
*.msi
```

5. 将 Draft Release 发布为正式 Release。

6. 等待 `Release Distribution` 自动完成。成功后应看到：

```text
Upload assets to Baidu Netdisk
Send Feishu release card
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
- Release assets 包含 macOS `.dmg`、Windows `.exe`、Windows `.msi`。
- 百度网盘目录 `/Mita/releases/<tag>/` 下包含同一批安装包。
- 百度分享链接可打开，提取码可用。
- 指定 `FEISHU_RELEASE_CHAT_ID` 的飞书群收到应用机器人发送的固定格式卡片，卡片中包含 GitHub Release 地址和百度网盘地址。
- 如果海报凭据已配置，分发 artifact 中应包含 `release-poster.png`、`release-poster.json`，且飞书卡片顶部显示新版本海报。

## 故障处理

- `BAIDUPCS_GO_COOKIES` 失效：重新从已登录百度网盘网页复制 Cookie，并更新 environment secret。
- BaiduPCS-Go 下载 404：检查 `BAIDUPCS_VERSION` 是否与 GitHub Release 文件名一致，例如 `v4.0.1`。
- 大包上传时间过长：先用 `probe_only=true` 验证凭据，再重跑正式分发。
- 飞书未收到消息：检查 `FEISHU_RELEASE_CHAT_ID` 是否为目标群 `chat_id`，并确认飞书应用机器人已加入该群且拥有发送消息权限；如果使用旧 webhook 兜底，再检查 `FEISHU_RELEASE_WEBHOOK` 和 `FEISHU_RELEASE_SECRET`。
- 飞书卡片无海报：检查 `release-poster.json` 中的 `status`、`feishuUploadStatus` 和错误信息；常见原因是缺少 `JINGXING_API_KEY`，或井陉/飞书图片接口暂时失败。
