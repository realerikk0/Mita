import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function tauriCsp() {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const configPath = resolve(currentDir, '../../../src-tauri/tauri.conf.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    app?: {
      security?: {
        csp?: Record<string, string | string[]>
      }
    }
  }

  return config.app?.security?.csp ?? {}
}

describe('Tauri CSP', () => {
  it('allows generated videos to load from Tauri asset URLs', () => {
    const mediaSrc = tauriCsp()['media-src']

    expect(mediaSrc).toEqual(expect.any(String))
    expect(mediaSrc).toContain('asset:')
    expect(mediaSrc).toContain('http://asset.localhost')
  })
})
