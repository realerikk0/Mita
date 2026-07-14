import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(process.cwd(), 'web-app/src')
const localeRoot = path.join(sourceRoot, 'locales')
const localeNames = fs
  .readdirSync(localeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const readLocale = (locale: string, namespace: string) =>
  JSON.parse(
    fs.readFileSync(path.join(localeRoot, locale, `${namespace}.json`), 'utf8')
  ) as Record<string, unknown>

const flattenKeys = (
  value: Record<string, unknown>,
  prefix = '',
  output: string[] = []
) => {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenKeys(nested as Record<string, unknown>, path, output)
    } else {
      output.push(path)
    }
  }
  return output
}

const getNestedValue = (value: Record<string, unknown>, key: string) =>
  key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, value)

const collectProductionTranslationKeys = (namespace: string) => {
  const keys = new Set<string>()
  const quote = "['\"`]"
  const literal = new RegExp(
    `${quote}${namespace}:([A-Za-z0-9_.-]+)${quote}`,
    'g'
  )

  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'locales') continue
        walk(path.join(directory, entry.name))
        continue
      }
      if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue
      if (/(?:\.test|\.spec)\./.test(entry.name)) continue
      const source = fs.readFileSync(path.join(directory, entry.name), 'utf8')
      for (const match of source.matchAll(literal)) keys.add(match[1])
    }
  }

  walk(sourceRoot)
  return [...keys].sort()
}

describe('Phase C locale contract', () => {
  it('keeps every settings locale isomorphic to production settings references', () => {
    const reachableSettingsKeys = collectProductionTranslationKeys('settings')
    expect(reachableSettingsKeys.length).toBeGreaterThan(0)

    for (const locale of localeNames) {
      expect(flattenKeys(readLocale(locale, 'settings')).sort()).toEqual(
        reachableSettingsKeys
      )
    }
  })

  it('does not bundle retired local-model Hub or setup namespaces', () => {
    expect(collectProductionTranslationKeys('hub')).toEqual([])
    expect(collectProductionTranslationKeys('setup')).toEqual([])

    for (const locale of localeNames) {
      expect(fs.existsSync(path.join(localeRoot, locale, 'hub.json'))).toBe(false)
      expect(fs.existsSync(path.join(localeRoot, locale, 'setup.json'))).toBe(
        false
      )
    }
  })

  it('removes retired model-download and local-inference copy from bundled locales', () => {
    const retiredCopy =
      /\bllama(?:\.?cpp)?\b|\bmlx\b|huggingface|local (?:AI )?model|local inference|offline AI|download(?:ed|ing)? model|model download|本地(?: AI )?模型|本地推理|下载模型|模型下载|ローカルモデル|ローカル推論|로컬 모델|로컬 추론|локальн\S* модел|modelo local|model local|modèle local|lokalny model|model lokal|mô hình cục bộ/iu

    for (const locale of localeNames) {
      const common = readLocale(locale, 'common')
      for (const key of [
        'hub',
        'missingDependenciesDialog',
        'attachmentsIngestion',
        'attachmentEmbeddedIndicator',
        'toast.modelValidationStarted',
        'toast.modelValidationFailed',
        'toast.downloadAndVerificationComplete',
      ]) {
        expect(getNestedValue(common, key)).toBeUndefined()
      }

      for (const file of fs
        .readdirSync(path.join(localeRoot, locale))
        .filter((entry) => entry.endsWith('.json'))) {
        expect(
          fs.readFileSync(path.join(localeRoot, locale, file), 'utf8')
        ).not.toMatch(retiredCopy)
      }
    }
  })

  it('points vision-model recovery at Provider settings, not the retired Hub', () => {
    const retiredHubLabel = /\bHub\b|中心|ハブ|허브|Хаб|हब|Centrum/iu

    for (const locale of localeNames) {
      const common = readLocale(locale, 'common')
      const action = getNestedValue(common, 'toast.modelNoVision.action')
      expect(action).toEqual(expect.any(String))
      expect(action).not.toMatch(retiredHubLabel)
    }
  })

  it('keeps empty-provider guidance remote-only', () => {
    const remoteProviderGuidance =
      'Available models from the configured remote provider will be listed here. Refresh after adding or changing provider credentials.'

    for (const locale of localeNames) {
      expect(readLocale(locale, 'providers').noModelFoundDesc).toBe(
        remoteProviderGuidance
      )
    }
  })
})
