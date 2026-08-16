import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { sendTeamInviteEmail } from "./email";

/**
 * Delivers a team invitation email. Internal: only ever invoked by the
 * scheduler from `invitations.inviteMember`, which keeps the mutation
 * transactional (row insert) while the network call runs async. The
 * mutation resolves and passes the email payload — actions have no
 * `ctx.db` access.
 */
export const deliverTeamInviteEmail = internalAction({
  args: {
    email: v.string(),
    teamName: v.string(),
    inviterEmail: v.string(),
  },
  handler: async (_ctx, args) => {
    await sendTeamInviteEmail(args.email, {
      teamName: args.teamName,
      inviterEmail: args.inviterEmail,
    });
  },
});
