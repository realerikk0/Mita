/**
 * Service Hub - Centralized service initialization and access
 *
 * This hub initializes all platform services once at app startup,
 * then provides synchronous access to service instances throughout the app.
 */

import { isPlatformTauri, isPlatformIOS, isPlatformAndroid } from '@/lib/platform/utils'
import { logUserError, writeUserLog } from '@/lib/user-log'

// Import default services
import { DefaultThemeService } from './theme/default'
import { DefaultWindowService } from './window/default'
import { DefaultEventsService } from './events/default'
import { DefaultHardwareService } from './hardware/default'
import { DefaultAppService } from './app/default'
import { DefaultAnalyticService } from './analytic/default'
import { DefaultMessagesService } from './messages/default'
import { DefaultMCPService } from './mcp/default'
import { DefaultThreadsService } from './threads/default'
import { DefaultProvidersService } from './providers/default'
import { DefaultAssistantsService } from './assistants/default'
import { DefaultDialogService } from './dialog/default'
import { DefaultOpenerService } from './opener/default'
import { DefaultUpdaterService } from './updater/default'
import { DefaultPathService } from './path/default'
import { DefaultCoreService } from './core/default'
import { DefaultDeepLinkService } from './deeplink/default'
import { DefaultProjectsService } from './projects/default'
import { DefaultImageGenerationService } from './image-generation/default'
import type { ImageGenerationService } from './image-generation/types'
import { DefaultVideoGenerationService } from './video-generation/default'
import type { VideoGenerationService } from './video-generation/types'
import { DefaultStoryboardGenerationService } from './storyboard-generation/default'
import type { StoryboardGenerationService } from './storyboard-generation/types'
import { DefaultNovelService } from './novels/default'
import type { NovelService } from './novels/types'

// Import service types
import type { ThemeService } from './theme/types'
import type { WindowService } from './window/types'
import type { EventsService } from './events/types'
import type { HardwareService } from './hardware/types'
import type { AppService } from './app/types'
import type { AnalyticService } from './analytic/types'
import type { MessagesService } from './messages/types'
import type { MCPService } from './mcp/types'
import type { ThreadsService } from './threads/types'
import type { ProvidersService } from './providers/types'
import type { AssistantsService } from './assistants/types'
import type { DialogService } from './dialog/types'
import type { OpenerService } from './opener/types'
import type { UpdaterService } from './updater/types'
import type { PathService } from './path/types'
import type { CoreService } from './core/types'
import type { DeepLinkService } from './deeplink/types'
import type { ProjectsService } from './projects/types'

export interface ServiceHub {
  // Service getters - all synchronous after initialization
  theme(): ThemeService
  window(): WindowService
  events(): EventsService
  hardware(): HardwareService
  app(): AppService
  analytic(): AnalyticService
  messages(): MessagesService
  mcp(): MCPService
  threads(): ThreadsService
  providers(): ProvidersService
  assistants(): AssistantsService
  dialog(): DialogService
  opener(): OpenerService
  updater(): UpdaterService
  path(): PathService
  core(): CoreService
  deeplink(): DeepLinkService
  projects(): ProjectsService
  imageGeneration(): ImageGenerationService
  videoGeneration(): VideoGenerationService
  storyboardGeneration(): StoryboardGenerationService
  novels(): NovelService
}

class PlatformServiceHub implements ServiceHub {
  private themeService: ThemeService = new DefaultThemeService()
  private windowService: WindowService = new DefaultWindowService()
  private eventsService: EventsService = new DefaultEventsService()
  private hardwareService: HardwareService = new DefaultHardwareService()
  private appService: AppService = new DefaultAppService()
  private analyticService: AnalyticService = new DefaultAnalyticService()
  private messagesService: MessagesService = new DefaultMessagesService()
  private mcpService: MCPService = new DefaultMCPService()
  private threadsService: ThreadsService = new DefaultThreadsService()
  private providersService: ProvidersService = new DefaultProvidersService()
  private assistantsService: AssistantsService = new DefaultAssistantsService()
  private dialogService: DialogService = new DefaultDialogService()
  private openerService: OpenerService = new DefaultOpenerService()
  private updaterService: UpdaterService = new DefaultUpdaterService()
  private pathService: PathService = new DefaultPathService()
  private coreService: CoreService = new DefaultCoreService()
  private deepLinkService: DeepLinkService = new DefaultDeepLinkService()
  private projectsService: ProjectsService = new DefaultProjectsService()
  private imageGenerationService: ImageGenerationService =
    new DefaultImageGenerationService()
  private videoGenerationService: VideoGenerationService =
    new DefaultVideoGenerationService()
  private storyboardGenerationService: StoryboardGenerationService =
    new DefaultStoryboardGenerationService()
  private novelService: NovelService = new DefaultNovelService()
  private initialized = false

  /**
   * Initialize all platform services
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const platform =
      isPlatformTauri() && !isPlatformIOS() && !isPlatformAndroid() ? 'tauri' :
      isPlatformIOS() ? 'ios' :
      isPlatformAndroid() ? 'android' : 'web'

    console.log(
      'Initializing service hub for platform:',
      platform === 'tauri' ? 'Tauri' :
      platform === 'ios' ? 'iOS' :
      platform === 'android' ? 'Android' : 'Web'
    )

    try {
      if (isPlatformTauri() && !isPlatformIOS() && !isPlatformAndroid()) {
        // Desktop Tauri
        const [
          themeModule,
          windowModule,
          eventsModule,
          hardwareModule,
          appModule,
          mcpModule,
          providersModule,
          assistantsModule,
          dialogModule,
          openerModule,
          updaterModule,
          pathModule,
          coreModule,
          deepLinkModule,
          imageGenerationModule,
          videoGenerationModule,
          storyboardGenerationModule,
          novelModule,
        ] = await Promise.all([
          import('./theme/tauri'),
          import('./window/tauri'),
          import('./events/tauri'),
          import('./hardware/tauri'),
          import('./app/tauri'),
          import('./mcp/tauri'),
          import('./providers/tauri'),
          import('./assistants/tauri'),
          import('./dialog/tauri'),
          import('./opener/tauri'),
          import('./updater/tauri'),
          import('./path/tauri'),
          import('./core/tauri'),
          import('./deeplink/tauri'),
          import('./image-generation/tauri'),
          import('./video-generation/tauri'),
          import('./storyboard-generation/tauri'),
          import('./novels/tauri'),
        ])

        this.themeService = new themeModule.TauriThemeService()
        this.windowService = new windowModule.TauriWindowService()
        this.eventsService = new eventsModule.TauriEventsService()
        this.hardwareService = new hardwareModule.TauriHardwareService()
        this.appService = new appModule.TauriAppService()
        this.mcpService = new mcpModule.TauriMCPService()
        this.providersService = new providersModule.TauriProvidersService()
        this.assistantsService = new assistantsModule.TauriAssistantsService()
        this.dialogService = new dialogModule.TauriDialogService()
        this.openerService = new openerModule.TauriOpenerService()
        this.updaterService = new updaterModule.TauriUpdaterService()
        this.pathService = new pathModule.TauriPathService()
        this.coreService = new coreModule.TauriCoreService()
        this.deepLinkService = new deepLinkModule.TauriDeepLinkService()
        this.imageGenerationService =
          new imageGenerationModule.TauriImageGenerationService()
        this.videoGenerationService =
          new videoGenerationModule.TauriVideoGenerationService()
        this.storyboardGenerationService =
          new storyboardGenerationModule.TauriStoryboardGenerationService()
        this.novelService = new novelModule.TauriNovelService()
      } else if (isPlatformIOS() || isPlatformAndroid()) {
        const [
          themeModule,
          windowModule,
          eventsModule,
          appModule,
          mcpModule,
          providersModule,
          assistantsModule,
          dialogModule,
          openerModule,
          pathModule,
          coreModule,
          deepLinkModule,
        ] = await Promise.all([
          import('./theme/tauri'),
          import('./window/tauri'),
          import('./events/tauri'),
          import('./app/tauri'),
          import('./mcp/tauri'),
          import('./providers/tauri'),
          import('./assistants/tauri'),
          import('./dialog/tauri'),
          import('./opener/tauri'),
          import('./path/tauri'),
          import('./core/mobile'), // Use mobile-specific core service
          import('./deeplink/tauri'),
        ])

        this.themeService = new themeModule.TauriThemeService()
        this.windowService = new windowModule.TauriWindowService()
        this.eventsService = new eventsModule.TauriEventsService()
        this.appService = new appModule.TauriAppService()
        this.mcpService = new mcpModule.TauriMCPService()
        this.providersService = new providersModule.TauriProvidersService()
        this.assistantsService = new assistantsModule.TauriAssistantsService()
        this.dialogService = new dialogModule.TauriDialogService()
        this.openerService = new openerModule.TauriOpenerService()
        this.pathService = new pathModule.TauriPathService()
        this.coreService = new coreModule.MobileCoreService() // Mobile service with pre-loaded extensions
        this.deepLinkService = new deepLinkModule.TauriDeepLinkService()
      }

      this.initialized = true
      console.log('Service hub initialized successfully')
      void writeUserLog({
        level: 'info',
        target: 'service-hub',
        event: 'service_hub.initialized',
        message: 'Service hub initialized',
        context: { platform },
      })
    } catch (error) {
      console.error('Failed to initialize service hub:', error)
      void logUserError(
        'service_hub.initialize_failed',
        error,
        { platform },
        'service-hub'
      )
      this.initialized = true
      throw error
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Service hub not initialized. Call initializeServiceHub() first.'
      )
    }
  }

  // Service getters - all synchronous after initialization
  theme(): ThemeService {
    this.ensureInitialized()
    return this.themeService
  }

  window(): WindowService {
    this.ensureInitialized()
    return this.windowService
  }

  events(): EventsService {
    this.ensureInitialized()
    return this.eventsService
  }

  hardware(): HardwareService {
    this.ensureInitialized()
    return this.hardwareService
  }

  app(): AppService {
    this.ensureInitialized()
    return this.appService
  }

  analytic(): AnalyticService {
    this.ensureInitialized()
    return this.analyticService
  }

  messages(): MessagesService {
    this.ensureInitialized()
    return this.messagesService
  }

  mcp(): MCPService {
    this.ensureInitialized()
    return this.mcpService
  }

  threads(): ThreadsService {
    this.ensureInitialized()
    return this.threadsService
  }

  providers(): ProvidersService {
    this.ensureInitialized()
    return this.providersService
  }

  assistants(): AssistantsService {
    this.ensureInitialized()
    return this.assistantsService
  }

  dialog(): DialogService {
    this.ensureInitialized()
    return this.dialogService
  }

  opener(): OpenerService {
    this.ensureInitialized()
    return this.openerService
  }

  updater(): UpdaterService {
    this.ensureInitialized()
    return this.updaterService
  }

  path(): PathService {
    this.ensureInitialized()
    return this.pathService
  }

  core(): CoreService {
    this.ensureInitialized()
    return this.coreService
  }

  deeplink(): DeepLinkService {
    this.ensureInitialized()
    return this.deepLinkService
  }

  projects(): ProjectsService {
    this.ensureInitialized()
    return this.projectsService
  }

  imageGeneration(): ImageGenerationService {
    this.ensureInitialized()
    return this.imageGenerationService
  }

  videoGeneration(): VideoGenerationService {
    this.ensureInitialized()
    return this.videoGenerationService
  }

  storyboardGeneration(): StoryboardGenerationService {
    this.ensureInitialized()
    return this.storyboardGenerationService
  }

  novels(): NovelService {
    this.ensureInitialized()
    return this.novelService
  }
}

export async function initializeServiceHub(): Promise<ServiceHub> {
  const serviceHub = new PlatformServiceHub()
  await serviceHub.initialize()
  return serviceHub
}
