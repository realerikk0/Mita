const status = document.querySelector('#status')
const invoke = window.__TAURI_INTERNALS__?.invoke
const query = new URLSearchParams(window.location.search)
const isBootstrap = query.get('boot') === '1'
const startupErrorCode = query.get('error')
let bootstrapWatchdog

function clearBootstrapWatchdog() {
  if (bootstrapWatchdog === undefined) return
  window.clearTimeout(bootstrapWatchdog)
  bootstrapWatchdog = undefined
}

async function run(command, args) {
  if (!invoke) throw new Error('Biyan desktop bridge is unavailable')
  status.textContent = ''
  try {
    return await invoke(command, args)
  } catch {
    status.textContent = '操作失败，请查看日志或联系 help@biyan.ai。'
    return undefined
  }
}

async function loadSources() {
  const sources = await run('list_retained_legacy_migration_sources')
  if (!Array.isArray(sources) || sources.length === 0) return
  const section = document.querySelector('#source-section')
  const list = document.querySelector('#sources')
  if (!section || !list) return
  list.replaceChildren()
  for (const source of sources) {
    if (typeof source !== 'string') continue
    const item = document.createElement('li')
    item.textContent = source
    list.append(item)
  }
  section.hidden = false
}

window.__BIYAN_SHOW_MIGRATION_ERROR__ = (errorCode) => {
  clearBootstrapWatchdog()
  document.querySelector('#title').textContent = '数据迁移尚未完成'
  document.querySelector('#description').textContent =
    '为了保护旧数据，Biyan 已停止正常启动。旧目录没有被删除或覆盖；请先重试，或查看日志和旧数据目录。'
  document.querySelector('#actions').hidden = false
  status.textContent = errorCode ? `错误代码：${errorCode}` : ''
  void loadSources()
}

document.querySelector('#retry')?.addEventListener('click', () => run('relaunch'))
document.querySelector('#legacy')?.addEventListener('click', () =>
  run('open_legacy_migration_source')
)
document.querySelector('#logs')?.addEventListener('click', async () => {
  const path = await run('get_user_logs_directory')
  if (typeof path === 'string' && path.length > 0) {
    await run('open_file_explorer', { path })
  }
})

window.addEventListener('pagehide', clearBootstrapWatchdog, { once: true })

if (startupErrorCode) {
  clearBootstrapWatchdog()
  window.__BIYAN_SHOW_MIGRATION_ERROR__(startupErrorCode)
} else if (isBootstrap) {
  bootstrapWatchdog = window.setTimeout(() => {
    window.__BIYAN_SHOW_MIGRATION_ERROR__('migration_startup_timeout')
  }, 45_000)
} else {
  clearBootstrapWatchdog()
  window.__BIYAN_SHOW_MIGRATION_ERROR__(startupErrorCode)
}
