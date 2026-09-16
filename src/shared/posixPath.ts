/** Minimal POSIX path helpers for shared code (no node dependency). */

export function basename(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}
