/**
 * Assistants Service Types
 */

import { Assistant } from '@biyan/core'

export interface AssistantsService {
  getAssistants(): Promise<Assistant[] | null>
  getCommittedAssistantIdMap(): Promise<Record<string, string>>
  createAssistant(assistant: Assistant): Promise<void>
  deleteAssistant(assistant: Assistant): Promise<void>
}
