#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'

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

export function createFeishuSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`
  return createHmac('sha256', stringToSign).update('').digest('base64')
}

export function buildFeishuCard(release, baiduShare, options = {}) {
  const runUrl = options.runUrl ?? buildRunUrl()
  const title = `Mita ${release.tagName} 发布完成`
  const baiduPassword = baiduShare.password || 'mita'
  const releaseTime = release.publishedAt || 'unknown'
  const dryRunPrefix = baiduShare.dryRun ? '**Dry run**\n' : ''

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

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: baiduShare.dryRun ? 'yellow' : 'green',
      title: {
        tag: 'plain_text',
        content: title,
      },
    },
    elements: [
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
          content: `${dryRunPrefix}**百度网盘**\n[打开百度网盘](${baiduShare.url})\n提取码: \`${baiduPassword}\``,
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
              content: '打开百度网盘',
            },
            type: 'default',
            url: baiduShare.url,
          },
        ],
      },
    ],
  }
}

export function buildFeishuPayload(card, options = {}) {
  const payload = {
    msg_type: 'interactive',
    card,
  }

  if (options.secret) {
    const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
    payload.timestamp = timestamp
    payload.sign = createFeishuSign(timestamp, options.secret)
  }

  return payload
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseJson = args['release-json']
  const baiduJson = args['baidu-json']
  const output = args.output ?? 'dist/feishu-card.json'
  const dryRun = args.dryRun || isTruthy(process.env.DRY_RUN)

  if (!releaseJson) throw new Error('--release-json is required')
  if (!baiduJson) throw new Error('--baidu-json is required')

  const release = readJson(releaseJson)
  const baiduShare = readJson(baiduJson)
  const card = buildFeishuCard(release, baiduShare)
  const payload = buildFeishuPayload(card, {
    secret: process.env.FEISHU_RELEASE_SECRET,
  })

  ensureDirectory(output)
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`)

  if (dryRun) {
    console.log(`Dry run: wrote Feishu card payload to ${output}`)
    return
  }

  const webhook = process.env.FEISHU_RELEASE_WEBHOOK
  if (!webhook) {
    throw new Error('FEISHU_RELEASE_WEBHOOK is required when DRY_RUN is false')
  }

  await postFeishuWebhook(webhook, payload)
  console.log('Sent Feishu release card')
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
