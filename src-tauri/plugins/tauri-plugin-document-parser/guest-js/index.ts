import { invoke } from '@tauri-apps/api/core'

export async function parseDocument(filePath: string, fileType: string): Promise<string> {
  return await invoke('plugin:document-parser|parse_document', { filePath, fileType })
}
