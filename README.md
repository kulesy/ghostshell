<div align="center">

<h1><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/logo-dark.svg"><img alt="GhostShell" src="docs/media/logo-light.svg" width="180"></picture></h1>

<p><strong>A browser chat client for every Claude Code session on your Mac.</strong></p>

<p>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-3a3a3a?style=flat-square&labelColor=191919"></a>
  <a href="docs/setup.md"><img alt="Node 20 or later" src="https://img.shields.io/badge/node-20%20or%20later-3a3a3a?style=flat-square&labelColor=191919&logo=nodedotjs&logoColor=white"></a>
  <a href="docs/front-end.md"><img alt="No dependencies" src="https://img.shields.io/badge/dependencies-none-3a3a3a?style=flat-square&labelColor=191919"></a>
  <a href="docs/always-on.md"><img alt="Runs on macOS" src="https://img.shields.io/badge/runs%20on-macOS-3a3a3a?style=flat-square&labelColor=191919&logo=apple&logoColor=white"></a>
</p>

<p>
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="docs/remote-access.md">Remote access</a> ·
  <a href="docs/adr/README.md">Decisions</a>
</p>

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.png">
  <img alt="GhostShell with the Acme Web project open: its groups and sessions in the list, and a chat where Claude fixed a flaky checkout test." src="docs/media/hero-light.png">
</picture>

Figure: a chat open beside its project's sessions, from a demo instance with made-up data

GhostShell lists the sessions you start in Claude Desktop, the routine runs and the ones you start in a terminal. You open any of them in a browser tab, on the Mac or on your phone, and carry on the chat. Each chat runs the real `claude` CLI, so your login, skills, hooks and MCP servers come with it.

## Highlights

<table>
  <tr>
    <td width="50%" valign="top"><b>One list for every session</b><br>Desktop, terminal and routine runs, sorted into your own projects, groups and pins, with sessions nested under a parent and their status, pull requests included, rolled up to it. <a href="docs/session-list.md">Session list</a></td>
    <td width="50%" valign="top"><b>The real CLI behind each chat</b><br>Approvals show as cards, and a chat keeps working when you close the page. <a href="docs/how-it-works.md">How it works</a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>A prompt box like Desktop&#39;s</b><br>Pick the model, effort and fast mode, run skills from <code>/</code>, watch the context fill, and attach images, PDFs and other files. <a href="docs/chat.md">Chat</a></td>
    <td width="50%" valign="top"><b>Live work as it happens</b><br>Thinking, tool calls and a status line stream in while Claude works. <a href="docs/chat.md#live-work">Live work</a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>A terminal beside the chat</b><br>Run commands in the session&#39;s folder, or run a code block from a reply with one click. <a href="docs/terminal.md">Terminal</a></td>
    <td width="50%" valign="top"><b>Routines on a schedule</b><br>GhostShell runs your routines on their schedules, and you add, edit and delete them on its Routines page. <a href="docs/routines.md">Routines</a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>Desktop-style tools</b><br>Chips, widgets and questions from GhostShell&#39;s own MCP server, a chat for each group and each section of the list, and Claude in Chrome. <a href="docs/tools.md">Tools</a></td>
    <td width="50%" valign="top"><b>On your phone</b><br>Install it as an app on the Mac and the phone. Over https, sign in with a passkey. <a href="docs/remote-access.md">Remote access</a></td>
  </tr>
</table>

<p align="center">
  <img alt="The Acme Web project's sessions on a phone, in the dark theme." src="docs/media/phone-list-dark.png" width="260">
  &nbsp;&nbsp;
  <img alt="The flaky checkout test chat on a phone, in the dark theme." src="docs/media/phone-dark.png" width="260">
</p>

<p align="center">Figure: the same project and chat on a phone</p>

## Quick start

You need a Mac with Node 20 or later and Claude Code's `claude` CLI, signed in. GhostShell has no npm dependencies and no build step.

```bash
git clone https://github.com/kulesy/ghostshell.git
cd ghostshell
npm run set-password
npm start
```

1. Open http://localhost:4310 and sign in with the password you set. GhostShell refuses every request until a password is set.
2. To install it as an app on the Mac, open http://localhost:4310 in Chrome and choose Install. Chrome only offers Install on a secure address, and it treats localhost as one.
3. To use it on your phone, put a reverse proxy or a private network you trust in front of it, as [Remote access](docs/remote-access.md) describes. Then add it to the phone's home screen from Safari or Chrome.
4. To start GhostShell at login and keep it running, follow [Always on](docs/always-on.md).

GhostShell listens on 127.0.0.1 only. Anyone who signs in can run commands as you, so pick a long password and keep the address private.

## Docs

| Page | What it covers |
| --- | --- |
| [How it works](docs/how-it-works.md) | Where sessions come from, how a chat runs, and how GhostShell shares sessions with Desktop |
| [Chat](docs/chat.md) | The prompt box, the model menu, slash commands, live work, tool calls and messages between chats |
| [Attachments](docs/attachments.md) | Images, files, PDFs and the image viewer |
| [Session list](docs/session-list.md) | Projects, groups, pins, nesting, search, archiving and the keyboard |
| [Tools](docs/tools.md) | Chips, chapters, group and section chats, widgets, questions and Claude in Chrome |
| [Terminal](docs/terminal.md) | The terminal panel and `!` commands |
| [Routines](docs/routines.md) | Running your routines on a schedule, and the Routines page |
| [Setup](docs/setup.md) | The password, sign-in, passkeys, installing the app and the tests |
| [Configuration](docs/configuration.md) | `config.json`, `config.local.json` and the environment variables |
| [Always on](docs/always-on.md) | The launchd agent and the small Capcom app that holds macOS permissions |
| [Remote access](docs/remote-access.md) | Reaching GhostShell from a phone through a proxy, and what keeps it safe |
| [The page](docs/front-end.md) | The Preact and htm front end, with no build step |

The reasons behind the design are in [the decision records](docs/adr/README.md), one for each decision.

## The name

GhostShell used to be called Capcom. The repo moved to https://github.com/kulesy/ghostshell, and the old address redirects to it. The package, the service, the stored settings and the MCP server keep the name capcom, so an existing install keeps working. [The decision record](docs/adr/20261023-ghostshell-name.md) lists each name that stays and why.

The name and the Ghost look are inspired by the Ghost in Destiny. GhostShell has no connection with Bungie or Destiny and uses none of their assets.

## Licence

MIT, see [LICENSE](LICENSE). The libraries in `public/vendor/` keep their own licences, as [The page](docs/front-end.md#licence) lists.
