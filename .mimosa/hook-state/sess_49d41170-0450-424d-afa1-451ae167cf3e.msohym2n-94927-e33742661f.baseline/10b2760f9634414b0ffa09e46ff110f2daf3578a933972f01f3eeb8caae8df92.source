import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";

// Phase 1 migration: backfill shelfItems from shelves.items arrays.
// Uses @convex-dev/migrations for resumable, bounded pagination.
//
// Run with:
//   npx convex run migrations:migrateShelfItems --dry-run
//   npx convex run migrations:migrateShelfItems
//
// Rollback: re-deploy Deploy 1 (widened schema) — shelves.items is still
// the source of truth until Deploy 2 removes dual-read.

const migrations = new Migrations(components.migrations);

export const migrateShelfItems = migrations.define({
  table: "shelves",
  migrateOne: async (ctx, doc) => {
    const shelf = doc as unknown as Record<string, unknown>;
    if ((shelf as any).itemsMigratedAt !== undefined) return { itemsMigratedAt: Date.now() };

    const items = (shelf as any).items ?? [];
    const serverNow = Date.now();
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      const sid = shelf.shelfId as string;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const existing = await (ctx.db as any)
        .query("shelfItems")
        .withIndex("by_team_shelf_item", (q: any) =>
          q.eq("teamId", "").eq("shelfId", sid).eq("itemId", item.id),
        )
        .unique();
      if (existing) continue;

      await (ctx.db as any).insert("shelfItems", {
        shelfId: sid,
        teamId: "",
        itemId: item.id,
        createdBy: shelf.userId,
        updatedBy: shelf.userId,
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
        preview: item.preview,
        order: typeof item.order === "number" ? item.order.toString() : (item.order as string),
        file: item.file,
        mimeType: item.mimeType,
        text: item.text,
        savedFilePath: item.savedFilePath,
        url: item.url,
        hex: item.hex,
        name: item.name,
        codeText: item.codeText,
        language: item.language,
        storageId: item.storageId,
        storageBytes: item.storageBytes,
        cloudStorageId: item.cloudStorageId,
        cloudStorageBytes: item.cloudStorageBytes,
        version: 1,
        serverUpdatedAt: (shelf.updatedAt as number) ?? serverNow,
        localUpdatedAt: item.createdAt as string,
        migratedAt: serverNow,
      });
    }

    return { itemsMigratedAt: serverNow };
  },
});
