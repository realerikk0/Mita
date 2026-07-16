/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@biyan/core'
import type {
  FactoryResetOptions,
  LogEntry,
  ReadLogsOptions,
  UserLogPayload,
} from './types'
import { DefaultAppService } from './default'
import { localStorageKey } from '@/constants/localStorage'

export class TauriAppService extends DefaultAppService {
  /**
   * Factory reset with optional data preservation.
   *
   * User settings are persisted to `settings.json` via @tauri-apps/plugin-store
   * (see #7821). The Rust `factory_reset` command conditionally deletes
   * directories, config files, and `settings.json` based on the keep flags.
   * No frontend snapshot/restore is needed — the file store is preserved or
   * wiped on disk by the Rust side.
  */
  async factoryReset(options?: FactoryResetOptions): Promise<void> {
    const keepAppData = options?.keepAppData ?? false
    const keepConfigurations = options?.keepConfigurations ?? false

    if (!keepAppData) {
      try {
        localStorage.removeItem?.(localStorageKey.threadManagement)
      } catch (error) {
        console.error('Failed to clear persisted project state:', error)
      }
    }

    if (!keepAppData && !keepConfigurations) {
      await invoke('factory_reset')
    } else {
      await invoke('factory_reset', { keepAppData, keepConfigurations })
    }
  }

  async readLogs(options?: ReadLogsOptions): Promise<LogEntry[]> {
    let logData = ''
    try {
      logData = (await invoke<string>('read_user_logs', { options })) ?? ''
    } catch {
      logData = (await invoke<string>('read_logs')) ?? ''
    }
    return logData
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => this.parseLogLine(line))
  }

  async writeLog(payload: UserLogPayload): Promise<void> {
    await invoke('write_user_log', { entry: payload })
  }

  async clearLogs(): Promise<void> {
    await invoke('clear_user_logs')
  }

  async getLogsDirectory(): Promise<string | undefined> {
    return await invoke<string>('get_user_logs_directory')
  }

  async getBiyanDataFolder(): Promise<string | undefined> {
    try {
      const appConfiguration: AppConfiguration | undefined =
        await window.core?.api?.getAppConfigurations()

      return appConfiguration?.data_folder
    } catch (error) {
      console.error('Failed to get Biyan data folder:', error)
      return undefined
    }
  }

  async relocateBiyanDataFolder(path: string): Promise<void> {
    await window.core?.api?.changeAppDataFolder({ newDataFolder: path })
  }

  parseLogLine(line: string): LogEntry {
    try {
      const parsed = JSON.parse(line) as {
        ts?: string
        level?: string
        target?: string
        event?: string
        message?: string
        context?: unknown
        error?: unknown
        appVersion?: string
        platform?: string
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          timestamp: parsed.ts ?? Date.now(),
          level: this.normalizeLogLevel(parsed.level),
          target: parsed.target ?? 'app',
          event: parsed.event,
          message:
            parsed.event === 'runtime.log'
              ? this.stripLegacyLogPrefix(parsed.message ?? '')
              : (parsed.message ?? ''),
          context: parsed.context,
          error: parsed.error,
          appVersion: parsed.appVersion,
          platform: parsed.platform,
        }
      }
    } catch {
      // Fall through to legacy plain-text parsing.
    }

    const regex = /^\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]\s(.*)$/
    const match = line.match(regex)

    if (!match)
      return {
        timestamp: Date.now(),
        level: 'info',
        target: 'info',
        message: line ?? '',
      }

    const [, date, time, target, levelRaw, message] = match

    return {
      timestamp: `${date} ${time}`,
      level: this.normalizeLogLevel(levelRaw),
      target,
      message,
    }
  }

  private normalizeLogLevel(level?: string): LogEntry['level'] {
    switch (level?.toLowerCase()) {
      case 'debug':
      case 'trace':
        return 'debug'
      case 'warn':
      case 'warning':
        return 'warn'
      case 'error':
        return 'error'
      default:
        return 'info'
    }
  }

  private stripLegacyLogPrefix(message: string): string {
    const match = message.match(
      /^\[\d{4}-\d{2}-\d{2}\]\[[^\]]+\]\[[^\]]+\]\[(trace|debug|info|warn|warning|error)\]\s(.*)$/i
    )
    return match ? match[2] : message
  }

  async getServerStatus(): Promise<boolean> {
    return await invoke<boolean>('get_server_status')
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    return await invoke<T>('read_yaml', { path })
  }
}
