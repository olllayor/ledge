import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertTeamPermission, requireUser, sessionArgs } from "./model";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const inviteMember = mutation({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, userId, "admin");

    const pending = await ctx.db
      .query("teamInvitations")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();

    const existingPending = pending.find(
      (inv) => inv.email === args.email && inv.status === "pending",
    );
    if (existingPending) {
      return existingPending._id;
    }

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new ConvexError("Team not found.");

    const token = randomToken();
    const now = Date.now();

    return await ctx.db.insert("teamInvitations", {
      teamId: args.teamId,
      email: args.email,
      invitedBy: userId,
      role: args.role,
      token,
      status: "pending",
      expiresAt: now + INVITATION_TTL_MS,
      createdAt: now,
    });
  },
});

export const acceptInvitation = mutation({
  args: {
    ...sessionArgs,
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const invitation = await ctx.db
      .query("teamInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invitation || invitation.status !== "pending") {
      throw new ConvexError("Invitation not found or already responded to.");
    }

    if (invitation.expiresAt <= Date.now()) {
      await ctx.db.patch(invitation._id, { status: "revoked", respondedAt: Date.now() });
      throw new ConvexError("Invitation has expired.");
    }

    const existingMembership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", invitation.teamId).eq("userId", userId))
      .unique();

    if (existingMembership) {
      await ctx.db.patch(invitation._id, { status: "accepted", respondedAt: Date.now() });
      return { ok: true, alreadyMember: true };
    }

    await ctx.db.insert("teamMembers", {
      teamId: invitation.teamId,
      userId,
      role: invitation.role,
      joinedAt: Date.now(),
    });

    await ctx.db.patch(invitation._id, { status: "accepted", respondedAt: Date.now() });

    await ctx.db.patch(invitation.teamId, { updatedAt: Date.now() });

    return { ok: true, alreadyMember: false };
  },
});

export const rejectInvitation = mutation({
  args: {
    ...sessionArgs,
    token: v.string(),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.sessionToken);

    const invitation = await ctx.db
      .query("teamInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invitation || invitation.status !== "pending") {
      throw new ConvexError("Invitation not found or already responded to.");
    }

    if (invitation.expiresAt <= Date.now()) {
      await ctx.db.patch(invitation._id, { status: "revoked", respondedAt: Date.now() });
      throw new ConvexError("Invitation has expired.");
    }

    await ctx.db.patch(invitation._id, {
      status: "rejected",
      respondedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const revokeInvitation = mutation({
  args: {
    ...sessionArgs,
    invitationId: v.id("teamInvitations"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new ConvexError("Invitation not found.");

    await assertTeamPermission(ctx, invitation.teamId, userId, "admin");

    if (invitation.status !== "pending") {
      return { ok: true, alreadyResponded: true };
    }

    await ctx.db.patch(args.invitationId, {
      status: "revoked",
      respondedAt: Date.now(),
    });

    return { ok: true, alreadyResponded: false };
  },
});

export const listPendingForTeam = query({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, userId, "admin");

    return await ctx.db
      .query("teamInvitations")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const listPendingForEmail = query({
  args: {
    ...sessionArgs,
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found.");

    return await ctx.db
      .query("teamInvitations")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", user.email).eq("status", "pending"),
      )
      .collect();
  },
});
