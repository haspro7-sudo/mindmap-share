import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Deterministic local-calendar tests (docs/SPEC.md §8).
process.env.TZ = 'Asia/Tokyo'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 30_000,
    env: { TZ: 'Asia/Tokyo' },
  },
})
