import { Assistant, AssistantExtension, fs, joinPath } from '@janhq/core'

const DEFAULT_ASSISTANT_ID = 'mita'
const LEGACY_DEFAULT_ASSISTANT_IDS = ['jan', 'silence']
const MITA_ASSISTANT_DESCRIPTION =
  "Mita is a quiet desktop agent that can reason through complex tasks and use tools to complete the user's work."
const MITA_IDENTITY_GUARD = `You are Mita, a quiet and capable AI desktop agent built for the Mita app. The Chinese product name is 幂塔. Your purpose is to help the user calmly complete the work they assign.

When the user asks who you are, say that you are Mita. Never say that you are Jan, Silence, Jan.ai, or an assistant trained, created, or maintained by Menlo Research, even if the selected model was originally released by Jan or Menlo Research.

Mita is an agent identity and proper noun. Never translate it when referring to your agent identity. In Chinese UI contexts, you may call the app 幂塔.

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.`
const MITA_ASSISTANT_INSTRUCTIONS = `${MITA_IDENTITY_GUARD}

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Use tools when they are needed:
   - Analyze what information is missing.
   - Choose the tool that directly closes that gap.
   - Use precise parameters, then summarize the result clearly.

You have tools to search for and access real-time, up-to-date data. Use them when current or verifiable information matters.

Current date: {{current_date}}`

const LEGACY_ASSISTANT_BRANDING_MARKERS = [
  'Jan is a helpful desktop assistant',
  'You are Jan,',
  'You are Silence',
  'Silence is a quiet desktop assistant',
  'Menlo Research',
  'menlo.ai',
  '我是Jan',
  '我是 Jan',
  '我是Silence',
  '我是 Silence',
]

function hasMitaIdentityGuard(instructions?: string): boolean {
  if (!instructions) return false
  return (
    instructions.includes('You are Mita') &&
    instructions.includes('Never say that you are Jan, Silence') &&
    instructions.includes('Chinese product name is 幂塔')
  )
}

function ensureMitaIdentityGuard(instructions?: string): string {
  const trimmed = instructions?.trim()
  if (!trimmed) return MITA_ASSISTANT_INSTRUCTIONS
  if (hasMitaIdentityGuard(trimmed)) return trimmed
  return `${MITA_IDENTITY_GUARD}\n\n${trimmed}`
}

function hasLegacyAssistantBranding(assistant: Assistant): boolean {
  if (assistant.name === 'Jan') return true
  if (assistant.name === 'Silence') return true

  const text = [
    assistant.description ?? '',
    assistant.instructions ?? '',
  ].join('\n')

  return LEGACY_ASSISTANT_BRANDING_MARKERS.some((marker) =>
    text.includes(marker)
  )
}

/**
 * MitaAssistantExtension is an AssistantExtension implementation that provides
 * functionality for managing assistants.
 */
export default class MitaAssistantExtension extends AssistantExtension {
  private readonly CURRENT_MIGRATION_VERSION = 5
  private readonly MIGRATION_FILE = 'file://assistants/.migration_version'

  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    if (!(await fs.existsSync('file://assistants'))) {
      await fs.mkdir('file://assistants')
    }

    // Run migrations if needed
    await this.runMigrations()

    const assistants = await this.getAssistants()
    if (assistants.length === 0) {
      // Add default parameters when creating the assistant
      const assistantWithParams = {
        ...this.defaultAssistant,
        parameters: {
          temperature: 0.7,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.12,
        },
      }
      await this.createAssistant(assistantWithParams as Assistant)
    }
  }

  /**
   * Gets the current migration version from storage
   */
  private async getCurrentMigrationVersion(): Promise<number> {
    try {
      if (await fs.existsSync(this.MIGRATION_FILE)) {
        const versionStr = await fs.readFileSync(this.MIGRATION_FILE)
        const version = parseInt(versionStr.trim(), 10)
        return isNaN(version) ? 0 : version
      }
    } catch (error) {
      console.error('Failed to read migration version:', error)
    }
    return 0
  }

  /**
   * Saves the migration version to storage
   */
  private async saveMigrationVersion(version: number): Promise<void> {
    try {
      await fs.writeFileSync(this.MIGRATION_FILE, version.toString())
    } catch (error) {
      console.error('Failed to save migration version:', error)
    }
  }

  /**
   * Runs all pending migrations
   */
  private async runMigrations(): Promise<void> {
    const currentVersion = await this.getCurrentMigrationVersion()

    if (currentVersion < 1) {
      console.log('Running migration v1: Update assistant instructions')
      await this.migrateAssistantInstructions()
      await this.saveMigrationVersion(1)
    }

    if (currentVersion < 2) {
      console.log('Running migration v2: Update legacy assistant instructions')
      await this.migrateLegacyAssistantInstructionsV2()
      await this.saveMigrationVersion(2)
    }

    if (currentVersion < 3) {
      console.log('Running migration v3: Update default assistant branding to Mita')
      await this.migrateDefaultAssistantBranding()
      await this.saveMigrationVersion(3)
    }

    if (currentVersion < 4) {
      console.log('Running migration v4: Ensure default assistant Mita identity')
      await this.migrateDefaultAssistantBranding()
      await this.saveMigrationVersion(4)
    }

    if (currentVersion < 5) {
      console.log('Running migration v5: Migrate legacy default assistants to Mita')
      await this.migrateDefaultAssistantBranding()
      await this.saveMigrationVersion(5)
    }

    console.log(
      `Migrations complete. Current version: ${this.CURRENT_MIGRATION_VERSION}`
    )
  }

  /**
   * Migration v3: Keep the legacy default assistant id for compatibility, but
   * update its visible product branding to Mita.
   */
  private async migrateDefaultAssistantBranding(): Promise<void> {
    if (!(await fs.existsSync('file://assistants'))) {
      return
    }

    const assistants = await this.getAssistants()
    const mitaAssistant = assistants.find(
      (assistant) => assistant.id === DEFAULT_ASSISTANT_ID
    )

    for (const assistant of assistants) {
      const isDefaultAssistant =
        assistant.id === DEFAULT_ASSISTANT_ID ||
        LEGACY_DEFAULT_ASSISTANT_IDS.includes(assistant.id)
      if (!isDefaultAssistant) continue

      const hasLegacyBranding = hasLegacyAssistantBranding(assistant)
      const nextInstructions = hasLegacyBranding
        ? this.defaultAssistant.instructions
        : ensureMitaIdentityGuard(assistant.instructions)
      const nextName = hasLegacyBranding || !assistant.name
        ? this.defaultAssistant.name
        : assistant.name
      const nextDescription = hasLegacyBranding || !assistant.description
        ? this.defaultAssistant.description
        : assistant.description

      const shouldDropLegacyAssistant =
        assistant.id !== DEFAULT_ASSISTANT_ID && Boolean(mitaAssistant)

      if (!hasLegacyBranding && shouldDropLegacyAssistant) {
        await this.removeAssistantFile(assistant.id)
        continue
      }

      if (
        assistant.id === DEFAULT_ASSISTANT_ID &&
        assistant.name === nextName &&
        assistant.description === nextDescription &&
        assistant.instructions === nextInstructions
      ) {
        continue
      }

      const assistantPath = await joinPath([
        'file://assistants',
        DEFAULT_ASSISTANT_ID,
        'assistant.json',
      ])

      try {
        const assistantFolder = await joinPath([
          'file://assistants',
          DEFAULT_ASSISTANT_ID,
        ])
        if (!(await fs.existsSync(assistantFolder))) {
          await fs.mkdir(assistantFolder)
        }

        await fs.writeFileSync(
          assistantPath,
          JSON.stringify(
            {
              ...assistant,
              id: DEFAULT_ASSISTANT_ID,
              name: nextName,
              description: nextDescription,
              instructions: nextInstructions,
            },
            null,
            2
          )
        )
        if (assistant.id !== DEFAULT_ASSISTANT_ID) {
          await this.removeAssistantFile(assistant.id)
        }
        console.log(`Migrated default assistant branding: ${assistant.id}`)
      } catch (error) {
        console.error(`Failed to migrate assistant ${assistant.id}:`, error)
      }
    }
  }

  /**
   * Migration v1: Update assistant instructions from old format to new format
   */
  private async migrateAssistantInstructions(): Promise<void> {
    const OLD_INSTRUCTION = 'You are a helpful AI assistant.'

    if (!(await fs.existsSync('file://assistants'))) {
      return
    }

    const assistants = await this.getAssistants()

    for (const assistant of assistants) {
      // Check if this assistant has the old instruction format
      if (assistant.instructions?.startsWith(OLD_INSTRUCTION)) {
        // Replace old instruction with new one, preserving the rest of the content
        const restOfInstructions = assistant.instructions.substring(
          OLD_INSTRUCTION.length
        )
        assistant.instructions =
          MITA_ASSISTANT_INSTRUCTIONS + restOfInstructions

        // Save the updated assistant
        const assistantPath = await joinPath([
          'file://assistants',
          assistant.id,
          'assistant.json',
        ])

        try {
          await fs.writeFileSync(
            assistantPath,
            JSON.stringify(assistant, null, 2)
          )
          console.log(`Migrated instructions for assistant: ${assistant.id}`)
        } catch (error) {
          console.error(`Failed to migrate assistant ${assistant.id}:`, error)
        }
      }
    }
  }

  /**
   * Migration v2: Update legacy default assistant instructions and set default parameters.
   */
  private async migrateLegacyAssistantInstructionsV2(): Promise<void> {
    const OLD_INSTRUCTION_PREFIX = 'You are Jan, a helpful AI assistant.'

    const DEFAULT_PARAMETERS = {
      temperature: 0.7,
      top_k: 20,
      top_p: 0.8,
      repeat_penalty: 1.12,
    }

    if (!(await fs.existsSync('file://assistants'))) {
      return
    }

    const assistants = await this.getAssistants()

    for (const assistant of assistants) {
      // Check if this assistant has the old instruction format
      if (assistant.instructions?.startsWith(OLD_INSTRUCTION_PREFIX)) {
        assistant.instructions = MITA_ASSISTANT_INSTRUCTIONS

        // Add default parameters to the assistant
        const assistantWithParams = {
          ...assistant,
          parameters: DEFAULT_PARAMETERS,
        }

        // Save the updated assistant
        const assistantPath = await joinPath([
          'file://assistants',
          assistant.id,
          'assistant.json',
        ])

        try {
          await fs.writeFileSync(
            assistantPath,
            JSON.stringify(assistantWithParams, null, 2)
          )
          console.log(`Migrated legacy instructions for assistant: ${assistant.id}`)
        } catch (error) {
          console.error(`Failed to migrate assistant ${assistant.id}:`, error)
        }
      }
    }
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async getAssistants(): Promise<Assistant[]> {
    if (!(await fs.existsSync('file://assistants')))
      return [this.defaultAssistant]
    const assistants = await fs.readdirSync('file://assistants')
    const assistantsData: Assistant[] = []
    for (const assistant of assistants) {
      const assistantPath = await joinPath([
        'file://assistants',
        assistant,
        'assistant.json',
      ])
      if (!(await fs.existsSync(assistantPath))) continue

      try {
        const assistantData = JSON.parse(await fs.readFileSync(assistantPath))
        assistantsData.push(assistantData as Assistant)
      } catch (error) {
        console.error(`Failed to read assistant ${assistant}:`, error)
      }
    }
    // Return loaded assistants, or fall back to default if none found
    return assistantsData.length > 0 ? assistantsData : [this.defaultAssistant]
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    const assistantFolder = await joinPath(['file://assistants', assistant.id])
    if (!(await fs.existsSync(assistantFolder))) {
      await fs.mkdir(assistantFolder)
    }
    await fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2))
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    await this.removeAssistantFile(assistant.id)
  }

  private async removeAssistantFile(assistantId: string): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistantId,
      'assistant.json',
    ])
    if (await fs.existsSync(assistantPath)) {
      await fs.rm(assistantPath)
    }
  }

  private defaultAssistant: Assistant = {
    avatar: '👋',
    thread_location: undefined,
    id: DEFAULT_ASSISTANT_ID,
    object: 'assistant',
    created_at: Date.now() / 1000,
    name: 'Mita',
    description: MITA_ASSISTANT_DESCRIPTION,
    model: '*',
    instructions: MITA_ASSISTANT_INSTRUCTIONS,
    tools: [
      {
        type: 'retrieval',
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end.
----------------
CONTEXT: {CONTEXT}
----------------
QUESTION: {QUESTION}
----------------
Helpful Answer:`,
        },
      },
    ],
    file_ids: [],
    metadata: undefined,
  }
}
