# Teams — Sharing Shelves with Collaborators

> **Prerequisite:** Cloud Sync must be configured and you must be signed in.  
> Open Preferences → **Cloud Sync** and sign in with your email.

---

## Quick Start

1. Open **Preferences → Teams**.
2. Type a team name and click **Create**.
3. Click the team in the list to select it.
4. Under **Invite member**, enter an email and click **Invite**.

---

## Managing Teams

### Create a team
In Preferences → Teams, enter a name in the "New team name" field and click **Create**. You automatically become the team admin.

### Rename a team
Select the team, click **Rename** next to the team name, edit, and click **Save**.

### Delete a team
Select the team, scroll to the **Delete team** section, click **Delete**, then **Confirm delete**. This permanently removes the team and all memberships. Pending invitations are revoked.

---

## Members

### Roles
- **Admin** — Can rename the team, invite/remove members, change roles, and delete the team.
- **Member** — Can view the team and use shared shelves (pending Phase 5).

### Remove a member
Admins see a **Remove** button next to each non-admin member. Click it to remove them.

### Change a member's role
Admins can promote members to admin or demote admins to member (except themselves) via the role dropdown in the member list.

---

## Invitations

### Invite someone
1. Select your team.
2. Enter their email in the **Invite member** field.
3. Choose **Member** or **Admin** role.
4. Click **Invite**.

An invitation is created and the recipient sees it when they sign into Cloud Sync.

### Accept or decline an invitation
When you have pending invitations, they appear at the top of the shelf view (the drop zone area). Click **Accept** to join the team or **Decline** to reject.

You can also accept/reject from the shelf header area if the invitation banner is visible.

### Revoke an invitation
As an admin, select your team. Pending invitations are listed under **Pending invitations**. Click **Revoke** to cancel an invitation.

---

## Switching Between Teams

The shelf topbar shows the currently active team (or **Personal**). Click it to open a dropdown and switch:

- **Personal** — Your private shelves, visible only to you.
- **Any team you belong to** — When shelf sharing is enabled (Phase 5), shelves created under a team context are visible to all team members.

Your active team choice persists across app restarts.

---

## What's Coming (Phase 5)

The next phase will add shared shelf editing:
- Create shelves in a team context
- See live updates from other team members
- Per-shelf sharing controls

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cloud Sync is not configured" | Set `VITE_CONVEX_URL` or check Preferences → Cloud Sync. |
| "Sign in to use teams" | Go to Preferences → Cloud Sync and sign in. |
| No "Teams" in Preferences | Teams only appears when Cloud Sync is configured and you're signed in. |
| Invitation not showing up | The other user must sign in to Cloud Sync with the invited email. |
| Can't remove an admin member | The team creator (original admin) cannot be removed. Only other admins can be removed by another admin. |
