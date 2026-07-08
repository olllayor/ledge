import type { IngestPayload, ShelfItemRecord } from '@shared/schema';

/**
 * Pure helpers for translating a `DataTransfer` (from drag-and-drop or
 * clipboard paste) into the `IngestPayload[]` shape the main process
 * expects. Extracted from `ShelfView.tsx` so the input-parsing logic
 * can be unit-tested without rendering React and so the main view
 * file focuses on UI/state.
 */

/** True when the transfer looks like something the user dragged in from
 *  outside the app (Files / uri-list / text) and is worth processing. */
export function isExternalTransfer(transfer: DataTransfer | null): boolean {
  if (!transfer) {
    return false;
  }

  const types = Array.from(transfer.types);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
}

/** Build the list of ingest payloads from a `DataTransfer`. The
 *  priority order is file paths → images → uri-list URL → text URL or
 *  plain text, mirroring the main-process pasteboard reader so a drop
 *  behaves the same as a paste. */
export async function payloadsFromTransfer(transfer: DataTransfer): Promise<IngestPayload[]> {
  const payloads: IngestPayload[] = [];
  const droppedFiles = Array.from(transfer.files);
  const droppedItemFiles = Array.from(transfer.items as DataTransferItemList)
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const filePaths = [
    ...droppedFiles.map((file) => window.ledge.getFilePath(file)).filter((path): path is string => Boolean(path)),
    ...droppedItemFiles.map((file) => window.ledge.getFilePath(file)).filter((path): path is string => Boolean(path)),
    ...filePathsFromUriList(transfer.getData('text/uri-list')),
  ];

  if (filePaths.length > 0) {
    payloads.push({
      kind: 'fileDrop',
      paths: [...new Set(filePaths)],
    });
  }

  const imageItems = Array.from(transfer.items as DataTransferItemList).filter((item) =>
    item.type.startsWith('image/'),
  );
  for (const item of imageItems) {
    try {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }

      const maybePath = window.ledge.getFilePath(file);
      if (maybePath) {
        continue;
      }

      payloads.push(await imageToPayload(file));
    } catch {
      // Skip malformed image transfer items and continue ingesting the
      // rest of the payload.
    }
  }

  if (payloads.length === 0) {
    const uriListPayload = urlPayloadFromUriList(transfer.getData('text/uri-list'));
    if (uriListPayload) {
      payloads.push({
        kind: 'url',
        ...uriListPayload,
      });
    }
  }

  const text = transfer.getData('text/plain').trim();
  if (text && payloads.length === 0) {
    try {
      const parsed = new URL(text);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        payloads.push({
          kind: 'url',
          url: parsed.toString(),
          label: parsed.hostname,
        });
      } else {
        payloads.push({
          kind: 'text',
          text,
        });
      }
    } catch {
      payloads.push({
        kind: 'text',
        text,
      });
    }
  }

  return payloads;
}

/** Parse a `text/uri-list` body into filesystem paths. Each line is
 *  decoded as a URL; only `file:` entries survive, and the path
 *  component is URL-decoded. */
export function filePathsFromUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('#'))
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        if (url.protocol !== 'file:') {
          return [];
        }

        return [decodeURIComponent(url.pathname)];
      } catch {
        return [];
      }
    });
}

/** If the uri-list starts with a single http(s) URL, return it as a
 *  payload-shaped object. Otherwise return null. */
export function urlPayloadFromUriList(uriList: string): { url: string; label: string } | null {
  const firstEntry = uriList
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith('#'));

  if (!firstEntry) {
    return null;
  }

  try {
    const parsed = new URL(firstEntry);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return {
      url: parsed.toString(),
      label: parsed.hostname,
    };
  } catch {
    return null;
  }
}

/** Encode a dropped `File` as an `image` payload. The file is read
 *  with a `FileReader` and the base64 portion of the data URL is
 *  forwarded to the main process so the original `mimeType` is
 *  preserved. */
export async function imageToPayload(file: File): Promise<IngestPayload> {
  const dataUrl = await readFileAsDataUrl(file);
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Image payload encoding failed.');
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const mimeTypeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);

  return {
    kind: 'image',
    mimeType: file.type || mimeTypeMatch?.[1] || 'image/png',
    base64,
    filenameHint: file.name || 'drop-image',
  };
}

/** Read a `File` as a data URL string. The result is always a string
 *  or an error; the consumer (`imageToPayload`) handles the parse. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read dropped image file.'));
    };

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Image file could not be encoded as data URL.'));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

/** The asset-protocol URL the renderer uses to display an image-backed
 *  item. Returns `null` for items that aren't image-backed. */
export function getHeroPreviewSource(item: ShelfItemRecord): string | null {
  if (item.kind !== 'imageAsset' && !(item.kind === 'file' && item.mimeType.startsWith('image/'))) {
    return null;
  }

  const path = item.file.resolvedPath || item.file.originalPath;
  if (!path || item.file.isMissing) {
    return null;
  }

  return `ledge-asset://preview?path=${encodeURIComponent(path)}`;
}

/** Compute the class name for a hero-stack card based on its index
 *  and the total count. Handles the 1/2/3-card layouts. */
export function heroStackClassName(index: number, count: number): string {
  if (count === 2) {
    return index === 0 ? 'hero-stack-card-front' : 'hero-stack-card-back-left';
  }

  if (index === 0) {
    return 'hero-stack-card-front';
  }

  return index === 1 ? 'hero-stack-card-back-left' : 'hero-stack-card-back-right';
}
