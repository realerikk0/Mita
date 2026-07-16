import { BaseExtension, ExtensionTypeEnum } from '@biyan/core'

import { getServiceHub } from '@/hooks/useServiceHub'

const ALLOWED_BUNDLED_EXTENSION_IDS = new Set([
  '@biyan/assistant-extension',
  '@biyan/conversational-extension',
  '@biyan/download-extension',
])

export const isAllowedBundledExtension = (name: string): boolean =>
  ALLOWED_BUNDLED_EXTENSION_IDS.has(name)

/**
 * Extension manifest object.
 */
export class Extension {
  /** @type {string} Name of the extension. */
  name: string

  /** @type {string} Product name of the extension. */
  productName?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active?: boolean

  /** @type {string} Extension's description. */
  description?: string

  /** @type {string} Extension's version. */
  version?: string

  /** @type {BaseExtension} Pre-loaded extension instance for web extensions. */
  extensionInstance?: BaseExtension

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string,
    extensionInstance?: BaseExtension
  ) {
    this.name = name
    this.productName = productName
    this.url = url
    this.active = active
    this.description = description
    this.version = version
    this.extensionInstance = extensionInstance
  }
}

export type ExtensionManifest = {
  url: string
  name: string
  productName?: string
  active?: boolean
  description?: string
  version?: string
  extensionInstance?: BaseExtension // For web extensions
}

/**
 * Manages the registration and retrieval of extensions.
 */
export class ExtensionManager {
  date = new Date().toISOString()
  // Registered extensions
  private extensions = new Map<string, BaseExtension>()

  /**
   * Registers an extension.
   * @param extension - The extension to register.
   */
  register<T extends BaseExtension>(name: string, extension: T) {
    // Register for naming use
    this.extensions.set(name, extension)

  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  get<T extends BaseExtension>(type: ExtensionTypeEnum): T | undefined {
    return this.getAll().find((e) => e.type() === type) as T | undefined
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  getByName(name: string): BaseExtension | undefined {
    return this.extensions.get(name) as BaseExtension | undefined
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  getAll(): BaseExtension[] {
    return Array.from(this.extensions.values())
  }

  /**
   * Loads all registered extension.
   */
  async load() {
    const extensions = Array.from(this.extensions.entries())
    const results = await Promise.allSettled(
      extensions.map(([, ext]) => ext.onLoad())
    )

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const extensionName = extensions[index]?.[0] ?? 'unknown'
        console.error(
          `Failed to load extension '${extensionName}'`,
          result.reason
        )
      }
    })
  }

  /**
   * Unloads all registered extensions.
   */
  unload() {
    this.listExtensions().forEach((ext) => {
      ext.onUnload()
    })
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  listExtensions() {
    return [...this.extensions.values()]
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  async getActive(): Promise<Extension[]> {
    const manifests = await getServiceHub().core().getActiveExtensions()
    if (!manifests || !Array.isArray(manifests)) return []

    const extensions: Extension[] = manifests
      .filter(
        (manifest: ExtensionManifest) =>
          manifest.active !== false && isAllowedBundledExtension(manifest.name)
      )
      .map((manifest: ExtensionManifest) => {
        return new Extension(
          manifest.url,
          manifest.name,
          manifest.productName,
          manifest.active,
          manifest.description,
          manifest.version,
          manifest.extensionInstance // Pass the extension instance if available
        )
      })
    
    return extensions
  }

  /**
   * Register a extension with its class.
   * @param {Extension} extension extension object as provided by the main process.
   * @returns {void}
   */
  async activateExtension(extension: Extension) {
    if (!isAllowedBundledExtension(extension.name) || extension.active === false) {
      throw new Error(`Extension '${extension.name}' is not allowed by Biyan`)
    }
    // Check if extension already has a pre-loaded instance (web extensions)
    if (extension.extensionInstance) {
      this.register(extension.name, extension.extensionInstance)
      console.log(`Extension '${extension.name}' registered with pre-loaded instance`)
      return
    }
    
    // Import class for Tauri extensions
    const extensionUrl = extension.url
    await import(/* @vite-ignore */ getServiceHub().core().convertFileSrc(extensionUrl)).then(
      (extensionClass) => {
        // Register class if it has a default export
        if (
          typeof extensionClass.default === 'function' &&
          extensionClass.default.prototype
        ) {
          this.register(
            extension.name,
            new extensionClass.default(
              extension.url,
              extension.name,
              extension.productName,
              extension.active,
              extension.description,
              extension.version
            )
          )
        }
      }
    )
  }

  /**
   * Registers all active extensions.
   * @returns {void}
   */
  async registerActive() {
    // Get active extensions
    const activeExtensions = (await this.getActive()) ?? []
    // Activate all
    const results = await Promise.allSettled(
      activeExtensions.map((ext: Extension) => this.activateExtension(ext))
    )

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `Failed to activate extension '${activeExtensions[index]?.name ?? 'unknown'}'`,
          result.reason
        )
      }
    })
  }

  /**
   * Install a new extension.
   * @param {Array.<installOptions | string>} extensions A list of NPM specifiers, or installation configuration objects.
   * @returns {Promise.<Array.<Extension> | false>} extension as defined by the main process. Has property cancelled set to true if installation was cancelled in the main process.
   */
  async install(extensions: ExtensionManifest[]) {
    if (typeof window === 'undefined') {
      return
    }
    const allowedExtensions = extensions.filter((extension) =>
      isAllowedBundledExtension(extension.name)
    )
    if (allowedExtensions.length !== extensions.length) {
      throw new Error('One or more extension IDs are not allowed by Biyan')
    }
    const res = await getServiceHub().core().installExtension(allowedExtensions)
    if (!Array.isArray(res)) return []

    const results = await Promise.allSettled(
      res.map(async (ext: ExtensionManifest) => {
        const extension = new Extension(
          ext.url,
          ext.name,
          ext.productName,
          ext.active,
          ext.description,
          ext.version,
          ext.extensionInstance
        )
        await this.activateExtension(extension)
        return extension
      })
    )

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `Failed to activate installed extension '${res[index]?.name ?? 'unknown'}'`,
          result.reason
        )
      }
    })

    return results
      .filter(
        (result): result is PromiseFulfilledResult<Extension> =>
          result.status === 'fulfilled'
      )
      .map((result) => result.value)
  }

  /**
   * Uninstall provided extensions
   * @param {Array.<string>} extensions List of names of extensions to uninstall.
   * @param {boolean} reload Whether to reload all renderers after updating the extensions.
   * @returns {Promise.<boolean>} Whether uninstalling the extensions was successful.
   */
  async uninstall(extensions: string[], reload = true) {
    if (typeof window === 'undefined') {
      return
    }
    return await getServiceHub().core().uninstallExtension(extensions, reload)
  }

  /**
   * Shared instance of ExtensionManager.
   */
  static getInstance() {
    if (!window.core.extensionManager)
      window.core.extensionManager = new ExtensionManager()
    return window.core.extensionManager as ExtensionManager
  }
}
