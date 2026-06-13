import type { ShelfRecord } from '@shared/schema';
import { isFileBackedItem } from '@shared/fileUtils';

/**
 * Strip every file-path field from a remote-sourced shelf before it lands
 * in the local state store. The cloud copy must not be allowed to
 * designate any local file path: the main process asset protocol
 * (`ledge-asset://`) trusts items' file paths, and a maliciously-crafted
 * shelf could otherwise pivot the renderer into reading arbitrary local
 * files (e.g. /etc/passwd, ~/.ssh/id_rsa, ...).
 *
 * After sanitization, file-backed items carry empty paths and `isMissing`
 * so the renderer skips preview generation and the user is guided to
 * `Relink…` the local copy via the security-scoped bookmark.
 */
export function sanitizeRemoteFileRefs(shelf: ShelfRecord): ShelfRecord {
  return {
    ...shelf,
    items: shelf.items.map((item) => {
      if (!isFileBackedItem(item)) {
        return item;
      }

      return {
        ...item,
        file: {
          ...item.file,
          // Strip every path field on a remote-sourced item. The cloud copy
          // must not be allowed to designate any local file path — the
          // asset protocol below trusts items' file paths, so a
          // maliciously-crafted shelf could otherwise pivot the renderer
          // into reading arbitrary local files (e.g. /etc/passwd).
          originalPath: '',
          resolvedPath: '',
          bookmarkBase64: '',
          isMissing: true,
          isStale: true,
        },
      };
    }),
  };
}
