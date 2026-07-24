#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_ITEMS_PER_SECTION = 12
const COMPATIBILITY_SUBJECT = /^(?:compat|compatibility)(?:\([^)]+\))?!?:\s*/i
const COMPATIBILITY_BULLET = '- [兼容] '
const RETIRED_PRODUCT_TOKEN =
  /(^|[^0-9A-Za-z])(?:jan(?:hq)?|mita|silence)(?=$|[^0-9A-Za-z])/i
const LEGACY_REPOSITORY_URL =
  /https:\/\/github\.com\/realerikk0\/Mita(?:\/[^\s)>]*)?/gi

const SECTION_DEFINITIONS = [
  {
    key: 'features',
    title: '新增功能',
    patterns: [
      /^feat(?:\([^)]+\))?!?:\s*/i,
      /新增|支持|添加|接入|上线|引入|启用|能力/,
    ],
  },
  {
    key: 'fixes',
    title: '问题修复',
    patterns: [
      /^fix(?:\([^)]+\))?!?:\s*/i,
      /修复|解决|报错|崩溃|失败|异常|不可用|缺失|错误/,
    ],
  },
  {
    key: 'improvements',
    title: '优化调整',
    patterns: [
      /^(?:perf|refactor|style)(?:\([^)]+\))?!?:\s*/i,
      /优化|调整|改进|增强|升级|更新|重构|清理/,
    ],
  },
  {
    key: 'maintenance',
    title: '维护更新',
    patterns: [
      /^(?:build|chore|ci|docs|test)(?:\([^)]+\))?!?:\s*/i,
      /文档|测试|依赖|构建|工作流|发布|分发|CI/i,
    ],
  },
]

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

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.allowFailure ? 'pipe' : 'inherit'],
  }).trim()
}

function tryGit(args) {
  try {
    return git(args, { allowFailure: true })
  } catch {
    return ''
  }
}

function normalizeRemoteUrl(url) {
  const trimmed = String(url ?? '').trim().replace(/\.git$/, '')
  const sshMatch = /^git@([^:]+):(.+)$/.exec(trimmed)
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`
  return trimmed
}

function repoUrlFromEnvironment(env = process.env) {
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`
  }
  return normalizeRemoteUrl(tryGit(['config', '--get', 'remote.origin.url']))
}

export function findPreviousTag(currentTag) {
  const tags = tryGit(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)

  const index = tags.indexOf(currentTag)
  if (index >= 0) return tags[index + 1] ?? ''
  return tags.find((tag) => tag !== currentTag) ?? ''
}

function subjectWithoutConventionalPrefix(subject) {
  return subject
    .replace(/^(?:feat|fix|perf|refactor|style|build|chore|ci|docs|test|compat|compatibility)(?:\([^)]+\))?!?:\s*/i, '')
    .replace(/\s+\(#\d+\)$/g, '')
    .replace(/\s+@\S+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNoiseSubject(subject) {
  return /^(?:merge\b|revert\b|release\b|bump version\b)/i.test(subject.trim())
}

function categorizeCommit(subject) {
  if (COMPATIBILITY_SUBJECT.test(subject)) return 'maintenance'
  const type = /^(feat|fix|perf|refactor|style|build|chore|ci|docs|test)(?:\([^)]+\))?!?:/i
    .exec(subject)?.[1]
    ?.toLowerCase()
  if (type === 'feat') return 'features'
  if (type === 'fix') return 'fixes'
  if (['perf', 'refactor', 'style'].includes(type)) return 'improvements'
  if (['build', 'chore', 'ci', 'docs', 'test'].includes(type)) return 'maintenance'

  for (const section of SECTION_DEFINITIONS) {
    if (section.patterns.some((pattern) => pattern.test(subject))) {
      return section.key
    }
  }
  return 'improvements'
}

function hasRetiredProductToken(value) {
  return RETIRED_PRODUCT_TOKEN.test(
    String(value ?? '').replace(LEGACY_REPOSITORY_URL, ''),
  )
}

export function validateReleaseNotesProductPolicy(notes) {
  const lines = String(notes ?? '').replace(/\r\n?/g, '\n').split('\n')
  for (const [index, line] of lines.entries()) {
    if (!hasRetiredProductToken(line)) continue
    if (line.startsWith(COMPATIBILITY_BULLET)) continue
    throw new Error(
      `Release notes line ${index + 1} contains a retired product name outside an explicit ${COMPATIBILITY_BULLET.trim()} item`,
    )
  }
  return true
}

export function collectCommitSubjects(tagName, previousTag) {
  const range = previousTag ? `${previousTag}..${tagName}` : tagName
  const output = tryGit(['log', '--no-merges', '--format=%s', range])
  return output
    .split(/\r?\n/)
    .map((subject) => subject.trim())
    .filter(Boolean)
}

export function buildReleaseNotes({
  tagName,
  previousTag = '',
  commitSubjects = [],
  repoUrl = '',
  maxItemsPerSection = DEFAULT_MAX_ITEMS_PER_SECTION,
} = {}) {
  if (!tagName) throw new Error('tagName is required')

  const categorized = Object.fromEntries(
    SECTION_DEFINITIONS.map((section) => [section.key, []]),
  )
  const seen = new Set()

  for (const subject of commitSubjects) {
    if (isNoiseSubject(subject)) continue

    const item = subjectWithoutConventionalPrefix(subject)
    if (!item || seen.has(item)) continue
    const compatibility = COMPATIBILITY_SUBJECT.test(subject)
    if (hasRetiredProductToken(item) && !compatibility) {
      throw new Error(
        `Release note subject contains a retired product name without a compat: prefix: ${subject}`,
      )
    }

    seen.add(item)
    categorized[categorizeCommit(subject)].push(
      compatibility ? `[兼容] ${item}` : item,
    )
  }

  const lines = []
  for (const section of SECTION_DEFINITIONS) {
    const items = categorized[section.key]
    if (!items.length) continue

    lines.push(`## ${section.title}`, '')
    for (const item of items.slice(0, maxItemsPerSection)) {
      lines.push(`- ${item}`)
    }
    if (items.length > maxItemsPerSection) {
      lines.push(`- 另有 ${items.length - maxItemsPerSection} 项同类更新，详见完整变更。`)
    }
    lines.push('')
  }

  if (!lines.length) {
    lines.push(
      '## 优化调整',
      '',
      '- 本次发布未检测到 tag 区间内的可归类提交，请在发布前补充本段内容。',
      '',
    )
  }

  const compareUrl = repoUrl && previousTag
    ? `${repoUrl}/compare/${previousTag}...${tagName}`
    : ''
  lines.push('## 完整变更', '')
  lines.push(compareUrl || `${previousTag ? `${previousTag}...` : ''}${tagName}`)

  const notes = `${lines.join('\n').trim()}\n`
  validateReleaseNotesProductPolicy(notes)
  return notes
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const tagName = args.tag ?? process.env.GITHUB_REF_NAME
  if (!tagName) throw new Error('--tag is required')

  const output = args.output ?? 'dist/release-notes.md'
  const previousTag = args['previous-tag'] ?? findPreviousTag(tagName)
  const maxItemsPerSection = Number(args['max-items-per-section'] ?? DEFAULT_MAX_ITEMS_PER_SECTION)
  const commitSubjects = collectCommitSubjects(tagName, previousTag)
  const repoUrl = normalizeRemoteUrl(args['repo-url'] ?? repoUrlFromEnvironment())

  const notes = buildReleaseNotes({
    tagName,
    previousTag,
    commitSubjects,
    repoUrl,
    maxItemsPerSection,
  })

  ensureDirectory(output)
  fs.writeFileSync(output, notes)
  console.log(`Generated release notes for ${tagName}${previousTag ? ` from ${previousTag}` : ''}: ${output}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
