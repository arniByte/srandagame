import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Playwright-спеки (tests/e2e) гоняет `npm run e2e`, vitest их не трогает.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
}))
