// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { TestConvex } from "convex-test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function setupUser(
  t: TestConvex<typeof schema>,
  email: string,
): Promise<{ sessionToken: string; userId: Id<"users"> }> {
  const sessionToken = `test-session-${Math.random().toString(36).slice(2)}`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const tokenHash = await sha256(sessionToken);
    await ctx.db.insert("authSessions", {
      userId: id,
      tokenHash,
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: Date.now(),
    });
    return id;
  });
  return { sessionToken, userId: userId! };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function setupTeam(
  t: TestConvex<typeof schema>,
  owner: { sessionToken: string; userId: Id<"users"> },
): Promise<Id<"teams">> {
  return (await t.run(async (ctx) => {
    const teamId = await ctx.db.insert("teams", {
      name: "Design Team",
      createdBy: owner.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("teamMembers", {
      teamId,
      userId: owner.userId,
      role: "admin",
      joinedAt: Date.now(),
    });
    return teamId;
  }))!;
}

test("invite → pending list shows team name → accept creates membership", async () => {
  const t = convexTest(schema, modules);
  const owner = await setupUser(t, "owner@example.com");
  const invitee = await setupUser(t, "newbie@example.com");
  const teamId = await setupTeam(t, owner);

  await t.mutation(api.invitations.inviteMember, {
    sessionToken: owner.sessionToken,
    teamId,
    email: "newbie@example.com",
    role: "member",
  });

  const pending = await t.query(api.invitations.listPendingForEmail, {
    sessionToken: invitee.sessionToken,
  });
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    email: "newbie@example.com",
    status: "pending",
    teamName: "Design Team",
  });

  const token = await t.run(async (ctx) => {
    const inv = await ctx.db
      .query("teamInvitations")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .first();
    return inv!.token;
  });

  const accepted = await t.mutation(api.invitations.acceptInvitation, {
    sessionToken: invitee.sessionToken,
    token,
  });
  expect(accepted).toEqual({ ok: true, alreadyMember: false });

  const afterAccept = await t.query(api.invitations.listPendingForEmail, {
    sessionToken: invitee.sessionToken,
  });
  expect(afterAccept).toHaveLength(0);
});

test("non-admin members cannot invite", async () => {
  const t = convexTest(schema, modules);
  const owner = await setupUser(t, "owner2@example.com");
  const member = await setupUser(t, "member2@example.com");
  const teamId = await setupTeam(t, owner);

  await t.run(async (ctx) => {
    await ctx.db.insert("teamMembers", {
      teamId,
      userId: member.userId,
      role: "member",
      joinedAt: Date.now(),
    });
  });

  await expect(
    t.mutation(api.invitations.inviteMember, {
      sessionToken: member.sessionToken,
      teamId,
      email: "someone@example.com",
      role: "member",
    }),
  ).rejects.toThrow("Admin permission required.");
});

test("re-inviting an existing pending invite is idempotent", async () => {
  const t = convexTest(schema, modules);
  const owner = await setupUser(t, "owner3@example.com");
  const teamId = await setupTeam(t, owner);

  const first = await t.mutation(api.invitations.inviteMember, {
    sessionToken: owner.sessionToken,
    teamId,
    email: "pending@example.com",
    role: "member",
  });
  const second = await t.mutation(api.invitations.inviteMember, {
    sessionToken: owner.sessionToken,
    teamId,
    email: "pending@example.com",
    role: "member",
  });

  expect(second).toBe(first);

  const count = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("teamInvitations")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
    return rows.length;
  });
  expect(count).toBe(1);
});
