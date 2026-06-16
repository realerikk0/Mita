import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Runs ONLY the live-provider integration tests (which the default
// vitest.config.ts excludes). Self-contained so `yarn test:integration` needs
// no env var — and therefore no cross-env, which is not a web-app dependency.
// Tests self-skip when credentials are absent.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
    include: ['src/lib/__tests__/integration/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    IS_TAURI: JSON.stringify(false),
    IS_WEB_APP: JSON.stringify(false),
    IS_MACOS: JSON.stringify(false),
    IS_WINDOWS: JSON.stringify(false),
    IS_LINUX: JSON.stringify(false),
    IS_IOS: JSON.stringify(false),
    IS_ANDROID: JSON.stringify(false),
    PLATFORM: JSON.stringify('web'),
    VERSION: JSON.stringify('test'),
    POSTHOG_KEY: JSON.stringify(''),
    POSTHOG_HOST: JSON.stringify(''),
    AUTO_UPDATER_DISABLED: JSON.stringify('false'),
  },
})
