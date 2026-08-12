import { createFileRoute } from '@tanstack/react-router'

import { NovelWorkspace } from '@/components/novel/NovelWorkspace'

export const Route = createFileRoute('/novels/$novelId/$unitId')({
  component: NovelWorkspaceRoute,
})

function NovelWorkspaceRoute() {
  const { novelId, unitId } = Route.useParams()
  return <NovelWorkspace novelId={novelId} unitId={unitId} />
}
