import { invoke } from '@tauri-apps/api/core'

import { DefaultAssistantsService } from './default'

export class TauriAssistantsService extends DefaultAssistantsService {
  async getCommittedAssistantIdMap(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('get_committed_assistant_id_map')
  }
}
