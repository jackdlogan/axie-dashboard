// Tiny .env reader (no dependency). Prefers a real environment variable, then
// falls back to the project's .env / .env.local.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function env(key, fallback) {
  if (process.env[key] != null && process.env[key] !== '') return process.env[key]
  for (const f of ['.env', '.env.local']) {
    const p = resolve(ROOT, f)
    if (existsSync(p)) {
      const line = readFileSync(p, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(key + '='))
      if (line) return line.slice(key.length + 1).trim()
    }
  }
  return fallback
}
