import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

rmSync(resolve(repoRoot, 'dist'), { recursive: true, force: true })
