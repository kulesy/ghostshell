# Draw widgets the way Desktop does, in a frame that cannot reach Capcom

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-19
- Tags: widgets, sandbox, security, tools, mcp, live-work

## Context and Problem Statement

Capcom has drawn `show_widget` since it [began to serve Desktop-style tools](20261007-own-mcp-server-for-desktop-style-tools.md), but a widget written for Desktop did not draw the same. The frame held the widget's code, a script that reported its height, and a content policy that let scripts load from two public hosts. Desktop gives a widget styles to build on: colour variables, SVG classes, colour ramps, a type scale and plain looks for form controls. A widget written for Desktop uses them, so in Capcom it drew bare, and a diagram that loads mermaid from esm.sh did not load. Desktop also lets a widget ask Claude a follow-up question, open a link, and shows something while the code is written. The owner wanted widgets to behave the same in Capcom.

A widget's code can come from a chat that has read untrusted web pages. How can Capcom draw a widget the way Desktop does without giving that code a way to reach Capcom, its cookie or the owner's chat?

## Decision Drivers

- A widget written for Desktop should draw and behave the same in Capcom.
- A widget's code cannot be trusted, so it must not reach Capcom's origin, cookie or API, and anything it asks for that the owner did not click has to go to the owner first.
- Nothing is copied from Desktop, because Capcom is public under the MIT licence.
- `show_widget`'s description goes with every request, so it has to stay short.
- No build step and no new dependency.

## Considered Options

1. Give the frame host styles and a small script written for Capcom, keep it sandboxed with no origin, and gate what it asks for
2. The same, with Capcom's origin allowed in the frame
3. The same, asking before every `sendPrompt`
4. Serve Desktop's own stylesheet and guide text
5. Stop the frame from navigating with a Navigation API guard
6. Leave the frame as it was

## Decision Outcome

Chosen option: "Give the frame host styles and a small script written for Capcom, keep it sandboxed with no origin, and gate what it asks for", because it draws a widget written for Desktop the same way, keeps the sandbox closed, and sends nothing on a widget's say-so that the owner did not click.

- **Host styles.** `public/ui/widget-theme.js` holds the frame's styles and `public/ui/widget-frame.js` builds the frame's document from them. The styles define the colour and type variables a Desktop widget uses (`--surface-1`, `--text-secondary`, `--fill-accent` and the rest), the SVG classes (`t`, `ts`, `th`, `box`, `node`, `arr`, `leader`), nine colour ramps (`c-purple`, `c-teal` and the others) and plain looks for text, buttons and fields. The names are Desktop's. The values and the code are Capcom's own, and nothing is copied from Desktop. The values follow the page's shadcn tokens: the greys, shadows and focus ring are its neutral scale, and four values equal the page's own, which `test/widget.test.mjs` checks against `public/app.css` in light and dark. Those are `--fill-accent` (the page's `--primary`), the two fonts, and `--surface-2` (the page's `--widget-card`, the card drawn round an SVG widget). The frame cannot load Geist, so a widget draws in the system font that follows it in the stack. The rules for plain elements carry no specificity, so a widget's own rule always wins.
- **Theme.** The document is built once, with the colour mode at that moment. When the system's light or dark setting changes, the page sends the frame a message that changes `data-mode` on its root. A theme change never reloads a running widget.
- **Icons.** Tabler's outline icons (`@tabler/icons-webfont` 3.48.0, MIT) are vendored in `public/vendor/`. When a widget's code contains `ti-`, the page loads the font and the list of icon names once and sends both to the frame in a message, the font as an `ArrayBuffer`. The frame's content policy never names Capcom's origin, so a widget cannot make any request to Capcom, and it gets the font without one.
- **Sending a follow-up.** `sendPrompt(text)` sends `text` as the owner's next message at once only after a click inside that widget: the browser reports a user activation, the focus is on that widget's frame, the last send was five or more seconds ago, and the text is 4,000 characters or fewer. A click or key press anywhere else on Capcom's page, or in another widget, in the last six seconds sends the text to the bar instead. That includes pressing Send or Cancel in a bar. Focus alone cannot say which widget was clicked, because a sandboxed frame can take the focus back after the owner clicks somewhere else (tested in Chromium 151 and WebKit 26.5 on 19 Oct 2026). So each frame's boot script reports its own clicks and key presses to the page, and the page decides 50 ms after the call, so a report from another frame can arrive first. Any other call puts the text in a bar under the widget with Send and Cancel, and nothing is sent until the owner presses Send. The bar's Send waits 600 ms after the bar appears, so a tap meant for something else cannot land on it. The owner chose send-on-click on 18 Oct 2026 so that it feels like Desktop. The gate is there because a widget's code can come from a chat that read untrusted pages, and a script that could send messages on its own could steer Claude.
- **Links.** `<a href>`, `openLink(url)` and `window.open(url)` never navigate the frame. Each passes the address up to the page. After a click inside that widget, by the same click test a follow-up passes, the page opens it in a new tab at once with `noopener` and `noreferrer`. A second link within five seconds of the last one opened goes to the bar, because WebKit leaves a click active after it opens a tab, and one click there opened three tabs 1.3 s apart (tried in WebKit 2311 on 2 Nov 2026). Any other call puts the address in the same kind of bar, with Open link and Cancel, and the page opens it only when the owner presses the button. The owner chose one-click links on 2 Nov 2026, after a widget listing dozens of pull requests needed a second click in the bar for each ([#35](https://github.com/kulesy/ghostshell/issues/35)). Only `http` and `https` addresses of 2,048 characters or fewer, with no username or password, are offered. A `#` link stays inside the widget.
- **Navigation.** A widget can still set `location` and send its own frame to another address, which makes one request. No browser offers a way to stop that. `navigate-to`, the content policy directive meant for it, never shipped. The Navigation API's `navigate` event does not fire in a document with an opaque origin, which a sandboxed frame has (tested in Chromium 151 and WebKit 26.5), so a guard written on it never runs. The first load of the frame is the widget's document. A second load closes the frame and shows a note in its place. The request is accepted because it can carry only what is in the widget's own code or what was typed into it, and the chat that wrote the widget can already reach the network with its own tools.
- **Network.** A widget may load scripts, styles, images and fonts from cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net and unpkg.com, make requests to those four, and load styles and fonts from Google Fonts. Widgets written for Desktop load Chart.js from cdnjs and mermaid from esm.sh. Every other directive stays closed, and none is open to a wildcard or to plain http.
- **Guide.** `widget_guide` is a new tool on Capcom's MCP server. It takes no input and returns `lib/widget-guide.md`, a guide in Capcom's own words: when to use a widget, the shape of the code, the limits of the sandbox, size, network, theme, the variable names, controls, SVG classes, icons, accessibility, `sendPrompt` and links. `show_widget`'s description is short, because it goes with every request, and asks the model to call `widget_guide` once per chat. The server reads the file when the tool is called, so an edit shows in the next chat without a restart. `test/tools.test.mjs` holds the guide to the frame: every variable it offers is one the host defines, every variable the host defines is in it, and the limits it states are the ones the frame enforces.
- **Loading messages.** `show_widget` takes `loading_messages` as its first field, one to four short phrases. The CLI streams a tool's input as partial JSON, so the tracker reads the phrases while the code is still being written (see [Show Claude's live work](20261016-live-work-from-the-cli-stream.md)). The page shows them in a placeholder where the widget will draw, one after another about every two seconds, with a default line until the first arrives. The placeholder goes when the widget's row reaches the thread. If the row has not come ten seconds after the call left the live list, it goes anyway.

### Consequences

- ✅ A widget written for Desktop draws the same in Capcom, light and dark, and a change of theme does not reload it.
- ✅ A widget cannot reach Capcom, its cookie or its API, and cannot send a message or open a link unless the owner clicked in a widget in the last five seconds.
- ✅ The owner sees that a widget is coming, in the model's own phrases, from the moment the model starts writing it.
- ✅ A message a widget sends leaves the chat scrolled where it is, where one from the prompt box goes to the end, so the owner keeps their place in a widget with a button for each step ([#36](https://github.com/kulesy/ghostshell/issues/36)).
- ✅ The guide is read once per chat that draws a widget, so the cost is not in every request.
- ❌ A widget can still navigate its own frame once, which sends one request to any address. Capcom closes the frame on the second load.
- ❌ A click anywhere inside a widget lets it send one message whose text it chooses, and the owner sees the text in the chat only after it is sent.
- ❌ A click anywhere inside a widget lets it open one http or https address it chooses, and the owner sees the address only in the new tab. Link text can hide a lookalike host, and the address can carry what was typed into the widget to any host, past the content policy.
- ❌ A click in one widget followed by a click in another within six seconds puts the second widget's follow-up in the bar instead of sending it.
- ❌ A widget controls what its own frame reports. It can stay silent about the owner's clicks (`document.open()` or a `document.write` after load removes the boot script's listeners, tested in Chromium 151 and WebKit 26.5), or report clicks that did not happen, which makes other widgets ask first. Neither helps it send from its own frame. Two widgets in one chat that work together can send two messages from one click on the first.
- ❌ Scripts from the four hosts run in the frame with inline and `eval` code allowed, so a compromised host could run code in a widget. That code still has no way to Capcom.
- ❌ The frame is not a secure context, so a widget has no `navigator.clipboard` or `crypto.subtle`, and `localStorage` throws. The guide says so.
- ❌ The names are Desktop's, and nothing keeps them in step with Desktop. A name Desktop adds later draws as the browser's default until Capcom defines it.
- ❌ The icon font and its stylesheet add about 0.7 MB to the repository. The page loads them only when a widget uses an icon.

## Pros and Cons of the Options

### Host styles and a small script written for Capcom, in a sandbox with no origin, with gates

- ✅ Draws a widget written for Desktop the same, and keeps the frame closed
- ✅ Everything the widget asks for goes through the page, which can ask the owner
- ❌ Capcom writes and maintains the styles, the script and the guide

### Capcom's origin allowed in the frame

This is `allow-same-origin` on the sandbox, or Capcom's origin in the content policy.

- ✅ The font, the styles and the guide could load by ordinary requests
- ❌ A widget could reach Capcom's API, which the sandbox now keeps out of its reach, and with `allow-same-origin` it would run as Capcom's own origin

### Asking before every `sendPrompt`

- ✅ A script cannot message Claude without the owner seeing it first
- ❌ Desktop sends on a click and the owner chose that, so every button that asks a question would need a second click

### Desktop's own stylesheet and guide text

- ✅ The same look with no writing
- ❌ The text is not Capcom's to publish in a public MIT repository

### A Navigation API guard

- ✅ It would stop a widget leaving its page
- ❌ Tried, and inert: the `navigate` event does not fire in a sandboxed frame

### Leaving the frame as it was

- ✅ Nothing to build or maintain
- ❌ A widget written for Desktop draws bare, a diagram that loads from esm.sh does not load, and the frame has no way to send a follow-up or open a link

## Links

- [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md), whose `show_widget` this changes
- [Show Claude's live work from the CLI's stream](20261016-live-work-from-the-cli-stream.md), whose tracker reads `loading_messages`
- [Publish Capcom as a public repository under the MIT licence](20261013-public-repo-under-mit.md), which is why nothing is copied from Desktop
- [Rewrite the front end on vendored Preact with htm](20261015-preact-htm-front-end.md), which set how vendored files are kept
