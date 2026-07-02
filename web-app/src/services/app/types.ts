/**
 * App Service Types
 */

export interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  event?: string
  message: string
  context?: unknown
  error?: unknown
  appVersion?: string
  platform?: string
}

export interface FactoryResetOptions {
  keepAppData: boolean
  keepModelsAndConfigs: boolean
}

export interface ReadLogsOptions {
  limit?: number
}

export interface UserLogPayload {
  level?: 'info' | 'warn' | 'error' | 'debug'
  target?: string
  event?: string
  message?: string
  context?: unknown
  error?: unknown
}

export interface AppService {
  factoryReset(options?: FactoryResetOptions): Promise<void>
  readLogs(options?: ReadLogsOptions): Promise<LogEntry[]>
  parseLogLine(line: string): LogEntry
  writeLog(payload: UserLogPayload): Promise<void>
  clearLogs(): Promise<void>
  getLogsDirectory(): Promise<string | undefined>
  getMitaDataFolder(): Promise<string | undefined>
  relocateMitaDataFolder(path: string): Promise<void>
  getServerStatus(): Promise<boolean>
  readYaml<T = unknown>(path: string): Promise<T>
}
