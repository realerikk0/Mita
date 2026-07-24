#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractReleaseHighlights } from './release-highlights.mjs'

const DEFAULT_JINGXING_BASE_URL = 'https://api.jingxing.io/v1'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_SIZE = '1024x1536'
const DEFAULT_QUALITY = 'medium'
const DEFAULT_POLL_INTERVAL_MS = 2500
const DEFAULT_TIMEOUT_MS = 600_000

export function validateJingxingBaseUrl(value) {
  if (value !== DEFAULT_JINGXING_BASE_URL) {
    throw new Error(
      `JINGXING_BASE_URL must be exactly ${DEFAULT_JINGXING_BASE_URL}`
    )
  }
  return value
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
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

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').toLowerCase())
}

function isFalsey(value) {
  return ['0', 'false', 'no', 'n'].includes(String(value ?? '').toLowerCase())
}

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, data) {
  ensureDirectory(file)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

export function extractPosterHighlights(release, options = {}) {
  return extractReleaseHighlights(release, options)
}

export function buildPosterPrompt(release, highlights = extractPosterHighlights(release)) {
  const featureLines = highlights.features.map((item) => `- ${item}`).join('\n')
  const fixLines = highlights.fixes.map((item) => `- ${item}`).join('\n')
  const fixesBlock = fixLines || '- 稳定性与细节体验优化'

  return `为彼岩桌面版生成一张中文新版本发布宣传海报。

画面要求：
- 竖版海报，适合飞书群通知展示，清爽高级，有桌面软件发布感。
- 品牌名彼岩/Biyan 要清晰，标题使用“彼岩桌面版新版本来啦”。
- 视觉风格克制、现代、科技感，浅色背景，橙红色作为重点色。
- 海报中需要有两个信息区：“本次更新”和“问题修复”。
- 中文文字尽量清晰可读，不要出现无关品牌、水印或二维码。

版本：${release.tagName}

本次更新：
${featureLines}

问题修复：
${fixesBlock}`
}

function imageItemsFromContainer(container) {
  if (!container) return undefined
  if (Array.isArray(container)) return container
  if (Array.isArray(container.data)) return container.data
  if (Array.isArray(container.images)) return container.images
  if (container.b64_json || container.url) return [container]
  return undefined
}

function imageItemsFromResponse(response) {
  const candidates = [
    imageItemsFromContainer(response.data),
    imageItemsFromContainer(response.images),
    imageItemsFromContainer(response.output),
    imageItemsFromContainer(response.result),
    imageItemsFromContainer(response),
  ]
  return candidates.find((items) => items && items.length > 0) ?? []
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(value).trim())
  if (!match) {
    return {
      mimeType: 'image/png',
      b64Json: value,
    }
  }

  return {
    mimeType: match[1] || 'image/png',
    b64Json: match[2] || '',
  }
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  return 'png'
}

function withExtension(file, mimeType) {
  if (path.extname(file)) return file
  return `${file}.${extensionForMimeType(mimeType)}`
}

async function errorMessage(response) {
  const text = await response.text()
  if (!text) return `HTTP ${response.status}`
  try {
    const json = JSON.parse(text)
    return json.error?.message || json.message || json.msg || text
  } catch {
    return text
  }
}

async function postJson(url, body, apiKey, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }

  const json = await response.json()
  const code = json.code ?? json.status_code
  if (code != null && Number(code) !== 0) {
    throw new Error(json.msg || json.message || JSON.stringify(json))
  }
  return json
}

async function getJson(url, apiKey, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }

  return response.json()
}

function shouldSendAuthToImageUrl(imageUrl, baseUrl) {
  try {
    return new URL(imageUrl).origin === new URL(baseUrl).origin
  } catch {
    return false
  }
}

async function getBinary(url, apiKey, fetchImpl = globalThis.fetch, options = {}) {
  const headers = options.sendAuth === false
    ? {}
    : {
        authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      }
  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    redirect: 'follow',
  })

  return response.ok ? response : null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollJingxingTask(taskId, options) {
  const taskUrl = `${options.baseUrl}/images/tasks/${encodeURIComponent(taskId)}`
  const startedAt = Date.now()

  while (Date.now() - startedAt <= options.timeoutMs) {
    const response = await getJson(taskUrl, options.apiKey, options.fetchImpl)
    const items = imageItemsFromResponse(response)
    if (items.length) return response

    const status = response.status?.toLowerCase()
    if (status === 'succeeded') {
      const content = await getBinary(
        `${taskUrl}/content/0`,
        options.apiKey,
        options.fetchImpl,
      )
      if (!content) {
        throw new Error(`Image task ${taskId} succeeded but no image content was returned`)
      }
      const mimeType = content.headers.get('content-type')?.split(';')[0] || 'image/png'
      const buffer = Buffer.from(await content.arrayBuffer())
      return {
        data: [
          {
            b64_json: `data:${mimeType};base64,${buffer.toString('base64')}`,
          },
        ],
      }
    }

    if (status === 'failed') {
      const detail =
        typeof response.error === 'string'
          ? response.error
          : response.error?.message || response.message
      throw new Error(detail ? `Image task ${taskId} failed: ${detail}` : `Image task ${taskId} failed`)
    }

    await sleep(options.pollIntervalMs)
  }

  throw new Error(`Image task ${taskId} did not finish within ${options.timeoutMs / 1000}s`)
}

async function saveImageItem(item, output, options) {
  let imageBuffer
  let mimeType = 'image/png'

  if (item.b64_json) {
    const parsed = parseDataUrl(item.b64_json)
    mimeType = parsed.mimeType
    imageBuffer = Buffer.from(parsed.b64Json, 'base64')
  } else if (item.url) {
    const response = await getBinary(item.url, options.apiKey, options.fetchImpl, {
      sendAuth: shouldSendAuthToImageUrl(item.url, options.baseUrl),
    })
    if (!response) throw new Error(`Unable to download generated image ${item.url}`)
    mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
    imageBuffer = Buffer.from(await response.arrayBuffer())
  } else {
    throw new Error('Image item did not include b64_json or url')
  }

  const outputPath = withExtension(output, mimeType)
  ensureDirectory(outputPath)
  fs.writeFileSync(outputPath, imageBuffer)

  return {
    outputPath,
    mimeType,
    bytes: imageBuffer.length,
  }
}

export async function generateReleasePoster(release, options) {
  validateJingxingBaseUrl(options.baseUrl)
  const highlights = extractPosterHighlights(release)
  const prompt = options.prompt ?? buildPosterPrompt(release, highlights)
  const response = await postJson(
    `${options.baseUrl}/images/generations/async`,
    {
      model: DEFAULT_MODEL,
      prompt,
      n: 1,
      size: DEFAULT_SIZE,
      quality: DEFAULT_QUALITY,
    },
    options.apiKey,
    options.fetchImpl,
  )

  const finalResponse =
    response.object === 'image.task' && response.id && !imageItemsFromResponse(response).length
      ? await pollJingxingTask(response.id, options)
      : response
  const [item] = imageItemsFromResponse(finalResponse)
  if (!item) throw new Error('Image response did not include any image data')

  const image = await saveImageItem(item, options.output, options)
  return {
    status: 'generated',
    tagName: release.tagName,
    model: DEFAULT_MODEL,
    baseUrl: options.baseUrl,
    size: DEFAULT_SIZE,
    quality: DEFAULT_QUALITY,
    title: '彼岩桌面版新版本来啦',
    highlights,
    prompt,
    ...image,
    generatedAt: new Date().toISOString(),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseJson = args['release-json']
  const output = args.output ?? 'dist/release-poster.png'
  const metadata = args.metadata ?? 'dist/release-poster.json'
  const enabled = !isFalsey(process.env.RELEASE_POSTER_ENABLED ?? 'true')
  const strict = isTruthy(process.env.RELEASE_POSTER_STRICT)

  if (!releaseJson) throw new Error('--release-json is required')

  const baseUrl = validateJingxingBaseUrl(
    process.env.JINGXING_BASE_URL || DEFAULT_JINGXING_BASE_URL
  )
  const apiKey = process.env.JINGXING_API_KEY

  try {
    if (!enabled) {
      writeJson(metadata, {
        status: 'skipped',
        reason: 'disabled',
        outputPath: output,
      })
      console.log('Release poster generation disabled')
      return
    }

    if (!apiKey) {
      throw new Error('JINGXING_API_KEY is required to generate release poster')
    }

    const release = readJson(releaseJson)
    const result = await generateReleasePoster(release, {
      apiKey,
      baseUrl,
      output,
      fetchImpl: globalThis.fetch,
      pollIntervalMs: Number(process.env.RELEASE_POSTER_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
      timeoutMs: Number(process.env.RELEASE_POSTER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    })
    writeJson(metadata, result)
    console.log(`Generated release poster: ${result.outputPath}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeJson(metadata, {
      status: 'failed',
      reason: message,
      outputPath: output,
      baseUrl,
      generatedAt: new Date().toISOString(),
    })
    console.warn(`Release poster generation skipped: ${message}`)
    if (strict) throw error
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
