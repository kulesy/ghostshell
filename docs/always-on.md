# Always on

How to keep GhostShell running on macOS with a launchd agent and Capcom.app.

On macOS, a launchd agent starts GhostShell at login and restarts it if it stops. It runs the server through Capcom.app, a small app this folder builds, so that macOS asks about permissions for the app. The app keeps the name Capcom, so macOS lists it as Capcom.

```bash
npm run build-app
open ~/Library/Application\ Support/Capcom/Capcom.app
npm run install-agent
```

## Why the app is there

macOS asks before a process reads the calendar, opens the Desktop, Documents or Downloads folder, or controls another app, and it asks about the app at the root of the process tree. Under launchd alone that root is node, which has no permissions and none of the reason strings macOS shows when it asks, so a session's calendar read fails. The app's executable runs the server as its child and stays its parent, so the server and every session under it count as Capcom.

## Build the app

`npm run build-app` builds the app with Swift, from the Xcode command line tools, into `~/Library/Application Support/Capcom/`. Opening it asks for full calendar access, the three folders, and control of Calendar and Google Chrome if they are open. Click Allow on each.

The answers show under Capcom in System Settings, in Privacy & Security, and a session that later needs something else gets macOS's usual question, naming Capcom.

Use `npm run build-app -- --id com.example.capcom` for a bundle id of your own. The app's signature is ad hoc, so macOS ties the answers to that exact build. After a rebuild, open the app again and restart the agent.

## Install the agent

`npm run install-agent` fills in `launchd/capcom.plist.template` with the app (when it is built), your Node binary, this folder, your home folder and the folder that holds `claude`. It writes `~/Library/LaunchAgents/local.capcom.plist`, creates `~/Library/Logs/capcom/` for the logs, and prints two `launchctl` commands. You run those yourself:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.capcom.plist
launchctl kickstart -k gui/$(id -u)/local.capcom
```

Use `npm run install-agent -- --label com.example.capcom` for a different label. Run the installer again after you move the folder or change Node versions, because the plist stores both paths.

## Restart the service

A restart is only needed after a change to server-side code. Files under `public/` load from disk on each request, so a reload of the page is enough for those.

```bash
npm run restart
```

By default the command waits until no chat is running, then restarts the service once. It returns at once with exit code 0 and does the work in one background process, so a failure shows only in the log. This is because a chat that runs it is itself ended by the restart. Progress goes to `restart.log` in the state folder (`~/.config/capcom/` unless you changed `stateDir`), and a `restart.lock` file there stops a second restart starting while one is under way.

1. `--now` restarts without waiting.
2. `--wait <minutes>` sets how long to wait, 30 by default. When the time is up the worker restarts nothing, exits with an error and logs which chats were still running.
3. `--label <name>` names the launchd job. By default it is the job that is running the server, found with `launchctl list`, and `local.capcom` when none is found.
4. `--foreground` runs in the terminal you are in, without the background process.

No chat is running when each chat process under the server is idle. A chat is idle when the last user or assistant entry in its transcript is an assistant message that ended its turn. A chat the user stopped, or one that ended on a limit or an API error, is idle too. A chat in the middle of a tool call, one waiting on a tool result, one with a new message, and one whose transcript cannot be read all count as running. So does a chat that started without a session id on its command line, unless its folder holds exactly one transcript written since it started. An idle chat's process can stay alive for a while, so a process that exists does not make a chat busy. The command checks twice, 5 seconds apart, right before it restarts. It cannot see background work that a chat started before ending its turn, such as a background agent or shell command, so check for that yourself first.

A restart ends every running chat. Chats you resume afterwards come back on the default model and effort.

The command refuses to restart a server that has been up for less than 60 seconds, even with `--now`, and says how long to wait. This limits repeated restarts to one a minute at most. It slows a loop down and does not stop one.

Do not schedule restarts any other way. `launchctl submit` keeps its program alive and relaunches it each time it exits, so a submitted restart script restarts the service in a loop and ends every chat each time.
