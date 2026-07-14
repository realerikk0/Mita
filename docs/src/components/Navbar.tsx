import { useState } from 'react'
import { useRouter } from 'next/router'
import { Button } from './ui/button'

const MENU_ITEMS = [
  { name: 'Docs', href: '/docs/desktop' },
  { name: 'Providers', href: '/docs/desktop/remote-models/openai' },
  { name: 'Migration', href: '/docs/desktop/data-folder' },
  { name: 'Support', href: 'mailto:help@biyan.ai' },
]

export default function Navbar() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 h-[60px] border-b border-gray-200 bg-white text-black">
      <div className="nextra-wrap-container mx-auto flex h-full items-center justify-between px-4 lg:px-6">
        <a href="/" className="text-xl font-bold" aria-label="Biyan documentation home">
          Biyan <span className="font-normal text-gray-500">Docs</span>
        </a>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary navigation">
          {MENU_ITEMS.map((item) => (
            <a
              key={item.name}
              href={item.href}
              className={
                router.asPath.startsWith(item.href)
                  ? 'font-semibold text-blue-600'
                  : 'hover:text-blue-600'
              }
            >
              {item.name}
            </a>
          ))}
          <Button asChild className="bg-black text-white hover:bg-gray-800">
            <a href="https://biyan.ai/" target="_blank" rel="noopener noreferrer">
              Get Biyan
            </a>
          </Button>
        </nav>

        <button
          className="rounded-md border px-3 py-2 lg:hidden"
          type="button"
          aria-expanded={isOpen}
          aria-label="Toggle navigation"
          onClick={() => setIsOpen((value) => !value)}
        >
          Menu
        </button>
      </div>

      {isOpen && (
        <nav className="border-b border-gray-200 bg-white p-4 lg:hidden" aria-label="Mobile navigation">
          <div className="flex flex-col gap-4">
            {MENU_ITEMS.map((item) => (
              <a key={item.name} href={item.href} onClick={() => setIsOpen(false)}>
                {item.name}
              </a>
            ))}
            <a href="https://biyan.ai/" target="_blank" rel="noopener noreferrer">
              Get Biyan
            </a>
          </div>
        </nav>
      )}
    </header>
  )
}
