import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NovelAssets } from '@/components/novel/NovelAssets'
import type { Character } from '@/types/novel'

const character = (id: string, name: string): Character => ({
  id,
  name,
  role: 'protagonist',
  gender: '',
  age: '',
  nationality: '',
  ethnicity: '',
  appearance: '',
  body: '',
  personality: '',
  biography: '',
  customFields: {},
  lockedFields: [],
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
})

describe('NovelAssets character avatar generation', () => {
  it('merges an async avatar result into the latest character list by id', async () => {
    const original = character('character-1', '沈砚秋')
    const added = character('character-2', '裴照影')
    const onCharactersChange = vi.fn()
    let resolveAvatar: (value: string) => void = () => undefined
    const onGenerateCharacterAvatar = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAvatar = resolve
        })
    )
    const commonProps = {
      tab: 'characters' as const,
      relationships: [],
      outline: [],
      clues: [],
      units: [],
      onCharactersChange,
      onRelationshipsChange: vi.fn(),
      onOutlineChange: vi.fn(),
      onCluesChange: vi.fn(),
      onGenerateCharacterAvatar,
    }
    const user = userEvent.setup()
    const { rerender } = render(
      <NovelAssets {...commonProps} characters={[original]} />
    )

    await user.click(
      screen.getByRole('button', { name: 'AI 生成人物示意图' })
    )
    rerender(
      <NovelAssets
        {...commonProps}
        characters={[
          { ...original, name: '沈砚秋 · 最新设定' },
          added,
        ]}
      />
    )

    await act(async () => resolveAvatar('/assets/avatar.png'))
    await waitFor(() => expect(onCharactersChange).toHaveBeenCalledTimes(1))

    expect(onCharactersChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: original.id,
        name: '沈砚秋 · 最新设定',
        avatarAsset: '/assets/avatar.png',
      }),
      added,
    ])
  })
})
