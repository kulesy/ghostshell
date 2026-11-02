# Writing a widget for GhostShell

A widget is a picture or a small tool that GhostShell draws in the chat when you call `show_widget`. GhostShell's tools come from the `capcom` MCP server. Read this once per chat, before your first widget.

## When to use one

Use a widget when a picture or a control shows something better than text does: a chart of numbers, a diagram of how parts connect, a calculator, a slider that changes a result. Use markdown for lists, small tables and code.

Put the explanation in your reply text, outside the widget, and do not repeat it inside. Keep the widget compact, roughly 150 to 500 px tall unless the content needs more.

You cannot see the widget once it draws, and the tool result only says it is showing. Keep the code plain and check your numbers.

## The code

`widget_code` is a fragment. Write no doctype, `html`, `head` or `body` tags. The root is HTML or SVG. GhostShell puts it in a document that already holds the styles and scripts below, so `sendPrompt` and `openLink` exist before your scripts run.

- A root that starts with `<svg` is drawn as a card: a border, rounded corners, a surface colour and padding. Give the SVG a `viewBox` and `width="100%"`, and no fixed pixel size. Text scales with the picture, so make the viewBox about 400 units wide. A wider one shrinks the labels on a phone.
- Any other root is drawn on a transparent background over the chat. Add a panel of your own (`background: var(--surface-1)`) where you want one.

## The sandbox

Scripts run. The frame has no origin of its own and is not a secure context.

- `localStorage`, `sessionStorage` and `indexedDB` throw. `document.cookie` throws or reads empty. Keep state in variables.
- `alert`, `confirm` and `prompt` do nothing. Build any dialog out of elements.
- Forms do not submit. Listen for `click` or `input` and read the fields in script.
- `navigator.clipboard`, `crypto.subtle` and `crypto.randomUUID` do not exist, and blob workers are blocked.
- `position: fixed` pins to the frame, not to the chat, and adds nothing to the frame's height. Use normal flow.

## Size

The frame is as wide as the chat column: about 360 px on a phone, up to about 740 px on a desktop. Design for 360 px first and let content wrap or shrink.

The frame's height follows your content, up to 4000 px. Past that the content scrolls inside the frame. Never size anything to `100vh`. A `vh` is the frame's own height, so the widget stays as tall as the empty frame (about 190 px).

## Network

Scripts, styles, images, fonts and `fetch` load from these four hosts and nowhere else:

- `https://cdnjs.cloudflare.com`
- `https://esm.sh`
- `https://cdn.jsdelivr.net`
- `https://unpkg.com`

Google Fonts is also allowed, for styles (`fonts.googleapis.com`) and fonts (`fonts.gstatic.com`). Every other request is blocked, your own APIs included. Put the data in the code as JavaScript values.

Chart.js comes from cdnjs as a script tag:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
```

mermaid comes from esm.sh as an ES module:

```html
<div id="out"></div>
<script type="module">
import mermaid from 'https://esm.sh/mermaid@11';
mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.mode === 'dark' ? 'dark' : 'default' });
const { svg } = await mermaid.render('m1', 'flowchart LR\n  A[Start] --> B[Done]');
document.getElementById('out').innerHTML = svg;
</script>
```

## Theme

GhostShell follows the system's light or dark setting. `<html>` carries `data-mode="light"` or `data-mode="dark"`, and the colour variables change with it. CSS that uses the variables needs nothing more.

Script that picks colours, such as a canvas or a chart library, reads the variables when it draws and draws again when `data-mode` changes. Give a canvas a wrapper with a set height, and set `maintainAspectRatio: false` on a Chart.js chart:

```html
<div style="position:relative;height:260px"><canvas id="chart" role="img" aria-label="Units sold per month"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let chart;
function draw() {
  chart?.destroy();
  Chart.defaults.color = css('--text-secondary');
  Chart.defaults.borderColor = css('--border');
  chart = new Chart(document.getElementById('chart'), {
    type: 'bar',
    data: { labels: ['Jan', 'Feb', 'Mar'], datasets: [{ data: [12, 19, 7], backgroundColor: css('--fill-accent') }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}
draw();
new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
</script>
```

Chart.js takes the colour values as they are. mermaid throws on them (`Unsupported color format`), so choose its `theme` from `data-mode` and leave `themeVariables` alone.

## Variables

Use these names. For any other name, give `var()` a fallback, as in `var(--text-link, currentColor)`.

- Surfaces: `--surface-{0,1,2,3}` (page to highest), `--page-bg`, `--surface-panel`, `--surface-popover`
- Text: `--text-{primary,secondary,muted,disabled}`, with the short forms `--p`, `--s` and `--t` for the first three. `--bg2` is surface 1 and `--b` is the border.
- Edges: `--border`, `--border-strong`, `--border-stronger`
- Roles: `--{bg,text,border,fill,on}-{accent,danger,success,warning,pro}` and `--fill-{accent,danger,success,warning,pro}-hover`. For each role, `bg` is a pale wash, `text` reads on the wash, `border` edges it, `fill` is a solid and `on` reads on the solid.
- Brand: `--fill-brand`, `--fill-brand-hover`, `--on-brand`
- Tints: `--{bg,text}-tint-{red,orange,yellow,green,aqua,blue,violet,magenta}`, a pale background and the text for it
- Fills: `--fill-primary`, `--fill-primary-hover`, `--on-primary`, `--fill-secondary`, `--fill-secondary-hover`, `--fill-secondary-ring`, `--fill-ghost-hover`, `--fill-ghost-selected`, `--fill-field`, `--fill-field-ring`, `--fill-control`, `--fill-control-hover`, `--fill-disabled`, `--bg-neutral`, `--bg-highlight`, `--bg-accent-muted`
- Ramps: `--c-{purple,teal,coral,pink,gray,blue,green,amber,red}-{fill,stroke,title,sub}`, the colours the `c-` classes use
- Type: `--font-sans`, `--font-mono`, `--font-voice`, `--font-size-{caption,footnote,body,prose,code,heading,title}`
- Space and shape: `--radius`, `--h-control`, `--pad-{sm,md,lg,xl}`, `--gap-{xs,sm,md,lg,xl}`
- Depth and motion: `--shadow-{sm,md,lg,popover}`, `--shadow-color`, `--focus-shadow`, `--dur-{fast,snap,base,slow}`, `--ease-{out,snap,overshoot}`

## Controls and type

Plain `button`, `input`, `select`, `textarea`, range, checkbox and radio elements arrive styled. Use them bare, with no classes. A rule of your own always wins, because the host rules carry no specificity. Buttons have one look, so make a primary button yourself: `background: var(--fill-primary); color: var(--on-primary)`.

Text is 16 px at a 1.7 line height in `--font-sans`. `h1`, `h2` and `h3` are 22, 18 and 16 px at weight 500. Links use `--text-accent`.

## SVG

These classes carry the house style. A `fill` or `stroke` you set on the element wins over them.

- `t` is 14 px text, `ts` is 12 px secondary text, and `th` is 14 px heading text at weight 500.
- `box` is a rectangle with the `--surface-1` fill and a thin strong edge.
- `arr` is a 1.5 px muted arrow line with no fill, and `leader` is a dashed hairline.
- `node` marks a clickable shape. It gets a pointer cursor and dims on hover.

The nine ramps `c-purple`, `c-teal`, `c-coral`, `c-pink`, `c-gray`, `c-blue`, `c-green`, `c-amber` and `c-red` go on a `<g>` or on a shape. They colour the direct `rect`, `circle` and `ellipse` children, overriding any `fill` or `stroke` attribute there, and the `th`, `t` and `ts` text inside. They leave `path` alone, so an arrow inside the group keeps its own look. Use one ramp per kind of thing.

```html
<svg viewBox="0 0 400 110" width="100%" role="img">
  <title>Request flow</title>
  <desc>A client sends a request and a server answers.</desc>
  <defs>
    <marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M2 1.5L8 5L2 8.5" fill="none" stroke="context-stroke" stroke-width="1.5"/>
    </marker>
  </defs>
  <g class="c-blue">
    <rect x="10" y="25" width="140" height="60" rx="8"/>
    <text class="th" x="80" y="52" text-anchor="middle">Client</text>
    <text class="ts" x="80" y="70" text-anchor="middle">sends the request</text>
  </g>
  <path class="arr" d="M150 55H250" marker-end="url(#head)"/>
  <g class="c-teal">
    <rect x="250" y="25" width="140" height="60" rx="8"/>
    <text class="th" x="320" y="52" text-anchor="middle">Server</text>
    <text class="ts" x="320" y="70" text-anchor="middle">sends the answer</text>
  </g>
</svg>
```

## Icons

Tabler outline icons draw from a font: `<i class="ti ti-chart-bar" aria-hidden="true"></i>`. About 5,200 names exist, all outline, and a name that does not exist draws nothing. An icon takes its parent's colour and font size. GhostShell loads the font only when your code contains `ti-`.

## Accessibility

Give an SVG that shows data `role="img"` with a `<title>` and a `<desc>` that say what it shows. Give a `<canvas>` `role="img"` and an `aria-label`. Put text on every button. An icon-only button gets text in the `sr-only` class, which is already defined:

```html
<button><i class="ti ti-refresh" aria-hidden="true"></i><span class="sr-only">Refresh</span></button>
```

Do not use colour as the only signal, and stop animations under `@media (prefers-reduced-motion: reduce)`.

## Sending a follow-up

`sendPrompt(text)` sends `text` to this chat as the user's next message, and you answer it. Call it from the click handler of a button, once per click, and it sends at once. Any other call (on load, from a timer, right after the user clicked somewhere else, a second one within five seconds of a send, or with text over 4000 characters) is shown to the user in a bar, and nothing is sent until they press Send. An empty text is dropped.

Build the text from what the user chose, and write it as their own message (`Compare ${a} with ${b}`). End the label of every button that sends with ↗, as in `Explain this ↗`, so the user can tell it sends a message.

## Links

`<a href>`, `openLink(url)` and `window.open(url)` never navigate the widget. A link the user clicks in the widget opens in a new tab at once. Any other (on load, from a timer, right after the user clicked somewhere else, a second one within five seconds of the last link opened) is shown to the user in a bar with its address, and opens only when they press Open link. GhostShell opens `http` and `https` addresses of at most 2048 characters with no username or password, and ignores the rest. A `#` link stays inside the widget.

Never set `location` or `location.href`. The frame would leave your page, and GhostShell closes the widget and shows a note in its place.

## The tool arguments

Call `widget_guide` once per chat. Call `show_widget` with its arguments in this order:

1. `loading_messages`: one to four short phrases of a few words each, such as `Plotting the three values`. GhostShell shows them in a placeholder while you write the code. Put this field first, so it arrives before the long code does.
2. `title`: a short snake_case name. It becomes the frame's accessible name.
3. `widget_code`: the fragment.
