/**
 * Tauri Updater Service - Desktop implementation
 * 
 * The exact signed Update object returned by a check is retained for download
 * and install. This prevents a promotion between those actions from changing
 * the artifact the user approved.
 */

import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import type { Update } from '@tauri-apps/plugin-updater'
import type { UpdateInfo, UpdateProgressEvent } from './types'
import { DefaultUpdaterService } from './default'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export class TauriUpdaterService extends DefaultUpdaterService {
  private pendingUpdate: Update | null = null
  private downloadedUpdate: Update | null = null

  /**
   * Check the configured Biyan update route and retain the signed result.
   */
  async check(): Promise<UpdateInfo | null> {
    try {
      const currentVersion = await getVersion()
      const headers = await invoke<Record<string, string>>(
        'get_app_update_request_headers',
        { currentVersion }
      )
      const update: Update | null = await check({ headers })
      if (!update) {
        this.pendingUpdate = null
        this.downloadedUpdate = null
        return null
      }

      const manifest = update.rawJson ?? {
        version: update.version,
        notes: update.body ?? '',
        pub_date: update.date,
      }
      await invoke('record_pending_update_manifest', {
        targetVersion: update.version,
        manifestJson: canonicalJson(manifest),
      })
      this.pendingUpdate = update
      this.downloadedUpdate = null

      return {
        version: update.version,
        date: update.date,
        body: update.body,
      }
    } catch (error) {
      this.pendingUpdate = null
      this.downloadedUpdate = null
      console.error('Error checking for updates in Tauri:', error)
      return null
    }
  }

  async installAndRestart(): Promise<void> {
    try {
      const update = this.pendingUpdate
      if (!update) throw new Error('No checked update available')

      await update.download()
      await update.install()
      this.pendingUpdate = null
    } catch (error) {
      console.error('Error installing update in Tauri:', error)
      throw error
    }
  }

  async downloadUpdateWithProgress(
    progressCallback: (event: UpdateProgressEvent) => void
  ): Promise<void> {
    try {
      const update = this.pendingUpdate
      if (!update) {
        throw new Error('No checked update available')
      }

      await update.download((event) => {
        try {
          progressCallback(event as UpdateProgressEvent)
        } catch (callbackError) {
          console.warn('Error in download progress callback:', callbackError)
        }
      })

      this.downloadedUpdate = update
    } catch (error) {
      console.error('Error downloading update with progress in Tauri:', error)
      this.downloadedUpdate = null
      throw error
    }
  }

  async installDownloadedUpdate(): Promise<void> {
    try {
      if (!this.downloadedUpdate) {
        throw new Error('No downloaded update available')
      }

      await this.downloadedUpdate.install()
      this.downloadedUpdate = null
      this.pendingUpdate = null
    } catch (error) {
      console.error('Error installing downloaded update in Tauri:', error)
      throw error
    }
  }

  async downloadAndInstallWithProgress(
    progressCallback: (event: UpdateProgressEvent) => void
  ): Promise<void> {
    await this.downloadUpdateWithProgress(progressCallback)
    await this.installDownloadedUpdate()
  }
}
