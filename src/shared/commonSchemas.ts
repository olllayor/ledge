import { z } from 'zod';

export const fileRefSchema = z.object({
  originalPath: z.string(),
  bookmarkBase64: z.string().default(''),
  resolvedPath: z.string().default(''),
  isStale: z.boolean().default(false),
  isMissing: z.boolean().default(false),
});

const previewSchema = z.object({
  summary: z.string(),
  detail: z.string().default(''),
});

const shelfItemBaseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  subtitle: z.string().default(''),
  preview: previewSchema,
});

const preferencesValuesSchema = z.object({
  launchAtLogin: z.boolean(),
  shakeEnabled: z.boolean(),
  shakeSensitivity: z.enum(['gentle', 'balanced', 'firm']),
  excludedBundleIds: z.array(z.string()),
  globalShortcut: z.string(),
  hasSeenShelfLimitMigration: z.boolean(),
});

export { previewSchema, shelfItemBaseSchema, preferencesValuesSchema };