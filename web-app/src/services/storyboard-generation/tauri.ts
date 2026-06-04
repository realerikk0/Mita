import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { DefaultStoryboardGenerationService } from './default'

export class TauriStoryboardGenerationService extends DefaultStoryboardGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return fetchTauri as typeof globalThis.fetch
  }
}
