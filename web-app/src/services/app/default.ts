/**
 * Default App Service - Generic implementation with minimal returns
 */

import type {
  AppService,
  FactoryResetOptions,
  LogEntry,
  ReadLogsOptions,
  UserLogPayload,
} from './types'

export class DefaultAppService implements AppService {
  async factoryReset(options?: FactoryResetOptions): Promise<void> {
    console.log('factoryReset called with options:', options)
    // No-op
  }

  async readLogs(_options?: ReadLogsOptions): Promise<LogEntry[]> {
    return []
  }

  parseLogLine(line: string): LogEntry {
    return {
      timestamp: Date.now(),
      level: 'info',
      target: 'default',
      message: line ?? '',
    }
  }

  async writeLog(payload: UserLogPayload): Promise<void> {
    void payload
    // No-op
  }

  async clearLogs(): Promise<void> {
    // No-op
  }

  async getLogsDirectory(): Promise<string | undefined> {
    return undefined
  }

  async getMitaDataFolder(): Promise<string | undefined> {
    return undefined
  }

  async relocateMitaDataFolder(path: string): Promise<void> {
    console.log('relocateMitaDataFolder called with path:', path)
    // No-op - not implemented in default service
  }

  async getServerStatus(): Promise<boolean> {
    return false
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    console.log('readYaml called with path:', path)
    throw new Error('readYaml not implemented in default app service')
  }
}
