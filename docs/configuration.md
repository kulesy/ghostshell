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

`gh` is the GitHub CLI that GhostShell asks for the state of the pull requests a session is working on. It defaults to `gh`, found on `PATH`, and the sign-in is whatever `gh auth login` stored. GhostShell never reads the token. Without `gh`, or without a sign-in, a session shows no pull requests.

### `chrome`

`chrome` is `true` by default. Set it to `false` to start every session without Claude in Chrome (see [Claude in Chrome](tools.md#claude-in-chrome)).

### `desktopHandoff`

`desktopHandoff` is `false` by default. Set it to `true` to hand new sessions to Claude Desktop (see [sessions started here](how-it-works.md#sessions-started-here)). Turning it on also hands over, the next time GhostShell starts, every session started here that Desktop does not have yet.

### `passkeyOrigins`

`passkeyOrigins` is a list of the https addresses that may use passkeys, empty by default. Write each entry as the browser shows the address, such as `https://capcom.example.com` or `https://capcom.example.com:8443`, with no path.

`http://localhost:<port>` needs no entry and works for a browser that opens it directly. GhostShell ignores an entry that is not https or that is an IP address, and says so on stderr. Keep your real addresses in `config.local.json`. [Remote access](remote-access.md#passkeys-over-https) has an example.

## Environment variables

Four environment variables win over both files:

- `PORT` sets the port.
- `CAPCOM_CLAUDE` sets the CLI.
- `CAPCOM_GH` sets the GitHub CLI.
- `CAPCOM_STATE` points a test instance at its own login, registry and routines.

Two instances that share a state folder both fire its routines, so always give a test instance its own.
