import { createFileRoute } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card } from '@/containers/Card'
import { MAX_DOCUMENT_FILE_SIZE_MB } from '@/hooks/useAttachments'

export const Route = createFileRoute('/settings/attachments')({
  component: AttachmentsSettings,
})

function AttachmentsSettings() {
  return (
    <main className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">Document attachments</h1>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto p-6">
          <Card title="Remote-only document handling">
            <div className="flex gap-3 p-4 text-sm text-muted-foreground">
              <FileText className="size-5 shrink-0" />
              <p>
                Files up to {MAX_DOCUMENT_FILE_SIZE_MB} MB are sent directly
                when the selected provider supports native file input.
                Otherwise, Biyan parses the complete document locally and adds
                the full text to the request. Files are never indexed,
                truncated, or automatically summarized.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </main>
  )
}
