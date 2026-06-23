import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_URL = 'http://localhost:1420/thinking-content-demo'
const DEFAULT_OUTPUT_DIR = 'output/playwright'
const READY_TIMEOUT_MS = Number(
  process.env.THINKING_CONTENT_READY_TIMEOUT_MS ??
    (process.platform === 'win32' ? 180000 : 30000)
)
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

function attachPageDiagnostics(page) {
  const events = []

  page.on('console', (message) => {
    events.push({
      location: message.location(),
      text: message.text(),
      type: message.type(),
    })
  })

  page.on('pageerror', (error) => {
    events.push({
      message: error.message,
      name: error.name,
      stack: error.stack,
      type: 'pageerror',
    })
  })

  return events
}

async function collectFailureState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-thinking-content-demo]')
    const blocks = root
      ? Array.from(root.querySelectorAll('[data-thinking-kind]'))
      : []

    return {
      blockCount: blocks.length,
      bodyText: document.body?.innerText?.slice(0, 3000) ?? '',
      documentReadyState: document.readyState,
      rootHtml: root?.outerHTML?.slice(0, 3000) ?? null,
      title: document.title,
      url: window.location.href,
    }
  })
}

async function gotoDemo(page) {
  await page.goto(url, {
    timeout: READY_TIMEOUT_MS,
    waitUntil: 'commit',
  })
}

async function captureScreenshot(page, screenshotPath) {
  await page.screenshot({
    fullPage: true,
    path: screenshotPath,
    timeout: READY_TIMEOUT_MS,
  })
}

async function writeFailureDiagnostics(page, label, error, events) {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  const diagnosticPath = path.join(
    outputDir,
    `thinking-content-${safeLabel}-failure.json`
  )
  const screenshotPath = path.join(
    outputDir,
    `thinking-content-${safeLabel}-failure.png`
  )

  let screenshot = null
  try {
    await captureScreenshot(page, screenshotPath)
    screenshot = screenshotPath
  } catch (screenshotError) {
    screenshot = {
      error: screenshotError.message,
    }
  }

  let state = null
  try {
    state = await collectFailureState(page)
  } catch (stateError) {
    state = {
      error: stateError.message,
    }
  }

  await writeFile(
    diagnosticPath,
    JSON.stringify(
      {
        error: {
          message: error.message,
          stack: error.stack,
        },
        events,
        readyTimeoutMs: READY_TIMEOUT_MS,
        screenshot,
        state,
        url,
      },
      null,
      2
    )
  )

  console.error(
    `Wrote thinking content ${label} failure diagnostics: ${diagnosticPath}`
  )
}

async function withPageDiagnostics(page, label, callback) {
  const events = attachPageDiagnostics(page)

  try {
    return await callback()
  } catch (error) {
    await writeFailureDiagnostics(page, label, error, events)
    throw error
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
  await page.waitForSelector('[data-thinking-content-demo]', {
    timeout: READY_TIMEOUT_MS,
  })
  await page.waitForSelector('[data-thinking-content-demo] [data-thinking-kind]', {
    timeout: READY_TIMEOUT_MS,
  })
  await page.waitForFunction(() => !document.getElementById('initial-loader'), {
    timeout: Math.max(6000, Math.min(READY_TIMEOUT_MS, 15000)),
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
    let longRunMetrics
    let desktopState
    const desktopScreenshot = path.join(
      outputDir,
      'thinking-content-demo-desktop.png'
    )
    await withPageDiagnostics(desktop, 'desktop', async () => {
      await dismissAnalyticsPrompt(desktop)
      await gotoDemo(desktop)
      await waitForDemoReady(desktop)

      longRunMetrics = await collectLongRunMetrics(desktop)
      desktopState = await collectPageState(desktop)
      await captureScreenshot(desktop, desktopScreenshot)
    })

    const mobile = await browser.newPage({
      deviceScaleFactor: 2,
      isMobile: true,
      viewport: { width: 390, height: 1000 },
    })
    let mobileState
    const mobileScreenshot = path.join(
      outputDir,
      'thinking-content-demo-mobile.png'
    )
    await withPageDiagnostics(mobile, 'mobile', async () => {
      await dismissAnalyticsPrompt(mobile)
      await gotoDemo(mobile)
      await waitForDemoReady(mobile)
      mobileState = await collectPageState(mobile)
      await captureScreenshot(mobile, mobileScreenshot)
    })

    const reduced = await browser.newPage({
      viewport: { width: 900, height: 700 },
    })
    let reducedMotion
    await withPageDiagnostics(reduced, 'reduced-motion', async () => {
      await dismissAnalyticsPrompt(reduced)
      await reduced.emulateMedia({ reducedMotion: 'reduce' })
      await gotoDemo(reduced)
      await waitForDemoReady(reduced)
      await reduced.waitForSelector(
        '[data-thinking-content-demo] [data-loading-ribbon]',
        {
          timeout: READY_TIMEOUT_MS,
        }
      )
      reducedMotion = await reduced
        .locator('.loading-ribbon__text')
        .first()
        .evaluate((node) => ({
          afterAnimation: getComputedStyle(node, '::after').animationName,
          textAnimation: getComputedStyle(node).animationName,
        }))
    })

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
          readyTimeoutMs: READY_TIMEOUT_MS,
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
