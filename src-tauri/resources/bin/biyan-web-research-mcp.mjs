#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

let buffer = ''
let browserContext = null
let page = null
let pendingMessages = 0
let inputEnded = false

const PROFILE_DIR =
  process.env.BIYAN_WEB_RESEARCH_PROFILE_DIR ||
  `${process.env.HOME || process.cwd()}/.biyan-web-research`
const HEADLESS = process.env.BIYAN_WEB_RESEARCH_HEADLESS !== 'false'

const tools = [
  {
    name: 'web_search',
    description:
      'Search the public web and return concise structured results with URLs. Does not use the user system browser profile.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: {
          type: 'number',
          description: 'Maximum result count, 1-10.',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_url',
    description:
      'Open a URL with the private Biyan research browser when render=true, otherwise fetch static HTML. Login/auth pages require userConfirmedLoginTask=true.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open.' },
        render: {
          type: 'boolean',
          description: 'Use Playwright Chromium rendering for dynamic pages.',
        },
        userConfirmedLoginTask: {
          type: 'boolean',
          description:
            'Must be true for login, account, auth, checkout, or credential-related pages.',
        },
      },
      required: ['url'],
    },
  },
]

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  writeMessage({ jsonrpc: '2.0', id, result: value })
}

function error(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } })
}

function textResult(text) {
  return {
    content: [{ type: 'text', text }],
  }
}

function clampLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n)) return 5
  return Math.max(1, Math.min(10, Math.trunc(n)))
}

function isSensitiveUrl(url) {
  return /\/(login|signin|sign-in|auth|oauth|account|checkout|billing|password|session)(\/|$|\?)/i.test(
    url
  )
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function searchWeb(args) {
  const query = String(args.query || '').trim()
  if (!query) throw new Error('query is required')

  const limit = clampLimit(args.limit)
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 BiyanWebResearch/1.0 (+https://biyan.ai)',
    },
  })

  if (!response.ok) {
    throw new Error(`Search request failed with HTTP ${response.status}`)
  }

  const html = await response.text()
  const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const results = matches.slice(0, limit).map((match, index) => {
    const rawUrl = decodeHtml(match[1] || '')
    const title = decodeHtml(stripHtml(match[2] || 'Untitled'))
    const resultUrl = rawUrl.includes('uddg=')
      ? decodeURIComponent(new URL(rawUrl, 'https://duckduckgo.com').searchParams.get('uddg') || rawUrl)
      : rawUrl
    return `${index + 1}. ${title}\n${resultUrl}`
  })

  return results.length
    ? `Search results for: ${query}\n\n${results.join('\n\n')}`
    : `No search results found for: ${query}`
}

async function ensureBrowserPage() {
  if (page) return page
  if (!HEADLESS) {
    throw new Error(
      'Biyan Web Research bundles Chromium Headless Shell only; BIYAN_WEB_RESEARCH_HEADLESS=false is not supported.'
    )
  }

  let playwright
  try {
    const modulePath = process.env.BIYAN_WEB_RESEARCH_PLAYWRIGHT_MODULE
    playwright = modulePath
      ? await import(pathToFileURL(modulePath).href)
      : await import('playwright')
  } catch {
    throw new Error(
      'Playwright runtime is not installed. Bundle/install the Biyan Web Research Chromium runtime before using render=true.'
    )
  }

  browserContext = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1365, height: 900 },
  })
  page = browserContext.pages()[0] || (await browserContext.newPage())
  return page
}

async function openUrl(args) {
  const url = String(args.url || '').trim()
  if (!url) throw new Error('url is required')
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Only http:// and https:// URLs are allowed.')
  }
  if (isSensitiveUrl(url) && args.userConfirmedLoginTask !== true) {
    throw new Error(
      'This looks like a login/account/checkout page. Ask the user for explicit confirmation, then retry with userConfirmedLoginTask=true.'
    )
  }

  if (args.render === true) {
    const p = await ensureBrowserPage()
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const title = await p.title().catch(() => '')
    const text = await p.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    const links = await p
      .locator('a[href]')
      .evaluateAll((nodes) =>
        nodes.slice(0, 25).map((node) => ({
          text: node.textContent?.trim() || '',
          href: node.href,
        }))
      )
      .catch(() => [])
    return JSON.stringify(
      {
        url: p.url(),
        title,
        text: text.slice(0, 12000),
        links,
        profile: PROFILE_DIR,
      },
      null,
      2
    )
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 BiyanWebResearch/1.0 (+https://biyan.ai)',
    },
  })
  const html = await response.text()
  return JSON.stringify(
    {
      url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      text: stripHtml(html).slice(0, 12000),
    },
    null,
    2
  )
}

async function callTool(name, args) {
  if (name === 'web_search') return searchWeb(args || {})
  if (name === 'open_url') return openUrl(args || {})
  throw new Error(`Unknown tool: ${name}`)
}

async function closeBrowser() {
  await browserContext?.close().catch(() => {})
  browserContext = null
  page = null
}

async function maybeExitAfterInputEnd() {
  if (!inputEnded || pendingMessages > 0) return
  await closeBrowser()
  process.exit(0)
}

function queueMessage(message) {
  pendingMessages += 1
  void handleMessage(message)
    .catch((err) => {
      process.stderr.write(`MCP handler failed: ${err}\n`)
    })
    .finally(() => {
      pendingMessages -= 1
      void maybeExitAfterInputEnd()
    })
}

async function handleMessage(message) {
  const { id, method, params } = message

  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'Biyan Web Research',
        version: '0.1.0',
      },
    })
    return
  }

  if (method === 'tools/list') {
    result(id, { tools })
    return
  }

  if (method === 'tools/call') {
    try {
      const output = await callTool(params?.name, params?.arguments || {})
      result(id, textResult(output))
    } catch (err) {
      result(id, {
        isError: true,
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      })
    }
    return
  }

  if (method === 'ping') {
    result(id, {})
    return
  }

  if (id !== undefined) {
    error(id, -32601, `Method not found: ${method}`)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      queueMessage(JSON.parse(line))
    } catch (err) {
      process.stderr.write(`Invalid MCP message: ${err}\n`)
    }
  }
})

process.stdin.on('end', () => {
  inputEnded = true
  void maybeExitAfterInputEnd()
})

process.on('SIGTERM', async () => {
  await closeBrowser()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await closeBrowser()
  process.exit(0)
})
