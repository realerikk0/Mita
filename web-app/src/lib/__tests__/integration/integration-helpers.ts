//
// Shared helpers for env-gated provider integration tests.
//
// These tests hit a REAL provider and are skipped unless credentials are
// present in process.env (populated from the gitignored web-app/.env.integration.local).
// No `dotenv` dependency in this repo, so we parse the file ourselves.
//
import fs from 'node:fs'
import path from 'node:path'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

let loaded = false

function loadIntegrationEnv(): void {
  if (loaded) return
  loaded = true
  const candidates = [
    path.resolve(process.cwd(), '.env.integration.local'),
    path.resolve(process.cwd(), 'web-app/.env.integration.local'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()
      if (key && !(key in process.env)) process.env[key] = value
    }
    break
  }
}

export interface IntegrationCreds {
  apiKey?: string
  baseURL?: string
  model: string
}

export function anthropicCreds(): IntegrationCreds {
  loadIntegrationEnv()
  return {
    apiKey: process.env.MITA_IT_ANTHROPIC_API_KEY,
    baseURL: process.env.MITA_IT_ANTHROPIC_BASE_URL,
    model: process.env.MITA_IT_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  }
}

export function openaiCompatCreds(): IntegrationCreds {
  loadIntegrationEnv()
  return {
    apiKey: process.env.MITA_IT_OPENAI_API_KEY,
    baseURL: process.env.MITA_IT_OPENAI_BASE_URL,
    model: process.env.MITA_IT_OPENAI_MODEL || 'claude-sonnet-4-6',
  }
}

export function hasAnthropicIntegration(): boolean {
  const c = anthropicCreds()
  return Boolean(c.apiKey && c.baseURL)
}

export function hasOpenAICompatIntegration(): boolean {
  const c = openaiCompatCreds()
  return Boolean(c.apiKey && c.baseURL)
}

export function makeAnthropicModel() {
  const c = anthropicCreds()
  return createAnthropic({ apiKey: c.apiKey ?? '', baseURL: c.baseURL })(c.model)
}

export function makeOpenAICompatModel() {
  const c = openaiCompatCreds()
  return createOpenAICompatible({
    name: 'biyuan',
    apiKey: c.apiKey ?? '',
    baseURL: c.baseURL ?? '',
  })(c.model)
}
