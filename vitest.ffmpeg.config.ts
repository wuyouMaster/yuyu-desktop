import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'ffmpeg-integration', environment: 'node', include: ['tests/ffmpeg/**/*.test.ts'] }
})
