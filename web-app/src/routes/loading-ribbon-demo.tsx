import { createFileRoute } from '@tanstack/react-router'
import {
  LoadingRibbonText,
  loadingRibbonStatuses,
  type LoadingRibbonVariant,
} from '@/components/ai-elements/loading-ribbon'
import { SearchIcon, SparklesIcon, WrenchIcon } from 'lucide-react'

export const Route = createFileRoute('/loading-ribbon-demo')({
  component: LoadingRibbonDemo,
})

const variantSamples: Array<{
  label: string
  variant: LoadingRibbonVariant
  icon: 'thinking' | 'search' | 'tool'
  helper: string
}> = [
  {
    label: '思考中',
    variant: 'ribbon',
    icon: 'thinking',
    helper: '默认思考状态，适合长时间持续显示',
  },
  {
    label: '网络搜索中',
    variant: 'glint',
    icon: 'search',
    helper: '轻微扫光，适合工具调用或联网检索',
  },
  {
    label: '分析代码中',
    variant: 'wave',
    icon: 'tool',
    helper: '慢速波纹，适合文件、代码和上下文分析',
  },
]

function LoadingRibbonDemo() {
  return (
    <main
      className="fixed inset-0 z-[60] min-h-screen overflow-y-auto bg-[#020204] text-zinc-100"
      data-loading-ribbon-demo=""
    >
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
            Tauri Loading States
          </p>
          <h1 className="text-3xl font-semibold tracking-normal text-zinc-50 md:text-5xl">
            Silver flowing ribbon text
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-400">
            纯 CSS 金属渐变文字加载状态，面向 macOS 与 Windows 桌面 WebView 的低资源占用预览。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {variantSamples.map((sample) => (
            <div
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.35)]"
              key={sample.variant}
            >
              <div className="mb-8 flex items-center justify-between text-zinc-500">
                <span className="text-xs uppercase tracking-[0.18em]">
                  {sample.variant}
                </span>
                {sample.icon === 'search' ? (
                  <SearchIcon className="size-4" />
                ) : sample.icon === 'tool' ? (
                  <WrenchIcon className="size-4" />
                ) : (
                  <SparklesIcon className="size-4" />
                )}
              </div>

              <LoadingRibbonText
                icon={sample.icon}
                label={sample.label}
                size="md"
                variant={sample.variant}
              />
              <p className="mt-5 text-xs leading-5 text-zinc-500">
                {sample.helper}
              </p>
            </div>
          ))}
        </div>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-white/10 bg-[#070709] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-300">
                Chat integration preview
              </h2>
              <LoadingRibbonText
                icon="thinking"
                label="正在生成回复"
                live={false}
                showIcon={false}
                variant="glint"
              />
            </div>

            <div className="space-y-4">
              <div className="ml-auto max-w-[78%] rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-200">
                帮我分析这个仓库的加载状态，并尽量保持低资源占用。
              </div>
              <div className="max-w-[84%] rounded-lg border border-white/10 bg-black px-4 py-3">
                <LoadingRibbonText
                  icon="search"
                  label="网络搜索中"
                  variant="glint"
                />
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  正在收集主流 AI 应用的状态反馈模式，随后会提炼为可复用组件。
                </p>
              </div>
              <div className="max-w-[84%] rounded-lg border border-white/10 bg-black px-4 py-3">
                <LoadingRibbonText
                  icon="tool"
                  label="正在调用工具..."
                  variant="wave"
                />
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  工具调用状态采用更慢的波纹节奏，避免长时间显示时分散注意力。
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <h2 className="mb-5 text-sm font-medium text-zinc-300">
              Supported labels
            </h2>
            <div className="space-y-4">
              {loadingRibbonStatuses.map((status, index) => (
                <LoadingRibbonText
                  icon={
                    index === 1 ? 'search' : index === 4 ? 'tool' : 'thinking'
                  }
                  key={status}
                  label={status}
                  live={false}
                  variant={
                    index === 1 ? 'glint' : index === 3 ? 'wave' : 'ribbon'
                  }
                />
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
