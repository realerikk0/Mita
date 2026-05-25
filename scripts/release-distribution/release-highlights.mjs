function normalizeMarkdownLine(line) {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+@\S+/g, '')
    .replace(/\s+\(#\d+\)$/g, '')
    .replace(/\s+#\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sectionKind(heading) {
  const normalized = heading.toLowerCase()
  if (/feature|enhancement|新增|功能|亮点|支持|能力/.test(normalized)) return 'features'
  if (/fix|bug|修复|问题|故障|错误/.test(normalized)) return 'fixes'
  return 'changes'
}

function pushUnique(list, item, limit) {
  if (!item || list.length >= limit || list.includes(item)) return
  list.push(item)
}

export function extractReleaseHighlights(release, options = {}) {
  const maxFeatures = options.maxFeatures ?? 3
  const maxFixes = options.maxFixes ?? 3
  const fallback = options.fallback ?? true
  const body = String(release.body ?? '')
  const highlights = {
    features: [],
    fixes: [],
    changes: [],
  }

  let currentSection = 'changes'
  for (const rawLine of body.split(/\r?\n/)) {
    const heading = /^#{1,4}\s+(.+)$/.exec(rawLine)
    if (heading) {
      currentSection = sectionKind(heading[1])
      continue
    }

    const listItem = /^\s*[-*]\s+(.+)$/.exec(rawLine)
    if (!listItem) continue

    const item = normalizeMarkdownLine(listItem[1])
    if (!item) continue

    if (currentSection === 'features') {
      pushUnique(highlights.features, item, maxFeatures)
    } else if (currentSection === 'fixes') {
      pushUnique(highlights.fixes, item, maxFixes)
    } else {
      pushUnique(highlights.changes, item, maxFeatures + maxFixes)
    }
  }

  while (highlights.features.length < maxFeatures && highlights.changes.length) {
    pushUnique(highlights.features, highlights.changes.shift(), maxFeatures)
  }

  if (fallback && !highlights.features.length && !highlights.fixes.length) {
    highlights.features.push('新版本安装包已准备就绪，桌面端体验继续升级。')
  }

  return {
    features: highlights.features.slice(0, maxFeatures),
    fixes: highlights.fixes.slice(0, maxFixes),
  }
}

export function buildReleaseHighlightsMarkdown(release, options = {}) {
  const highlights = extractReleaseHighlights(release, {
    maxFeatures: options.maxFeatures ?? 4,
    maxFixes: options.maxFixes ?? 4,
    fallback: false,
  })
  const sections = []

  if (highlights.features.length) {
    sections.push([
      '**本次更新**',
      ...highlights.features.map((item) => `- ${item}`),
    ].join('\n'))
  }

  if (highlights.fixes.length) {
    sections.push([
      '**问题修复**',
      ...highlights.fixes.map((item) => `- ${item}`),
    ].join('\n'))
  }

  if (!sections.length && options.includeEmptyMessage) {
    sections.push('**本次更新**\nRelease notes 未包含可提取的更新条目，请打开 GitHub Release 查看完整变更。')
  }

  return sections.join('\n\n')
}
