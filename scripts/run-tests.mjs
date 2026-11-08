import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const files = []
const walk = (dir) => {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.test.ts')) files.push(p)
  }
}
walk('test')

if (files.length === 0) {
  console.log('no test files under test/')
  process.exit(0)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
