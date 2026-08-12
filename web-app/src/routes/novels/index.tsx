import { createFileRoute } from '@tanstack/react-router'

import { NovelLibrary } from '@/components/novel/NovelLibrary'

export const Route = createFileRoute('/novels/')({
  component: NovelLibrary,
})
