import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    name: 'runtime-protocol',
    environment: 'node',
    include: ['tests/runtime-protocol/**/*.test.ts']
  }
})
