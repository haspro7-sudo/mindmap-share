import { describe, expect, it } from 'vitest'

// src/core must stay pure: no React, DOM, storage, app or network access (docs/SPEC.md §7.2).
const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const FORBIDDEN_IMPORTS = [/from\s+['"]react/, /from\s+['"]react-dom/, /from\s+['"]\.\.\/(\.\.\/)?(storage|app|ui)\//, /from\s+['"]idb['"]/]
const FORBIDDEN_GLOBALS = [/\bfetch\s*\(/, /\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /\bindexedDB\b/, /\bXMLHttpRequest\b/, /\bnavigator\./]

describe('src/core boundary', () => {
  const files = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'))

  it('has source files', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map(([p]) => p))('%s has no forbidden imports or globals', (path) => {
    const src = sources[path]!
    for (const re of [...FORBIDDEN_IMPORTS, ...FORBIDDEN_GLOBALS]) {
      expect(re.test(src), `${path} matches ${re}`).toBe(false)
    }
  })
})
