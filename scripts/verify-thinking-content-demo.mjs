import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_URL = 'http://localhost:1420/thinking-content-demo'
const DEFAULT_OUTPUT_DIR = 'output/playwright'
const EXPECTED_KINDS = ['reasoning', 'tool', 'search', 'plan', 'code']
const EXPECTED_TEXT = [
  'Thinking content system',
  'Reasoning',
  'Tool call',
  'Sources',
  'Implementation plan',
  'Code analysis',
]
const LONG_RUN_MS = Number(process.env.THINKING_CONTENT_LONG_RUN_MS ?? 4000)
const LONG_RUN_MAX_SCRIPT_SECONDS = Number(
  process.env.THINKING_CONTENT_MAX_SCRIPT_SECONDS ?? 0.25
)
const LONG_RUN_MAX_LAYOUT_SECONDS = Number(
  process.env.THINKING_CONTENT_MAX_LAYOUT_SECONDS ?? 0.25
)

const url = process.env.THINKING_CONTENT_DEMO_URL ?? DEFAULT_URL
const outputDir = process.env.THINKING_CONTENT_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR

function channelCandidates() {
  if (process.env.PLAYWRIGHT_CHANNEL) {
    return [process.env.PLAYWRIGHT_CHANNEL]
  }

  if (process.platform === 'win32') {
    return ['msedge', 'chrome']
  }

  if (process.platform === 'darwin') {
    return ['chrome', 'msedge']
  }

  return ['chrome', 'msedge']
}

async function launchBrowser() {
  const errors = []

  for (const channel of channelCandidates()) {
    try {
      return {
        browser: await chromium.launch({ channel }),
        channel,
      }
    } catch (error) {
      errors.push(`${channel}: ${error.message}`)
    }
  }

  try {
    return {
      browser: await chromium.launch(),
      channel: 'bundled-chromium',
    }
  } catch (error) {
    errors.push(`bundled-chromium: ${error.message}`)
  }

  throw new Error(`Unable to launch a browser.\n${errors.join('\n')}`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function dismissAnalyticsPrompt(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'productAnalyticPrompt',
      JSON.stringify({
        state: { productAnalyticPrompt: false },
        version: 0,
      })
    )
    localStorage.setItem(
      'productAnalytic',
      JSON.stringify({
        state: { productAnalytic: false },
        version: 0,
      })
    )
  })
}

async function collectPageState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-thinking-content-demo]')
    const blocks = Array.from(root.querySelectorAll('[data-thinking-kind]'))
    const centerElement = document.elementFromPoint(
      Math.floor(window.innerWidth / 2),
      Math.floor(window.innerHeight / 2)
    )
    const blockRects = blocks.map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        height: rect.height,
        width: rect.width,
      }
    })

    return {
      background: getComputedStyle(root).backgroundColor,
      blockCount: blocks.length,
      blockRects,
      hasRibbon: Boolean(root.querySelector('[data-loading-ribbon]')),
      kinds: blocks.map((node) => node.getAttribute('data-thinking-kind')),
      overflow: blocks.some((node) => node.scrollWidth > node.clientWidth + 1),
      statuses: blocks.map((node) => node.getAttribute('data-thinking-status')),
      text: root.textContent ?? '',
      topElementId: centerElement?.id ?? '',
    }
  })
}

async function waitForDemoReady(page) {
  await page.waitForSelector('[data-thinking-content-demo] [data-thinking-kind]')
  await page.waitForFunction(() => !document.getElementById('initial-loader'), {
    timeout: 6000,
  })
}

function metricsByName(payload) {
  return Object.fromEntries(
    payload.metrics.map((metric) => [metric.name, metric.value])
  )
}

async function collectLongRunMetrics(page) {
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')

  try {
    const before = metricsByName(await session.send('Performance.getMetrics'))
    await page.waitForTimeout(LONG_RUN_MS)
    const after = metricsByName(await session.send('Performance.getMetrics'))

    return {
      durationMs: LONG_RUN_MS,
      jsHeapUsedSizeDelta:
        (after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0),
      layoutDuration:
        (after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0),
      recalcStyleDuration:
        (after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0),
      scriptDuration:
        (after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0),
      taskDuration: (after.TaskDuration ?? 0) - (before.TaskDuration ?? 0),
    }
  } finally {
    await session.detach()
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const { browser, channel } = await launchBrowser()

  try {
    const desktop = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 1100 },
    })
    await dismissAnalyticsPrompt(desktop)
    await desktop.goto(url, { waitUntil: 'networkidle' })
    await waitForDemoReady(desktop)

    const longRunMetrics = await collectLongRunMetrics(desktop)
    const desktopState = await collectPageState(desktop)
    const desktopScreenshot = path.join(
      outputDir,
      'thinking-content-demo-desktop.png'
    )
    await desktop.screenshot({ fullPage: true, path: desktopScreenshot })

    const mobile = await browser.newPage({
      deviceScaleFactor: 2,
      isMobile: true,
      viewport: { width: 390, height: 1000 },
    })
    await dismissAnalyticsPrompt(mobile)
    await mobile.goto(url, { waitUntil: 'networkidle' })
    await waitForDemoReady(mobile)
    const mobileState = await collectPageState(mobile)
    const mobileScreenshot = path.join(
      outputDir,
      'thinking-content-demo-mobile.png'
    )
    await mobile.screenshot({ fullPage: true, path: mobileScreenshot })

    const reduced = await browser.newPage({
      viewport: { width: 900, height: 700 },
    })
    await dismissAnalyticsPrompt(reduced)
    await reduced.emulateMedia({ reducedMotion: 'reduce' })
    await reduced.goto(url, { waitUntil: 'networkidle' })
    await waitForDemoReady(reduced)
    await reduced.waitForSelector('[data-thinking-content-demo] [data-loading-ribbon]')
    const reducedMotion = await reduced
      .locator('.loading-ribbon__text')
      .first()
      .evaluate((node) => ({
        afterAnimation: getComputedStyle(node, '::after').animationName,
        textAnimation: getComputedStyle(node).animationName,
      }))

    assert(
      desktopState.background === 'rgb(2, 2, 4)',
      `Unexpected desktop background: ${desktopState.background}`
    )
    assert(
      mobileState.background === 'rgb(2, 2, 4)',
      `Unexpected mobile background: ${mobileState.background}`
    )
    assert(desktopState.hasRibbon, 'Missing loading ribbon integration')
    assert(
      desktopState.topElementId !== 'initial-loader' &&
        mobileState.topElementId !== 'initial-loader',
      `Initial loader covered the demo: desktop=${desktopState.topElementId} mobile=${mobileState.topElementId}`
    )
    assert(desktopState.blockCount >= EXPECTED_KINDS.length, 'Too few thinking blocks')
    for (const kind of EXPECTED_KINDS) {
      assert(desktopState.kinds.includes(kind), `Missing kind: ${kind}`)
      assert(mobileState.kinds.includes(kind), `Missing mobile kind: ${kind}`)
    }
    for (const text of EXPECTED_TEXT) {
      assert(desktopState.text.includes(text), `Missing text: ${text}`)
    }
    assert(
      desktopState.statuses.includes('running') &&
        desktopState.statuses.includes('complete'),
      `Expected running and complete states: ${desktopState.statuses.join(',')}`
    )
    assert(!desktopState.overflow, 'Desktop thinking block overflow detected')
    assert(!mobileState.overflow, 'Mobile thinking block overflow detected')
    assert(
      longRunMetrics.scriptDuration < LONG_RUN_MAX_SCRIPT_SECONDS,
      `Long-run script duration too high: ${JSON.stringify(longRunMetrics)}`
    )
    assert(
      longRunMetrics.layoutDuration < LONG_RUN_MAX_LAYOUT_SECONDS &&
        longRunMetrics.recalcStyleDuration < LONG_RUN_MAX_LAYOUT_SECONDS,
      `Long-run layout/style duration too high: ${JSON.stringify(
        longRunMetrics
      )}`
    )
    assert(
      reducedMotion.textAnimation === 'none' &&
        reducedMotion.afterAnimation === 'none',
      `Reduced-motion animations still active: ${JSON.stringify(reducedMotion)}`
    )

    console.log(
      JSON.stringify(
        {
          browserChannel: channel,
          desktop: desktopState,
          longRun: longRunMetrics,
          mobile: mobileState,
          reducedMotion,
          screenshots: [desktopScreenshot, mobileScreenshot],
          url,
        },
        null,
        2
      )
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
