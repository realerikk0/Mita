#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildReleaseHighlightsMarkdown } from './release-highlights.mjs'

function parseArgs(argv) {
  const args = { dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }

    args[key] = value
    index += 1
  }
  return args
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').toLowerCase())
}

function buildRunUrl(env = process.env) {
  if (env.GITHUB_RUN_URL) return env.GITHUB_RUN_URL
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
  }
  return null
}

function assetLine(label, asset) {
  return `**${label}**: [${asset.name}](${asset.downloadUrl})`
}

function mimeTypeForFile(file) {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

export function createFeishuSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`
  return createHmac('sha256', stringToSign).update('').digest('base64')
}

export const RELEASE_POSTER_LABEL = '宣传图：'

export function buildFeishuCard(release, distribution = {}, options = {}) {
  const runUrl = options.runUrl ?? buildRunUrl()
  const title = `Biyan ${release.tagName} 发布完成`
  const releaseTime = release.publishedAt || 'unknown'
  const dryRunPrefix = options.dryRun || distribution.dryRun ? '**Dry run**\n' : ''
  const downloadPageUrl =
    distribution.downloadPageUrl ?? options.downloadPageUrl ?? release.downloadPageUrl ?? null
  const releaseHighlights = buildReleaseHighlightsMarkdown(release, {
    maxFeatures: options.maxFeatures ?? 5,
    maxFixes: options.maxFixes ?? 5,
    includeEmptyMessage: true,
  })

  const fields = [
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**版本**\n${release.tagName}`,
      },
    },
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**发布时间**\n${releaseTime}`,
      },
    },
  ]

  if (runUrl) {
    fields.push({
      is_short: false,
      text: {
        tag: 'lark_md',
        content: `**Actions Run**\n[打开运行记录](${runUrl})`,
      },
    })
  }

  const elements = [
    {
      tag: 'div',
      fields,
    },
    {
      tag: 'hr',
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: releaseHighlights,
      },
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**GitHub Release**\n[${release.url}](${release.url})`,
      },
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**GitHub 安装包**',
          assetLine('macOS DMG', release.assets.macosDmg),
          assetLine('Windows EXE', release.assets.windowsExe),
          assetLine('Windows MSI', release.assets.windowsMsi),
        ].join('\n'),
      },
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: downloadPageUrl
          ? `${dryRunPrefix}**阿里云 CDN 最新下载**\n[打开下载页](${downloadPageUrl})`
          : `${dryRunPrefix}**阿里云 CDN 最新下载**\n未配置下载页 URL，请使用 GitHub Release。`,
      },
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '打开 GitHub Release',
          },
          type: 'primary',
          url: release.url,
        },
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '打开 CDN 下载',
          },
          type: 'default',
          url: downloadPageUrl ?? release.url,
        },
      ],
    },
  ]

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: options.dryRun || distribution.dryRun ? 'yellow' : 'green',
      title: {
        tag: 'plain_text',
        content: title,
      },
    },
    elements,
  }
}

function addFeishuWebhookSign(payload, options = {}) {
  if (!options.secret) return payload

  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  return {
    ...payload,
    timestamp,
    sign: createFeishuSign(timestamp, options.secret),
  }
}

export function buildFeishuPayload(card, options = {}) {
  return addFeishuWebhookSign(
    {
      msg_type: 'interactive',
      card,
    },
    options,
  )
}

export function buildFeishuTextPayload(text, options = {}) {
  return addFeishuWebhookSign(
    {
      msg_type: 'text',
      content: {
        text,
      },
    },
    options,
  )
}

export function buildFeishuImagePayload(imageKey, options = {}) {
  if (!imageKey) {
    throw new Error('imageKey is required for Feishu image payload')
  }

  return addFeishuWebhookSign(
    {
      msg_type: 'image',
      content: {
        image_key: imageKey,
      },
    },
    options,
  )
}

export function buildFeishuReleasePayloads(card, options = {}) {
  const posterImageKey = options.posterImageKey ?? options.imageKey
  const posterLabel = options.posterLabel ?? RELEASE_POSTER_LABEL

  if (options.chatId) {
    const payloads = [buildFeishuAppMessagePayload(card, { chatId: options.chatId })]
    if (posterImageKey) {
      payloads.push(
        buildFeishuAppTextMessagePayload(posterLabel, { chatId: options.chatId }),
        buildFeishuAppImageMessagePayload(posterImageKey, { chatId: options.chatId }),
      )
    }
    return payloads
  }

  const payloads = [buildFeishuPayload(card, options)]
  if (posterImageKey) {
    payloads.push(
      buildFeishuTextPayload(posterLabel, options),
      buildFeishuImagePayload(posterImageKey, options),
    )
  }
  return payloads
}

export function buildFeishuAppPayload(msgType, content, options = {}) {
  if (!options.chatId) {
    throw new Error('chatId is required for Feishu app message payload')
  }

  return {
    receive_id: options.chatId,
    msg_type: msgType,
    content: JSON.stringify(content),
  }
}

export function buildFeishuAppTextMessagePayload(text, options = {}) {
  return buildFeishuAppPayload('text', { text }, options)
}

export function buildFeishuAppImageMessagePayload(imageKey, options = {}) {
  if (!imageKey) {
    throw new Error('imageKey is required for Feishu app image message payload')
  }

  return buildFeishuAppPayload('image', { image_key: imageKey }, options)
}

export function buildFeishuAppMessagePayload(card, options = {}) {
  return buildFeishuAppPayload('interactive', card, options)
}

async function postFeishuWebhook(webhook, payload) {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Feishu webhook failed with HTTP ${response.status}: ${text}`)
  }

  if (text) {
    try {
      const json = JSON.parse(text)
      const code = json.code ?? json.StatusCode ?? json.status_code
      if (code != null && Number(code) !== 0) {
        throw new Error(`Feishu webhook rejected payload: ${text}`)
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return text
      }
      throw error
    }
  }

  return text
}

function assertFeishuSuccess(responseText, fallbackMessage) {
  if (!responseText) return {}

  try {
    const json = JSON.parse(responseText)
    const code = json.code ?? json.StatusCode ?? json.status_code
    if (code != null && Number(code) !== 0) {
      throw new Error(json.msg || json.message || `${fallbackMessage}: ${responseText}`)
    }
    return json
  } catch (error) {
    if (error instanceof SyntaxError) return responseText
    throw error
  }
}

export async function getFeishuTenantAccessToken(
  appId,
  appSecret,
  fetchImpl = globalThis.fetch,
) {
  const response = await fetchImpl(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    },
  )

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Feishu tenant token failed with HTTP ${response.status}: ${text}`)
  }

  const json = text ? JSON.parse(text) : {}
  const code = json.code ?? json.StatusCode ?? json.status_code
  if (code != null && Number(code) !== 0) {
    throw new Error(json.msg || json.message || `Feishu tenant token rejected: ${text}`)
  }

  const token = json.tenant_access_token ?? json.data?.tenant_access_token
  if (!token) {
    throw new Error('Feishu tenant token response did not include tenant_access_token')
  }

  return token
}

export async function postFeishuAppMessage(
  chatId,
  card,
  tenantAccessToken,
  fetchImpl = globalThis.fetch,
) {
  const payload = buildFeishuAppMessagePayload(card, { chatId })
  return postFeishuAppPayload(payload, tenantAccessToken, fetchImpl)
}

export async function postFeishuAppPayload(
  payload,
  tenantAccessToken,
  fetchImpl = globalThis.fetch,
) {
  const response = await fetchImpl(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tenantAccessToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    },
  )

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Feishu app message failed with HTTP ${response.status}: ${text}`)
  }

  return assertFeishuSuccess(text, 'Feishu app message rejected payload')
}

export async function postFeishuAppPayloads(
  payloads,
  tenantAccessToken,
  fetchImpl = globalThis.fetch,
) {
  const results = []
  for (const payload of payloads) {
    results.push(await postFeishuAppPayload(payload, tenantAccessToken, fetchImpl))
  }
  return results
}

export async function uploadFeishuImage(
  imagePath,
  tenantAccessToken,
  fetchImpl = globalThis.fetch,
) {
  const image = new Blob([fs.readFileSync(imagePath)], {
    type: mimeTypeForFile(imagePath),
  })
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', image, path.basename(imagePath))

  const response = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
    },
    body: form,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Feishu image upload failed with HTTP ${response.status}: ${text}`)
  }

  const json = text ? JSON.parse(text) : {}
  const code = json.code ?? json.StatusCode ?? json.status_code
  if (code != null && Number(code) !== 0) {
    throw new Error(json.msg || json.message || `Feishu image upload rejected: ${text}`)
  }

  const imageKey = json.data?.image_key ?? json.data?.img_key ?? json.image_key ?? json.img_key
  if (!imageKey) {
    throw new Error('Feishu image upload response did not include image_key')
  }

  return imageKey
}

function readPosterMetadata(posterJson) {
  if (!posterJson || !fs.existsSync(posterJson)) return null
  return readJson(posterJson)
}

function writePosterMetadata(posterJson, metadata) {
  if (!posterJson) return
  ensureDirectory(posterJson)
  fs.writeFileSync(posterJson, `${JSON.stringify(metadata, null, 2)}\n`)
}

export async function resolvePosterImageKey(options = {}) {
  const metadata = readPosterMetadata(options.posterJson)
  const posterPath = options.posterPath ?? metadata?.outputPath
  if (!posterPath || !fs.existsSync(posterPath)) return null

  if (metadata && metadata.status !== 'generated') return null
  if (metadata?.feishuImageKey) return metadata.feishuImageKey

  const appId = options.appId ?? process.env.FEISHU_APP_ID
  const appSecret = options.appSecret ?? process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    console.warn('Release poster exists but FEISHU_APP_ID or FEISHU_APP_SECRET is missing; sending release notification without poster image')
    return null
  }

  try {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch
    const token =
      options.tenantAccessToken ??
      (await getFeishuTenantAccessToken(appId, appSecret, fetchImpl))
    const imageKey = await uploadFeishuImage(posterPath, token, fetchImpl)
    writePosterMetadata(options.posterJson, {
      ...(metadata ?? {}),
      outputPath: posterPath,
      feishuUploadStatus: 'uploaded',
      feishuImageKey: imageKey,
      feishuUploadedAt: new Date().toISOString(),
    })
    return imageKey
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writePosterMetadata(options.posterJson, {
      ...(metadata ?? {}),
      outputPath: posterPath,
      feishuUploadStatus: 'failed',
      feishuUploadError: message,
      feishuUploadedAt: new Date().toISOString(),
    })
    console.warn(`Release poster upload skipped: ${message}`)
    if (options.strict) throw error
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseJson = args['release-json']
  const downloadPageUrl = args['download-page-url'] ?? process.env.BIYAN_DOWNLOAD_PAGE_URL
  const output = args.output ?? 'dist/feishu-card.json'
  const dryRun = args.dryRun || isTruthy(process.env.DRY_RUN)
  const strictPoster = isTruthy(process.env.RELEASE_POSTER_STRICT)
  const chatId = args['chat-id'] ?? process.env.FEISHU_RELEASE_CHAT_ID

  if (!releaseJson) throw new Error('--release-json is required')

  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  let tenantAccessToken = null
  if (chatId && !dryRun) {
    if (!appId || !appSecret) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required when FEISHU_RELEASE_CHAT_ID is set')
    }
    tenantAccessToken = await getFeishuTenantAccessToken(appId, appSecret)
  }

  const release = readJson(releaseJson)
  const posterImageKey = await resolvePosterImageKey({
    posterJson: args['poster-json'],
    posterPath: args['poster-path'],
    tenantAccessToken,
    strict: strictPoster,
  })
  const card = buildFeishuCard(release, { downloadPageUrl }, {
    runUrl: buildRunUrl(),
    dryRun,
  })
  const payloads = buildFeishuReleasePayloads(card, {
    chatId,
    posterImageKey,
    secret: process.env.FEISHU_RELEASE_SECRET,
  })

  ensureDirectory(output)
  fs.writeFileSync(output, `${JSON.stringify(payloads, null, 2)}\n`)

  if (dryRun) {
    console.log(`Dry run: wrote ${payloads.length} Feishu message payload(s) to ${output}`)
    return
  }

  if (chatId) {
    if (!tenantAccessToken) {
      tenantAccessToken = await getFeishuTenantAccessToken(appId, appSecret)
    }
    await postFeishuAppPayloads(payloads, tenantAccessToken)
    console.log(`Sent ${payloads.length} Feishu release message(s) via app bot to chat ${chatId}`)
    return
  }

  const webhook = process.env.FEISHU_RELEASE_WEBHOOK
  if (!webhook) {
    throw new Error('FEISHU_RELEASE_CHAT_ID or FEISHU_RELEASE_WEBHOOK is required when DRY_RUN is false')
  }

  for (const payload of payloads) {
    await postFeishuWebhook(webhook, payload)
  }
  console.log(`Sent ${payloads.length} Feishu release message(s)`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
