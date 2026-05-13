/**
 * Tauri Opener Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { DefaultOpenerService } from './default'

export class TauriOpenerService extends DefaultOpenerService {
  async revealItemInDir(path: string): Promise<void> {
    try {
      await invoke('open_file_explorer', { path })
    } catch (error) {
      console.error('Error revealing item in directory in Tauri:', error)
      throw error
    }
  }

  async openExternalUrl(url: string): Promise<void> {
    try {
      await openUrl(url)
    } catch (error) {
      console.error('Error opening external URL in Tauri:', error)
      throw error
    }
  }
}
