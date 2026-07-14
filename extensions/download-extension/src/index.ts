import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { BaseExtension, events } from '@biyan/core'

interface DownloadItem {
  url: string
  save_path: string
  proxy?: ProxyConfig
  sha256?: string
  size?: number
}

interface ProxyConfig {
  url: string
  username?: string
  password?: string
  no_proxy?: string[]
  ignore_ssl?: boolean
}

type DownloadEvent = {
  transferred: number
  total: number
}

export default class DownloadManager extends BaseExtension {
  async onLoad() {}

  async onUnload() {}

  async downloadFile(
    url: string,
    savePath: string,
    taskId: string,
    proxyConfig?: ProxyConfig,
    onProgress?: (transferred: number, total: number) => void
  ) {
    const item: DownloadItem = { url, save_path: savePath }
    if (proxyConfig) item.proxy = proxyConfig

    return await this.downloadFiles(
      [item],
      taskId,
      onProgress
    )
  }

  async downloadFiles(
    items: DownloadItem[],
    taskId: string,
    onProgress?: (transferred: number, total: number) => void
  ) {
    // relay tauri events to onProgress callback
    const unlisten = await listen<DownloadEvent>(
      `download-${taskId}`,
      (event) => {
        if (onProgress) {
          let payload = event.payload
          onProgress(payload.transferred, payload.total)
        }
      }
    )

    try {
      await invoke<void>('download_files', {
        items,
        taskId,
        headers: {},
      })
    } catch (error) {
      console.error('Error downloading task', taskId, error)
      throw error
    } finally {
      unlisten()
    }
  }

  async cancelDownload(taskId: string) {
    try {
      await invoke<void>('cancel_download_task', { taskId })
    } catch (error) {
      console.error('Error cancelling download:', error)
      throw error
    }
  }
}
