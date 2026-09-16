import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SECOND_INSTANCE_MARKER_FILENAME,
  cleanupStaleMarker,
  startSingleInstanceWatch,
  writeSecondInstanceMarker,
} from './singleInstance'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

describe('singleInstance', () => {
  it('writes the marker via tmp+rename without leaving the tmp sibling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledge-single-instance-'))
    tempDirs.push(dir)

    writeSecondInstanceMarker(dir)

    await access(join(dir, SECOND_INSTANCE_MARKER_FILENAME))
    await expect(
      access(join(dir, `${SECOND_INSTANCE_MARKER_FILENAME}.tmp`)),
    ).rejects.toThrow()
  })

  it('removes a stale marker without throwing when absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledge-single-instance-'))
    tempDirs.push(dir)

    expect(cleanupStaleMarker(dir)).toBe(false)
    await writeFile(join(dir, SECOND_INSTANCE_MARKER_FILENAME), 'stale')
    expect(cleanupStaleMarker(dir)).toBe(true)
    await expect(
      access(join(dir, SECOND_INSTANCE_MARKER_FILENAME)),
    ).rejects.toThrow()
  })

  it('invokes onSignal when the marker appears and stops after unsubscribe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledge-single-instance-'))
    tempDirs.push(dir)
    const onSignal = vi.fn()

    const unsubscribe = startSingleInstanceWatch({ userDataDir: dir, onSignal })
    expect(unsubscribe).toBeTypeOf('function')

    // fs.watch delivery latency varies under parallel-suite load; give
    // the watcher a moment to attach before the marker lands.
    await delay(50)
    writeSecondInstanceMarker(dir)

    await vi.waitFor(
      () => {
        expect(onSignal).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000, interval: 20 },
    )

    await delay(50)
    await expect(
      access(join(dir, SECOND_INSTANCE_MARKER_FILENAME)),
    ).rejects.toThrow()

    unsubscribe!()
  })

  it('returns null rather than throwing when the directory cannot be watched', () => {
    const unsubscribe = startSingleInstanceWatch({
      userDataDir: join(tmpdir(), 'ledge-does-not-exist-anywhere'),
      onSignal: () => {},
    })
    expect(unsubscribe).toBeNull()
  })
})
