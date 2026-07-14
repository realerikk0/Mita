const LINKS = [
  { name: 'Documentation', href: '/docs/desktop' },
  { name: 'Biyan website', href: 'https://biyan.ai/' },
  { name: 'Source', href: 'https://github.com/realerikk0/Mita' },
  { name: 'Support', href: 'mailto:help@biyan.ai' },
]

export default function FooterMenu() {
  return (
    <footer className="flex w-full flex-col gap-4 py-6 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
      <p>Biyan (彼岩) documentation</p>
      <nav className="flex flex-wrap gap-5" aria-label="Footer navigation">
        {LINKS.map((link) => (
          <a key={link.name} href={link.href} className="hover:text-black">
            {link.name}
          </a>
        ))}
      </nav>
    </footer>
  )
}
