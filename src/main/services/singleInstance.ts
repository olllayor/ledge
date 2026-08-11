import { watch, type FSWatcher } from 'node:fs'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

export const SECOND_INSTANCE_MARKER_FILENAME = '.second-instance-signal'

function markerPath(userDataDir: string): string {
  return join(userDataDir, SECOND_INSTANCE_MARKER_FILENAME)
}

/**
 * Called by the losing instance before it quits. The marker is written
 * via tmp+rename (same atomicity convention as StatePersister) so the
 * primary's watcher never observes a half-written file. Best-effort: if
 * the write fails, the OS-level single-instance lock still prevents a
 * duplicate process — only the resurface signal is lost.
 */
export function writeSecondInstanceMarker(userDataDir: string): void {
  try {
    mkdirSync(userDataDir, { recursive: true })
    const tmp = `${markerPath(userDataDir)}.tmp-${process.pid}`
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, new Date().toISOString())
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, markerPath(userDataDir))
  } catch (error) {
    console.warn('[ledge] second-instance marker write failed:', error)
  }
}

/**
 * Runs at primary startup before the watcher attaches so a marker left
 * behind by a crashed secondary is never misread as a fresh launch.
 * Returns whether a marker was removed.
 */
export function cleanupStaleMarker(userDataDir: string): boolean {
  try {
    if (!existsSync(markerPath(userDataDir))) {
      return false
    }
    rmSync(markerPath(userDataDir), { force: true })
    return true
  } catch (error) {
    console.warn('[ledge] second-instance stale marker cleanup failed:', error)
    return false
  }
}

/**
 * Primary-side half of the protocol. Watches userData for the marker,
 * consumes it (rm) and fires onSignal. `persistent: false` keeps the
 * watcher from holding the event loop open during quit. Returns an
 * unsubscribe fn, or null when the directory cannot be watched —
 * single-instance enforcement still holds via the lock alone.
 */
export function startSingleInstanceWatch(opts: {
  userDataDir: string
  onSignal: () => void
}): (() => void) | null {
  const { userDataDir, onSignal } = opts
  cleanupStaleMarker(userDataDir)

  let watcher: FSWatcher
  try {
    watcher = watch(userDataDir, { persistent: false }, (_event, filename) => {
      if (filename !== SECOND_INSTANCE_MARKER_FILENAME) {
        return
      }
      // Consume first: rename can emit twice during login bursts, and an
      // already-fired signal must not re-trigger on the next watch tick.
      rmSync(markerPath(userDataDir), { force: true })
      onSignal()
    })
  } catch (error) {
    console.warn('[ledge] second-instance watch unavailable:', error)
    return null
  }
  watcher.on('error', (error) => {
    console.warn('[ledge] second-instance watch error:', error)
  })
  return () => watcher.close()
}
