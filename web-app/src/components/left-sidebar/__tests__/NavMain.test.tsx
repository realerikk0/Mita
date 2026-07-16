import { describe, expect, it, vi } from 'vitest'

import { getNavMainItems } from '../NavMain'

describe('NavMain', () => {
  it('places New Image directly after New Chat', () => {
    const items = getNavMainItems(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn())
    const titles = items.map((item) => item.title)
    const newImageItem = items.find((item) => item.title === 'common:newMedia')

    expect(titles[titles.indexOf('common:newChat') + 1]).toBe(
      'common:newMedia'
    )
    expect(newImageItem?.shortcut).toBeTruthy()
  })

  it('shows a shortcut for New Biyan Teams', () => {
    const items = getNavMainItems(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn())
    const newBiyanTeamsItem = items.find(
      (item) => item.title === 'common:newBiyanTeams'
    )

    expect(newBiyanTeamsItem?.shortcut).toBeTruthy()
  })
})
