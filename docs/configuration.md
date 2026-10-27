# Configuration

The settings in `config.json` and `config.local.json`, and the four environment variables that override them.

## Files

`config.json` holds the defaults: the port, the `claude` command, the folders GhostShell reads and the timeouts. To change a value on one machine, put it in `config.local.json` in the repo root. That file is optional and git-ignored, and its values replace the ones in `config.json`.

```json
{ "claude": "/usr/local/bin/claude", "chrome": false }
```

## Settings

### `station`

`station` is the machine's name, sent with the session index. The page does not show it. It defaults to the short hostname.

### `claude`

`claude` is the CLI to run. It defaults to `claude`, found on `PATH`.

### `gh`

`gh` is the GitHub CLI that GhostShell asks for the state of the pull requests a session is working on. It defaults to `gh`, found on `PATH`, and the sign-in is whatever `gh auth login` stored. GhostShell never reads the token. It asks github.com only, and runs `gh` without `GH_HOST`, `GH_REPO` and `GH_DEBUG`. Without `gh`, or without a sign-in, a session shows no pull requests.

### `chrome`

`chrome` is `true` by default. Set it to `false` to start every session without Claude in Chrome (see [Claude in Chrome](tools.md#claude-in-chrome)).

### `autoTitle`

`autoTitle` is `true` by default. GhostShell then names each session it starts: a session started with a title keeps it, and one you start by typing is named once its first reply finishes (see [naming a new session](session-list.md#naming-a-new-session)). That costs one short call to Haiku 5.5 for each typed session. Set it to `false` to make no such call and leave the first line of the first message as the title.

### `desktopHandoff`

`desktopHandoff` is `false` by default. Set it to `true` to hand new sessions to Claude Desktop (see [sessions started here](how-it-works.md#sessions-started-here)). Turning it on also hands over, the next time GhostShell starts, every session started here that Desktop does not have yet.

### `passkeyOrigins`

`passkeyOrigins` is a list of the https addresses that may use passkeys, empty by default. Write each entry as the browser shows the address, such as `https://capcom.example.com` or `https://capcom.example.com:8443`, with no path.

`http://localhost:<port>` needs no entry and works for a browser that opens it directly. GhostShell ignores an entry that is not https or that is an IP address, and says so on stderr. Keep your real addresses in `config.local.json`. [Remote access](remote-access.md#passkeys-over-https) has an example.

## Environment variables

Five environment variables win over both files:

- `PORT` sets the port.
- `CAPCOM_CLAUDE` sets the CLI.
- `CAPCOM_GH` sets the GitHub CLI.
- `CAPCOM_STATE` points a test instance at its own login, registry and routines.
- `CAPCOM_AUTO_TITLE` set to `0` turns off [`autoTitle`](#autotitle), and any other value turns it on.

Two instances that share a state folder both fire its routines, so always give a test instance its own.
