import { describe, it, expect, vi } from 'vitest'
import {
  defaultModel,
  extractDescription,
  removeYamlFrontMatter,
  extractModelName,
  extractModelRepo,
  getModelCapabilities,
  inferJingxingModelCapabilities,
  isJingxingImageGenerationModel,
  isJingxingNativeWebSearchModel,
  normalizeModelCapabilitiesForProvider,
} from '../models'
import { ModelCapabilities } from '@/types/models'

// Mock the token.js module
vi.mock('token.js', () => ({
  models: {
    openai: {
      models: ['gpt-5', 'gpt-4'],
      supportsToolCalls: ['gpt-5', 'gpt-4'],
      supportsImages: ['gpt-4-vision-preview'],
    },
    anthropic: {
      models: ['claude-sonnet-4-5', 'claude-3-haiku'],
      supportsToolCalls: ['claude-sonnet-4-5'],
      supportsImages: ['claude-sonnet-4-5', 'claude-3-haiku'],
    },
    mistral: {
      models: ['mistral-7b', 'mistral-8x7b'],
      supportsToolCalls: ['mistral-8x7b'],
    },
    // Provider with no capability arrays
    cohere: {
      models: ['command', 'command-light'],
    },
  },
}))

describe('defaultModel', () => {
  it('returns first OpenAI model when no provider is given', () => {
    expect(defaultModel()).toBe('gpt-5')
  })

  it('returns first OpenAI model when unknown provider is given', () => {
    expect(defaultModel('unknown')).toBe('gpt-5')
  })

  it('returns first model for known providers', () => {
    expect(defaultModel('anthropic')).toBe('claude-sonnet-4-5')
    expect(defaultModel('mistral')).toBe('mistral-large-2411')
  })

  it('handles empty string provider', () => {
    expect(defaultModel('')).toBe('gpt-5')
  })
})

describe('extractDescription', () => {
  it('returns undefined for falsy input', () => {
    expect(extractDescription()).toBeUndefined()
    expect(extractDescription('')).toBe('')
  })

  it('extracts overview section from markdown', () => {
    const markdown = `# Model Title
## Overview
This is the model overview section.
It has multiple lines.
## Features
This is another section.`

    expect(extractDescription(markdown)).toBe(
      'This is the model overview section.\nIt has multiple lines.'
    )
  })

  it('falls back to first 500 characters when no overview section', () => {
    const longText = 'A'.repeat(600)
    expect(extractDescription(longText)).toBe('A'.repeat(500))
  })

  it('removes YAML front matter before extraction', () => {
    const markdownWithYaml = `---
title: Model
author: Test
---
# Model Title
## Overview
This is the overview.`

    expect(extractDescription(markdownWithYaml)).toBe('This is the overview.')
  })

  it('removes image markdown syntax', () => {
    const markdownWithImages = `## Overview
This is text with ![alt text](image.png) image.
More text here.`

    expect(extractDescription(markdownWithImages)).toBe(
      'This is text with  image.\nMore text here.'
    )
  })

  it('removes HTML img tags', () => {
    const markdownWithHtmlImages = `## Overview
This is text with <img src="image.png" alt="alt"> image.
More text here.`

    expect(extractDescription(markdownWithHtmlImages)).toBe(
      'This is text with  image.\nMore text here.'
    )
  })

  it('handles text without overview section', () => {
    const simpleText = 'This is a simple description without sections.'
    expect(extractDescription(simpleText)).toBe(
      'This is a simple description without sections.'
    )
  })

  it('extracts overview that ends at file end', () => {
    const markdown = `# Model Title
## Overview
This is the overview at the end.`

    expect(extractDescription(markdown)).toBe(
      'This is the overview at the end.'
    )
  })
})

describe('removeYamlFrontMatter', () => {
  it('removes YAML front matter from content', () => {
    const contentWithYaml = `---
title: Test
author: John
---
# Main Content
This is the main content.`

    const expected = `# Main Content
This is the main content.`

    expect(removeYamlFrontMatter(contentWithYaml)).toBe(expected)
  })

  it('returns content unchanged when no YAML front matter', () => {
    const content = `# Main Content
This is the main content.`

    expect(removeYamlFrontMatter(content)).toBe(content)
  })

  it('handles empty content', () => {
    expect(removeYamlFrontMatter('')).toBe('')
  })

  it('handles content with only YAML front matter', () => {
    const yamlOnly = `---
title: Test
author: John
---
`

    expect(removeYamlFrontMatter(yamlOnly)).toBe('')
  })

  it('does not remove YAML-like content in middle of text', () => {
    const content = `# Title
Some content here.
---
This is not front matter
---
More content.`

    expect(removeYamlFrontMatter(content)).toBe(content)
  })
})

describe('extractModelName', () => {
  it('extracts model name from repo path', () => {
    expect(extractModelName('cortexso/tinyllama')).toBe('tinyllama')
    expect(extractModelName('microsoft/DialoGPT-medium')).toBe(
      'DialoGPT-medium'
    )
    expect(extractModelName('huggingface/CodeBERTa-small-v1')).toBe(
      'CodeBERTa-small-v1'
    )
  })

  it('returns the input when no slash is present', () => {
    expect(extractModelName('tinyllama')).toBe('tinyllama')
    expect(extractModelName('single-model-name')).toBe('single-model-name')
  })

  it('handles undefined input', () => {
    expect(extractModelName()).toBeUndefined()
  })

  it('handles empty string', () => {
    expect(extractModelName('')).toBe('')
  })

  it('handles multiple slashes', () => {
    expect(extractModelName('org/sub/model')).toBe('sub')
  })
})

describe('extractModelRepo', () => {
  it('extracts repo path from HuggingFace URL', () => {
    expect(extractModelRepo('https://huggingface.co/cortexso/tinyllama')).toBe(
      'cortexso/tinyllama'
    )
    expect(
      extractModelRepo('https://huggingface.co/microsoft/DialoGPT-medium')
    ).toBe('microsoft/DialoGPT-medium')
  })

  it('returns input unchanged when not a HuggingFace URL', () => {
    expect(extractModelRepo('cortexso/tinyllama')).toBe('cortexso/tinyllama')
    expect(extractModelRepo('https://github.com/user/repo')).toBe(
      'https://github.com/user/repo'
    )
  })

  it('handles undefined input', () => {
    expect(extractModelRepo()).toBeUndefined()
  })

  it('handles empty string', () => {
    expect(extractModelRepo('')).toBe('')
  })

  it('handles URLs with trailing slashes', () => {
    expect(extractModelRepo('https://huggingface.co/cortexso/tinyllama/')).toBe(
      'cortexso/tinyllama/'
    )
  })
})

describe('getModelCapabilities', () => {
  it('returns completion capability for all models', () => {
    const capabilities = getModelCapabilities('openai', 'gpt-5')
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
  })

  it('includes tools capability when model supports it', () => {
    const capabilities = getModelCapabilities('openai', 'gpt-5')
    expect(capabilities).toContain(ModelCapabilities.TOOLS)
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
  })

  it('excludes tools capability when model does not support it', () => {
    const capabilities = getModelCapabilities('mistral', 'mistral-nemo-2407')
    expect(capabilities).not.toContain(ModelCapabilities.TOOLS)
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
  })

  it('includes vision capability when model supports it', () => {
    const capabilities = getModelCapabilities('openai', 'gpt-4o')
    expect(capabilities).toContain(ModelCapabilities.VISION)
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
  })

  it('excludes vision capability when model does not support it', () => {
    const capabilities = getModelCapabilities('openai', 'gpt-4')
    expect(capabilities).not.toContain(ModelCapabilities.VISION)
  })

  it('includes both tools and vision when model supports both', () => {
    const capabilities = getModelCapabilities('anthropic', 'claude-sonnet-4-5')
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
    expect(capabilities).toContain(ModelCapabilities.TOOLS)
    expect(capabilities).toContain(ModelCapabilities.VISION)
  })

  it('handles provider with no capability arrays gracefully', () => {
    const capabilities = getModelCapabilities('ai21', 'jamba-instruct')
    expect(capabilities).toEqual([ModelCapabilities.COMPLETION])
    expect(capabilities).not.toContain(ModelCapabilities.TOOLS)
    expect(capabilities).not.toContain(ModelCapabilities.VISION)
  })

  it('handles unknown provider gracefully', () => {
    const capabilities = getModelCapabilities('openrouter', 'some-model')
    expect(capabilities).toEqual([ModelCapabilities.COMPLETION])
    expect(capabilities).not.toContain(ModelCapabilities.TOOLS)
    expect(capabilities).not.toContain(ModelCapabilities.VISION)
  })

  it('handles model not in capability list', () => {
    const capabilities = getModelCapabilities('xai', 'grok-2-vision-1212')
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
    expect(capabilities).toContain(ModelCapabilities.VISION)
    expect(capabilities).not.toContain(ModelCapabilities.TOOLS)
  })

  it('returns only completion for provider with partial capability data', () => {
    // Mistral has supportsToolCalls but no supportsImages
    const capabilities = getModelCapabilities('mistral', 'mistral-nemo-2407')
    expect(capabilities).toEqual([ModelCapabilities.COMPLETION])
  })

  it('handles model that supports tools but not vision', () => {
    const capabilities = getModelCapabilities('mistral', 'mistral-large-2411')
    expect(capabilities).toContain(ModelCapabilities.COMPLETION)
    expect(capabilities).toContain(ModelCapabilities.TOOLS)
    expect(capabilities).not.toContain(ModelCapabilities.VISION)
  })

  it('infers Jingxing chat model capabilities from the current visible model families', () => {
    const expectations: Record<string, string[]> = {
      'claude-haiku-4-5-20251001': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
      ],
      'claude-opus-4-6': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
      ],
      'claude-opus-4-7': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
      ],
      'claude-sonnet-4-6': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
      ],
      'gemini-3-flash-preview': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gemini-3.1-pro-preview': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gemini-3.5-flash': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-4o-mini': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.3-chat': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.3-codex': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        'reasoning',
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.4': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.4-mini': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.4-nano': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.4-pro': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'gpt-5.5': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.VISION,
        ModelCapabilities.WEB_SEARCH,
      ],
      'grok-4-1-fast-non-reasoning': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.WEB_SEARCH,
      ],
      'grok-4-1-fast-reasoning': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        'reasoning',
        ModelCapabilities.WEB_SEARCH,
      ],
      'grok-4.20-0309-non-reasoning': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.WEB_SEARCH,
      ],
      'grok-4.20-0309-reasoning': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        'reasoning',
        ModelCapabilities.WEB_SEARCH,
      ],
      'grok-4.20-multi-agent-0309': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        'reasoning',
        ModelCapabilities.WEB_SEARCH,
      ],
      'grok-4.3': [
        ModelCapabilities.COMPLETION,
        ModelCapabilities.TOOLS,
        ModelCapabilities.WEB_SEARCH,
      ],
    }

    for (const [modelId, expectedCapabilities] of Object.entries(expectations)) {
      expect(inferJingxingModelCapabilities(modelId)).toEqual(
        expectedCapabilities
      )
      expect(getModelCapabilities('jingxing', modelId)).toEqual(
        expectedCapabilities
      )
    }
  })

  it('marks probed Jingxing GPT, Grok, and Gemini chat models as native web search capable', () => {
    expect(isJingxingNativeWebSearchModel('gpt-5.4')).toBe(true)
    expect(isJingxingNativeWebSearchModel('grok-4.3')).toBe(true)
    expect(isJingxingNativeWebSearchModel('gemini-3.5-flash')).toBe(true)
    expect(isJingxingNativeWebSearchModel('gemini-3.1-pro-preview')).toBe(true)
    expect(isJingxingNativeWebSearchModel('gemini-3-flash-preview')).toBe(true)
    expect(isJingxingNativeWebSearchModel('claude-opus-4-7')).toBe(false)
    expect(isJingxingNativeWebSearchModel('gpt-image-2')).toBe(false)
  })

  it('marks Jingxing image generation models as non-chat image models', () => {
    for (const modelId of [
      'gemini-2.5-flash-image',
      'gemini-3-pro-image-preview',
      'gemini-3.1-flash-image-preview',
      'gpt-image-1.5',
      'gpt-image-2',
    ]) {
      expect(isJingxingImageGenerationModel(modelId)).toBe(true)
      expect(inferJingxingModelCapabilities(modelId)).toEqual([
        ModelCapabilities.IMAGE_GENERATION,
        ModelCapabilities.TEXT_TO_IMAGE,
        ModelCapabilities.IMAGE_TO_IMAGE,
      ])
    }
  })

  it('normalizes stale Jingxing capabilities while preserving user configured values', () => {
    expect(
      normalizeModelCapabilitiesForProvider('jingxing', {
        id: 'gpt-image-2',
        capabilities: [ModelCapabilities.COMPLETION],
      })
    ).toEqual([
      ModelCapabilities.IMAGE_GENERATION,
      ModelCapabilities.TEXT_TO_IMAGE,
      ModelCapabilities.IMAGE_TO_IMAGE,
    ])

    expect(
      normalizeModelCapabilitiesForProvider('jingxing', {
        id: 'gpt-image-2',
        capabilities: [ModelCapabilities.COMPLETION],
        _userConfiguredCapabilities: true,
      })
    ).toEqual([ModelCapabilities.COMPLETION])
  })
})
