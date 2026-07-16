/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://docs.biyan.ai/',
  outDir: 'out',
  generateRobotsTxt: true,
  robotsTxtOptions: {
    policies: [{ userAgent: '*', allow: '/' }],
  },
  changefreq: 'daily',
  priority: 1.0,
}
