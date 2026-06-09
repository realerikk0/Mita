import { useAppUpdater } from '@/hooks/useAppUpdater'

import { IconDownload } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

import { useState, useEffect, type CSSProperties } from 'react'
import { useReleaseNotes } from '@/hooks/useReleaseNotes'
import { RenderMarkdown } from '../RenderMarkdown'
import { cn, isDev } from '@/lib/utils'
import { isNightly, isBeta } from '@/lib/version'
import { useTranslation } from '@/i18n/react-i18next-compat'

const DialogAppUpdater = () => {
  const { t } = useTranslation()
  const { updateState, downloadUpdate, installDownloadedUpdate, setRemindMeLater } =
    useAppUpdater()
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const { release, fetchLatestRelease } = useReleaseNotes()
  const [appUpdateState, setAppUpdateState] = useState({
    remindMeLater: false,
    isUpdateAvailable: false,
    isUpdateReadyToInstall: false,
  })
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round(updateState.downloadProgress * 100))
  )
  const hasKnownDownloadSize = updateState.totalBytes > 0
  const releaseNotesContent = updateState.updateInfo?.body || release?.body
  const showNightlyFallback = isNightly && !isBeta && !releaseNotesContent
  const updateProgressRingStyle = updateState.isDownloading
    ? ({
        '--app-update-progress': hasKnownDownloadSize
          ? `${progressPercent}%`
          : '0%',
        background: hasKnownDownloadSize
          ? 'conic-gradient(#2563eb var(--app-update-progress), rgba(37, 99, 235, 0.18) 0)'
          : 'linear-gradient(90deg, rgba(37, 99, 235, 0.2), rgba(37, 99, 235, 0.95), rgba(37, 99, 235, 0.2))',
      } as CSSProperties)
    : undefined
  const updateButtonLabel = updateState.isInstalling
    ? t('updater:installing')
    : updateState.isDownloading
      ? hasKnownDownloadSize
        ? `${t('updater:downloading')} ${progressPercent}%`
        : t('updater:downloading')
      : appUpdateState.isUpdateReadyToInstall
        ? t('updater:restartToUpdate')
        : t('updater:downloadUpdate')

  const handleUpdate = () => {
    if (updateState.isUpdateReadyToInstall) {
      installDownloadedUpdate()
      return
    }

    downloadUpdate()
  }

  useEffect(() => {
    if (!isDev()) {
      fetchLatestRelease(isBeta)
    }
  }, [fetchLatestRelease])

  useEffect(() => {
    setAppUpdateState({
      remindMeLater: updateState.remindMeLater,
      isUpdateAvailable: updateState.isUpdateAvailable,
      isUpdateReadyToInstall: updateState.isUpdateReadyToInstall,
    })
  }, [updateState])

  if (appUpdateState.remindMeLater && !appUpdateState.isUpdateReadyToInstall) {
    return null
  }

  return (
    <>
      {appUpdateState.isUpdateAvailable && (
        <div
          className={cn(
            'fixed z-50 bottom-3 right-3 bg-background flex items-center justify-center border rounded-lg shadow-md'
          )}
        >
          <div className="px-2 py-4">
            <div className="px-4">
              <div className="flex items-start gap-2">
                <IconDownload
                  size={20}
                  className="shrink-0 text-muted-foreground mt-1"
                />
                <div>
                  <div className="text-base font-medium">
                    {t('updater:newVersion', {
                      version: updateState.updateInfo?.version,
                    })}
                  </div>
                  <div className="mt-1 text-muted-foreground font-normal mb-2">
                    {appUpdateState.isUpdateReadyToInstall
                      ? t('updater:updateReadyToRestart')
                      : t('updater:updateAvailable')}
                  </div>
                </div>
              </div>
            </div>

            {showReleaseNotes && (
              <div className="max-h-[500px] p-4 w-[400px] overflow-y-scroll  text-sm font-normal leading-relaxed">
                {showNightlyFallback ? (
                  <p className="text-sm font-normal">
                    {t('updater:nightlyBuild')}
                  </p>
                ) : (
                  <RenderMarkdown
                    components={{
                      a: ({ ...props }) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                      h2: ({ ...props }) => (
                        <h2 {...props} className="text-xl! mt-0!" />
                      ),
                    }}
                    content={releaseNotesContent}
                  />
                )}
              </div>
            )}

            <div className="pt-3 px-4">
              <div className="flex gap-x-0 w-full items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReleaseNotes(!showReleaseNotes)}
                >
                  {showReleaseNotes
                    ? t('updater:hideReleaseNotes')
                    : t('updater:showReleaseNotes')}
                </Button>
                <div className="flex gap-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemindMeLater(true)}
                  >
                    {t('updater:remindMeLater')}
                  </Button>
                  <span
                    data-testid={
                      updateState.isDownloading
                        ? 'app-update-progress-ring'
                        : undefined
                    }
                    className={cn(
                      'inline-flex rounded-full',
                      updateState.isDownloading && 'p-[2px]'
                    )}
                    style={updateProgressRingStyle}
                  >
                    <Button
                      onClick={handleUpdate}
                      disabled={
                        updateState.isDownloading || updateState.isInstalling
                      }
                      aria-busy={
                        updateState.isDownloading || updateState.isInstalling
                      }
                      className={cn(updateState.isDownloading && 'relative z-10')}
                      size="sm"
                    >
                      {updateButtonLabel}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default DialogAppUpdater
