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
   - 百度网盘：上传到 `/Mita/releases/<tag>/`，创建长期公开分享链接。
   - 飞书通知：发送固定格式消息卡片到飞书群，包含 GitHub Release 地址、GitHub 安装包地址、百度网盘地址和提取码。

旧的 `Tauri Builder - Tag` 已改为仅手动触发，不再响应 tag push，避免与 `Desktop Release` 双重构建。

## GitHub Environment

`Release Distribution` job 绑定到 GitHub Environment：

```text
release-distribution
```

必需 secrets：

```text
BAIDUPCS_GO_COOKIES
FEISHU_RELEASE_WEBHOOK
```

建议 secrets：

```text
BAIDU_SHARE_PASSWORD
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
```

`BAIDUPCS_GO_COOKIES` 是百度网盘网页登录态，可能过期。更新时不要包含最外层引号。

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
- 飞书群收到固定格式卡片，卡片中包含 GitHub Release 地址和百度网盘地址。

## 故障处理

- `BAIDUPCS_GO_COOKIES` 失效：重新从已登录百度网盘网页复制 Cookie，并更新 environment secret。
- BaiduPCS-Go 下载 404：检查 `BAIDUPCS_VERSION` 是否与 GitHub Release 文件名一致，例如 `v4.0.1`。
- 大包上传时间过长：先用 `probe_only=true` 验证凭据，再重跑正式分发。
- 飞书未收到消息：检查 `FEISHU_RELEASE_WEBHOOK`，如果机器人开启签名，需要补 `FEISHU_RELEASE_SECRET`。
