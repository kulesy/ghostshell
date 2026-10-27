# Let a chip name the group its session opens in

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-27
- Tags: chips, groups, nesting, layout, tools

## Context and Problem Statement

A chip made with `spawn_task` starts its session nested under the session that made the chip (see [Nest sessions under a parent, and follow the links Desktop records](20261022-nest-sessions-under-a-parent.md)). A nested session shows in its holder's group, so the new session lands in the group of the session that raised it. Only a chip raised from a group's own chat placed its session in a group by choice.

On 2026-10-27 Eli asked for the review chips that a pull request backlog session raises in the In Progress group to open in the Reviewing group. Inheriting the parent's group put them in In Progress. The session that raises a chip knows where the work belongs, but it had no way to say so.

How does a chip name a group, when is the name checked, and what happens to the link between the new session and the session that made it?

## Decision Drivers

- The model chooses the group, so a name it gets wrong has to fail where it can fix it, when the chip is made, and not when the owner presses Start.
- Names are the only thing the model sees. The sidebar shows no ids to it.
- Groups can be renamed and deleted between the chip and the press of Start.
- The posted card and the transcript's tool input are text the model chose. Neither may place a session.
- A chip with no group has to behave as it does now.
- The owner should see on the card where the session will open.

## Considered Options

1. Resolve the name to an id when the chip is made, refuse an unknown or shared name, and unlink a session that names a group
2. Store the name on the chip and look it up at Start
3. Let the chip name a group and keep the session nested under its parent
4. Make every chip start in a group, and default to the parent's

## Decision Outcome

Chosen option: "Resolve the name to an id when the chip is made, refuse an unknown or shared name, and unlink a session that names a group", because a wrong name comes back to the model while it can still fix it, a rename after that cannot break the chip, and the session stands in the group the owner expects.

1. **The field.** `spawn_task` takes an optional `group`, the name of a group as the sidebar shows it. It is in the base schema, so the chats of groups and sections get it too, with a description that leaves out nesting, since their chips never nest.
2. **Resolved at creation.** `callTool` in `lib/tools.mjs` matches the name against the groups in `layout.json`, trimmed and without regard to case, using `cleanName` from `lib/layout.mjs`. The chat context carries a `groups` function for this, passed the way `chips` and `subs` are. It reads the layout again at each call. A blank `group` counts as none. The built-in sections are not groups and never match.
3. **Refused early.** A name that matches no group is refused with one sentence that lists the existing group names. Group names are not unique in the layout, so a name that matches two groups is refused as ambiguous. Nothing is stored in either case.
4. **Stored as an id.** The chip keeps `group: <id>`, never the name. The reply to the model says the group's name.
5. **At Start.** The server reads the group from the chip it stored. A group in the posted body or in the transcript's tool input is ignored. If the group no longer exists, Start answers 400 with one sentence that tells the owner to ask the session to suggest the task again, and starts nothing. Otherwise it starts the session and calls `layout.move(id, group, { unlink: true })`, which writes `parents[id] = null` and the group assignment. The session is a top level entry in that group. This wins over the placement a group's own chat gives. A group deleted while the session starts leaves it loose at the top level, unlinked, rather than nested where the chip did not ask. The folder rules for group and section chats stay as they were.
6. **A chip with no group keeps nesting.** It stays nested under the session that raised it and writes no group of its own. The family rule shows it in the parent's group and moves it with the parent, as Desktop nests the tasks it suggests. A chip from a group's own chat still goes into that group as before.
7. **The card.** The chips route adds `opensIn` to each chip, worded on the server from the group's current name, so a rename shows. A named group reads "Opens in Reviewing". A chip with no group raised in a group's own chat reads "Opens in" and that group. One raised by a session that shows in a group reads "Opens under this session, in" and that group, and one raised by a session in no group reads "Opens under this session". A chip whose group was deleted reads "Its group has been deleted". The card draws the line under the folder line. A chip raised by a routine run has none, since a run holds no sessions, and one raised by an archived session reads "Opens in" its group, since nothing shows under it. A started or dismissed chip keeps the line. A chip from a section's chat has none, and a Desktop chip has none until it is started and GhostShell stores it.
8. **A restart is needed.** The tool schema is loaded when a chat starts, so a session only sees `group` after GhostShell restarts and its chat restarts. Until then it can only leave the group out.

### Consequences

- ✅ A session can send review work to the Reviewing group while it stays in In Progress.
- ✅ A misspelt group name comes back with the list of names, and no chip is made.
- ✅ A group renamed after the chip was made still receives the session, and the card shows the new name.
- ✅ A group deleted after the chip was made stops Start with a message. One deleted in the seconds the session takes to start leaves it loose.
- ✅ A chip with no group behaves as it did.
- ❌ A named group takes the session out of its parent's family. It no longer shows under the session that raised it, and that session's sub session tools no longer list it. The owner can nest it back by hand.
- ❌ A shared group name cannot be used until one of the groups is renamed.
- ❌ A chip made before this change, or by a session that has not restarted, cannot name a group.

## Pros and Cons of the Options

### Resolve the name to an id when the chip is made, refuse an unknown or shared name, and unlink a session that names a group

- ✅ The model hears about a bad name while it can still correct it.
- ✅ An id survives a rename.
- ❌ It needs the layout inside the tool call, which `callTool` did not have.

### Store the name on the chip and look it up at Start

- ✅ No new context for `callTool`.
- ❌ A bad name shows up when the owner presses Start, and the model that chose it is gone from the loop.
- ❌ A rename between the chip and Start breaks it.

### Let the chip name a group and keep the session nested under its parent

- ✅ The session stays in its parent's family, so the parent's tools list it.
- ❌ A nested session shows in its holder's group, so the group it names would not show. The two cannot both hold.

### Make every chip start in a group, and default to the parent's

- ✅ Every session would have a group of its own.
- ❌ A session moved with its parent would stay behind, and a chip with no group would no longer be a child.

## Links

- [Nest sessions under a parent, and follow the links Desktop records](20261022-nest-sessions-under-a-parent.md), amended 2026-10-27 to say a chip that names a group no longer nests.
- [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md), which serves `spawn_task`.
- [Give each group a session of its own, with the group's status drawn above its chat](20261023-a-session-for-each-group.md), whose chat places the chips it raises in its own group.
