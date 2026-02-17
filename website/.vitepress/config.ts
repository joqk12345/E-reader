import { defineConfig } from 'vitepress'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS === 'true' && repoName ? `/${repoName}/` : '/'

export default defineConfig({
  base,
  title: 'Reader',
  description: 'Local-first EPUB/PDF/Markdown reader with AI-powered tools',
  lang: 'en-US',
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/reader-logo.svg' }],
    ['meta', { name: 'theme-color', content: '#2f6f53' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Install', link: '/guide/install' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Overview', link: '/guide/' },
            { text: 'Installation', link: '/guide/install' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/joqk12345/reader' },
    ],

    footer: {
      message: 'Local-first reading with optional local AI',
      copyright: 'Copyright © 2026 Reader',
    },
  },
})
