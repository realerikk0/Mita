import React, { Fragment } from 'react'
import { useConfig, DocsThemeConfig } from 'nextra-theme-docs'
import { useRouter } from 'next/router'
import Navbar from '@/components/Navbar'
import FooterMenu from '@/components/FooterMenu'
import JSONLD from '@/components/JSONLD'

const defaultUrl = 'https://docs.biyan.ai'

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Biyan',
  alternateName: '彼岩',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'macOS, Windows, Linux',
  url: defaultUrl,
}

const config: DocsThemeConfig = {
  logo: <span className="text-lg font-semibold">Biyan Docs</span>,
  docsRepositoryBase:
    'https://github.com/realerikk0/Mita/tree/mita-main/docs',
  feedback: {
    content: 'Need help? Email help@biyan.ai →',
    useLink: () => 'mailto:help@biyan.ai',
  },
  editLink: {
    text: 'Edit this page on GitHub →',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s - Biyan Docs',
      openGraph: { type: 'website' },
    }
  },
  navbar: { component: <Navbar /> },
  sidebar: {
    defaultMenuCollapseLevel: 1,
    autoCollapse: true,
  },
  darkMode: false,
  toc: { backToTop: true },
  head: function useHead() {
    const { title, frontMatter } = useConfig()
    const { asPath } = useRouter()
    const pageTitle = frontMatter?.title || title || 'Biyan Documentation'
    const description =
      frontMatter?.description ||
      'Documentation for Biyan, a desktop AI client for cloud and OpenAI-compatible model providers.'
    const canonical = `${defaultUrl}${asPath === '/' ? '' : asPath.split('#')[0].split('?')[0]}`

    return (
      <Fragment>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Language" content="en" />
        <title>{pageTitle}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <link rel="canonical" href={canonical} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta
          name="keywords"
          content={
            frontMatter?.keywords?.join(', ') ||
            'Biyan, 彼岩, cloud AI, model providers, MCP, desktop AI'
          }
        />
        <JSONLD data={structuredData} />
      </Fragment>
    )
  },
  footer: { text: <FooterMenu /> },
  nextThemes: {
    defaultTheme: 'light',
    forcedTheme: 'light',
  },
}

export default config
