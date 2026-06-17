// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("cleanupExpiredSessions deletes expired and revoked sessions", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: "cron-sessions@example.com",
      createdAt: now,
      updatedAt: now,
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("authSessions", {
      userId,
      tokenHash: "active-token",
      expiresAt: now + 60 * 60 * 1000,
      createdAt: now,
    });
    await ctx.db.insert("authSessions", {
      userId,
      tokenHash: "expired-token",
      expiresAt: now - 60 * 1000,
      createdAt: now - 60_000,
    });
    await ctx.db.insert("authSessions", {
      userId,
      tokenHash: "revoked-token",
      expiresAt: now + 60 * 60 * 1000,
      revokedAt: now,
      createdAt: now,
    });
  });

  await t.mutation(internal.crons.cleanupExpiredSessions);

  const remaining = await t.run(async (ctx) =>
    ctx.db
      .query("authSessions")
      .collect()
      .then((rows) => rows.map((r) => r.tokenHash)),
  );
  expect(remaining).toEqual(["active-token"]);
});

test("cleanupExpiredOtps deletes expired and consumed OTPs", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("authOtps", {
      email: "a@example.com",
      codeHash: "active-hash",
      expiresAt: now + 60 * 60 * 1000,
      createdAt: now,
    });
    await ctx.db.insert("authOtps", {
      email: "b@example.com",
      codeHash: "expired-hash",
      expiresAt: now - 60 * 1000,
      createdAt: now - 60_000,
    });
    await ctx.db.insert("authOtps", {
      email: "c@example.com",
      codeHash: "consumed-hash",
      expiresAt: now + 60 * 60 * 1000,
      consumedAt: now,
      createdAt: now,
    });
  });

  await t.mutation(internal.crons.cleanupExpiredOtps);

  const remaining = await t.run(async (ctx) =>
    ctx.db
      .query("authOtps")
      .collect()
      .then((rows) => rows.map((r) => r.codeHash)),
  );
  expect(remaining).toEqual(["active-hash"]);
});

test("cleanupOldWebhookEvents deletes only events older than 30 days", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const recent = now - 5 * 24 * 60 * 60 * 1000;
  const ancient = now - 60 * 24 * 60 * 60 * 1000;
  await t.run(async (ctx) => {
    await ctx.db.insert("processedWebhookEvents", {
      eventId: "recent-1",
      source: "lemonsqueezy",
      processedAt: recent,
    });
    await ctx.db.insert("processedWebhookEvents", {
      eventId: "ancient-1",
      source: "lemonsqueezy",
      processedAt: ancient,
    });
  });

  await t.mutation(internal.crons.cleanupOldWebhookEvents);

  const remaining = await t.run(async (ctx) =>
    ctx.db
      .query("processedWebhookEvents")
      .collect()
      .then((rows) => rows.map((r) => r.eventId)),
  );
  expect(remaining).toEqual(["recent-1"]);
});

test("cleanupOldUploadEvents deletes only events older than 24h", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: "cron-uploads@example.com",
      createdAt: now,
      updatedAt: now,
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("imageUploadEvents", {
      userId,
      bytes: 1024,
      createdAt: now - 60 * 60 * 1000,
      status: "resolved",
    });
    await ctx.db.insert("imageUploadEvents", {
      userId,
      bytes: 1024,
      createdAt: now - 48 * 60 * 60 * 1000,
      status: "abandoned",
    });
  });

  await t.mutation(internal.crons.cleanupOldUploadEvents);

  const remaining = await t.run(async (ctx) =>
    ctx.db
      .query("imageUploadEvents")
      .collect()
      .then((rows) => rows.map((r) => r.status)),
  );
  expect(remaining).toEqual(["resolved"]);
});
