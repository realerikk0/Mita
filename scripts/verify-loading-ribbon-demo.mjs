import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_URL = 'http://localhost:1420/loading-ribbon-demo'
const DEFAULT_OUTPUT_DIR = 'output/playwright'
const EXPECTED_LABELS = [
  '思考中',
  '网络搜索中',
  '正在生成回复',
  '分析代码中',
  '正在调用工具...',
]
const EXPECTED_VARIANTS = ['ribbon', 'glint', 'wave']
const LONG_RUN_MS = Number(process.env.LOADING_RIBBON_LONG_RUN_MS ?? 6000)
const LONG_RUN_MAX_SCRIPT_SECONDS = Number(
  process.env.LOADING_RIBBON_MAX_SCRIPT_SECONDS ?? 0.25
)
const LONG_RUN_MAX_LAYOUT_SECONDS = Number(
  process.env.LOADING_RIBBON_MAX_LAYOUT_SECONDS ?? 0.25
)

const url = process.env.LOADING_RIBBON_DEMO_URL ?? DEFAULT_URL
const outputDir = process.env.LOADING_RIBBON_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR

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
    const root = document.querySelector('[data-loading-ribbon-demo]')
    const ribbons = Array.from(root.querySelectorAll('[data-loading-ribbon]'))
    const labels = Array.from(
      root.querySelectorAll('[data-loading-ribbon-label]')
    ).map((node) => node.textContent?.trim())

    return {
      background: getComputedStyle(root).backgroundColor,
      count: ribbons.length,
      labels,
      overflow: ribbons.some((node) => node.scrollWidth > node.clientWidth + 1),
      variants: ribbons.map((node) =>
        node.getAttribute('data-loading-ribbon-variant')
      ),
    }
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
    await desktop.waitForSelector('[data-loading-ribbon-demo] [data-loading-ribbon]')

    const ribbon = desktop
      .locator('[data-loading-ribbon-variant="ribbon"] .loading-ribbon__text')
      .first()
    const before = await ribbon.evaluate(
      (node) => getComputedStyle(node).backgroundPosition
    )
    await desktop.waitForTimeout(900)
    const after = await ribbon.evaluate(
      (node) => getComputedStyle(node).backgroundPosition
    )
    const longRunMetrics = await collectLongRunMetrics(desktop)

    const desktopState = await collectPageState(desktop)
    const desktopScreenshot = path.join(
      outputDir,
      'loading-ribbon-demo-desktop.png'
    )
    await desktop.screenshot({ fullPage: true, path: desktopScreenshot })

    const mobile = await browser.newPage({
      deviceScaleFactor: 2,
      isMobile: true,
      viewport: { width: 390, height: 1000 },
    })
    await dismissAnalyticsPrompt(mobile)
    await mobile.goto(url, { waitUntil: 'networkidle' })
    await mobile.waitForSelector('[data-loading-ribbon-demo] [data-loading-ribbon]')
    const mobileState = await collectPageState(mobile)
    const mobileScreenshot = path.join(
      outputDir,
      'loading-ribbon-demo-mobile.png'
    )
    await mobile.screenshot({ fullPage: true, path: mobileScreenshot })

    const reduced = await browser.newPage({
      viewport: { width: 900, height: 700 },
    })
    await dismissAnalyticsPrompt(reduced)
    await reduced.emulateMedia({ reducedMotion: 'reduce' })
    await reduced.goto(url, { waitUntil: 'networkidle' })
    await reduced.waitForSelector('[data-loading-ribbon-demo] [data-loading-ribbon]')
    const reducedMotion = await reduced
      .locator('.loading-ribbon__text')
      .first()
      .evaluate((node) => ({
        afterAnimation: getComputedStyle(node, '::after').animationName,
        textAnimation: getComputedStyle(node).animationName,
      }))

    assert(desktopState.count >= EXPECTED_LABELS.length, 'Ribbon count is too low')
    for (const label of EXPECTED_LABELS) {
      assert(desktopState.labels.includes(label), `Missing label: ${label}`)
    }
    for (const variant of EXPECTED_VARIANTS) {
      assert(
        desktopState.variants.includes(variant),
        `Missing variant: ${variant}`
      )
    }
    assert(
      desktopState.background === 'rgb(2, 2, 4)',
      `Unexpected desktop background: ${desktopState.background}`
    )
    assert(
      mobileState.background === 'rgb(2, 2, 4)',
      `Unexpected mobile background: ${mobileState.background}`
    )
    assert(!desktopState.overflow, 'Desktop ribbon text overflow detected')
    assert(!mobileState.overflow, 'Mobile ribbon text overflow detected')
    assert(before !== after, 'Ribbon gradient did not move over 900ms')
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
          gradientMoved: { after, before },
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
