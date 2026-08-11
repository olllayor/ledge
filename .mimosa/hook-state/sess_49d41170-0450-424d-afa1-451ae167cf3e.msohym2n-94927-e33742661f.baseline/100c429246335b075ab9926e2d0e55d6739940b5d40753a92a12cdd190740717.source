import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertTeamPermission, requireUser, sessionArgs } from "./model";

export const createTeam = mutation({
  args: {
    ...sessionArgs,
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const serverNow = Date.now();

    const teamId = await ctx.db.insert("teams", {
      name: args.name,
      createdBy: userId,
      createdAt: serverNow,
      updatedAt: serverNow,
    });

    await ctx.db.insert("teamMembers", {
      teamId,
      userId,
      role: "admin",
      joinedAt: serverNow,
    });

    return teamId;
  },
});

export const getTeam = query({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, userId);

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new ConvexError("Team not found.");

    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();

    return { team, members };
  },
});

export const updateTeam = mutation({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, userId, "admin");

    await ctx.db.patch(args.teamId, { name: args.name, updatedAt: Date.now() });
    return args.teamId;
  },
});

export const listMyTeams = query({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const teamIds = memberships.map((m) => m.teamId);
    if (teamIds.length === 0) return [];

    const teams = await Promise.all(teamIds.map((id) => ctx.db.get(id)));
    return teams
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => ({
        ...t,
        myRole: memberships.find((m) => m.teamId === t._id)!.role,
      }));
  },
});

export const updateMemberRole = mutation({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const actorId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, actorId, "admin");

    if (args.userId === actorId) {
      throw new ConvexError("Cannot change your own role.");
    }

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", args.teamId).eq("userId", args.userId))
      .unique();

    if (!membership) {
      throw new ConvexError("User is not a member of this team.");
    }

    await ctx.db.patch(membership._id, { role: args.role });
    return membership._id;
  },
});

export const removeMember = mutation({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actorId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, actorId, "admin");

    if (args.userId === actorId) {
      throw new ConvexError("Cannot remove yourself. Delete the team instead.");
    }

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", args.teamId).eq("userId", args.userId))
      .unique();

    if (!membership) {
      throw new ConvexError("User is not a member of this team.");
    }

    await ctx.db.delete(membership._id);
    return { ok: true };
  },
});

export const deleteTeam = mutation({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, userId, "admin");

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new ConvexError("Team not found.");

    // Remove all members.
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    for (const member of members) {
      await ctx.db.delete(member._id);
    }

    // Revoke all pending invitations.
    const invitations = await ctx.db
      .query("teamInvitations")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    for (const inv of invitations) {
      await ctx.db.patch(inv._id, { status: "revoked", respondedAt: Date.now() });
    }

    await ctx.db.delete(args.teamId);
    return { ok: true };
  },
});
