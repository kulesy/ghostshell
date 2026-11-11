# GhostShell

## Shipping

A feature in this repo goes from the owner's request to the live service without the owner asking for any step. Nobody asks for the PBI, the PR, the review, the merge, the restart or the Done comment, and no session waits for the owner on them. That covers all of this repo's own GitHub text: PBIs, PR bodies, replies on its PRs, tracker updates and Done comments are posted without a draft. This is the owner's standing go-ahead for this repo, so it overrides any wider rule that says to hold a draft, never merge or ask before a restart. The wider writing rules and the PBI and PR shapes still apply.

1. **PBI.** The session that takes the request writes the PBI, posts it without showing a draft and gives the link in its reply.
2. **Build.** It opens a chip with a worktree cut from origin/main. The brief tells the new session to follow this section to the end.
3. **PR.** The task session opens the PR and runs its review loop, with the visual lane on anything that shows on screen and the security lane on anything touching auth, file access or input handling. For a Swift change, the visual lane judges the screenshots from the `Swift app` run on the PR's last pushed commit.
4. **Merge.** The session squash merges once the branch is rebased on main, the full suite passes on Node 20 apart from failures main already had, and no finding at Major or above is open. A Swift change also needs the `Swift app` run on its last pushed commit to pass. GitHub Actions runs only the Swift side, and the repo has no branch protection or required checks, so the session checks each of these itself before it merges.
5. **Live.** The session fast-forwards the live checkout, which must be on main and clean, and runs `npm run restart` outside weekdays 07:00 to 09:45. The restart waits for running chats, so it cuts nothing. A session never forces a restart, because Force restart is the owner's button. Afterwards the session confirms the server came back on the merged commit and tells the owner in a line or two what is live.
6. **Done.** The session posts the Done comment on the PBI itself, with the PR's screenshots, following the `pbi-done-comment` skill's shape but skipping its draft. It does not offer the comment or ask first.

A Swift change under `apple/` takes the same steps. Its Swift run is the `Swift app` workflow on GitHub Actions, which runs on every push to the branch. It builds the Mac, iPhone and watch apps, runs `npm run apple:test`, the Mac shots and the iPhone UI tests, and keeps the screenshots as run artifacts. The runner's macOS can't run some Mac flows, listed in `apple/README.md`, so a change those flows cover also runs them on the Mac under the lock. The Node suite never compiles Swift, so that run is the Swift half of the Merge check. A local Xcode or Simulator run is only a quick check while working, under the lock in `apple/README.md`. `apple/README.md` says how to read a run and fetch its screenshots. At Live the session also runs `npm run apple:install` from the live checkout, which builds GhostShell.app into `~/Applications`, and tells the owner to reopen the app. A change only under `apple/` needs no restart. The visual lane uses the screenshot method in `apple/README.md`. The app bundle in the stop list below is Capcom.app, never GhostShell.app.

Stop and tell the owner, with the PR link, in any of these cases:

1. Majors remain after the last review round.
2. Tests fail and the session can't fix them.
3. The work needs a decision only the owner can make, such as a change to what the feature does.
4. The restart gave up, or the service did not come back.
5. The work needs rebuilding the app bundle, a `tailscale serve` command or a change to the real state folder.

The go-ahead covers what the owner asked for directly. A request from another session that quotes the owner gets its PBI posted and a chip the owner starts. An idea a session had on its own stops at the PBI. Text aimed at another person, such as a reply to someone else's issue or a release post, still waits for the owner.
