// Run with `npm test`. The markdown the chat is drawn with, and the file links it can add. The server reads the same code to
// learn which paths a chat links to, so what is drawn as a link here is what a chat may open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTarget, linkedFiles, md } from '../public/md.mjs';

const href = (path, line) => `/f?p=${encodeURIComponent(path)}${line ? `&l=${line}` : ''}`;

// The file links in some markup, as { file, line, text }.
const links = markup => [...markup.matchAll(/<a class="file-link" href="[^"]*" target="_blank" rel="noopener" data-file="([^"]*)"(?: data-line="(\d+)")?>(.*?)<\/a>/g)]
  .map(([, file, line, text]) => ({ file, line: line ? Number(line) : null, text }));
const found = src => links(md(src, href));

test('a link whose target is an absolute path, a ~/ path or a file URL is a file link, and the page decides where it goes', () => {
  assert.equal(md('[the plan](/Users/eli/plan.md)', href),
    '<p><a class="file-link" href="/f?p=%2FUsers%2Feli%2Fplan.md" target="_blank" rel="noopener" data-file="/Users/eli/plan.md">the plan</a></p>');
  assert.deepEqual(found('[a](~/notes/a.md)'), [{ file: '~/notes/a.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](file:///Users/eli/a.md)'), [{ file: '/Users/eli/a.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](</Users/eli/my notes/a b.md>)'), [{ file: '/Users/eli/my notes/a b.md', line: null, text: 'a' }]);
});

test('a line after the path is a line to open at, and a column after that is dropped', () => {
  assert.equal(md('[a](/Users/eli/a.js:12)', href),
    '<p><a class="file-link" href="/f?p=%2FUsers%2Feli%2Fa.js&amp;l=12" target="_blank" rel="noopener" data-file="/Users/eli/a.js" data-line="12">a</a></p>');
  assert.deepEqual(found('[a](/Users/eli/a.js:12:5)'), [{ file: '/Users/eli/a.js', line: 12, text: 'a' }]);
  assert.deepEqual(found('[a](</Users/eli/my file.js:7>)'), [{ file: '/Users/eli/my file.js', line: 7, text: 'a' }]);
  assert.deepEqual(found('see /Users/eli/a.js:44 now'), [{ file: '/Users/eli/a.js', line: 44, text: '/Users/eli/a.js:44' }]);
  assert.equal(fileTarget('/Users/eli/a.js:0').line, null, 'line 0 is not a line, so the colon stays in the name');
  assert.equal(fileTarget('/Users/eli/a.js:0').path, '/Users/eli/a.js:0');
});

test('a file URL is the absolute path it names, with its percent escapes decoded', () => {
  assert.deepEqual(fileTarget('file:///Users/eli/a%20b.md'), { path: '/Users/eli/a b.md', line: null });
  assert.deepEqual(fileTarget('file://localhost/Users/eli/a.md:3'), { path: '/Users/eli/a.md', line: 3 });
  assert.equal(fileTarget('file://host/Users/eli/a.md'), null, 'a file on another host is not a file here');
  assert.equal(fileTarget('file:///Users/eli/%zz'), null, 'an escape that does not decode is refused');
  assert.equal(fileTarget('file:///Users/eli/a%00b'), null, 'a decoded NUL is refused');
  assert.equal(fileTarget('file:///Users/eli/%2e%2e/b'), null, 'a decoded .. is refused');
});

test('a bare path in prose is a file link without the punctuation that ends the sentence', () => {
  assert.deepEqual(found('I changed /Users/eli/a.md.'), [{ file: '/Users/eli/a.md', line: null, text: '/Users/eli/a.md' }]);
  assert.equal(md('I changed /Users/eli/a.md, and it works.', href).endsWith('</a>, and it works.</p>'), true);
  assert.equal(md('Did you open /Users/eli/a.md?', href).endsWith('</a>?</p>'), true);
  assert.deepEqual(found('(see /tmp/out.log)').map(l => l.file), ['/tmp/out.log']);
  assert.deepEqual(found('**/Users/eli/a.md** and ~/b.md').map(l => l.file), ['/Users/eli/a.md', '~/b.md']);
  assert.deepEqual(found('- /Users/eli/a.md\n- /Users/eli/b.md').map(l => l.file), ['/Users/eli/a.md', '/Users/eli/b.md']);
});

test('text that only looks like a route is not linked: /api/x and a bare /Users stay text', () => {
  for (const src of ['the /api/sessions route', 'at /Users alone', 'under /Users/', 'a/b/c.md', 'https://example.com/Users/eli/a.md']) {
    assert.deepEqual(found(src), [], src);
  }
  assert.equal(md('the /api/sessions route', href), '<p>the /api/sessions route</p>');
});

test('a target that is the root, a folder written with a slash, or has a . or .. in it is refused and drawn as before', () => {
  for (const target of ['/', '/Users/eli/', '/Users/eli/.', '/Users/eli/..', '/Users/eli/../b', '/Users//eli', '~/', '~/a/../b']) {
    assert.equal(fileTarget(target), null, target);
    assert.deepEqual(found(`[a](${target})`), [], target);
    assert.equal(md(`[a](${target})`, href), md(`[a](${target})`), target);
  }
  assert.equal(fileTarget('relative/path.md'), null);
  assert.equal(fileTarget('/Users/eli/a\u0000.md'), null);
  assert.equal(fileTarget('/Users/eli/a\n.md'), null);
});

test('a path followed by a very long run of closing punctuation and then a letter is drawn in well under 100 ms, with and without the callback', () => {
  // The quickest of three runs, so a busy machine does not fail it. Code that scans from every mark takes seconds.
  const best = run => Math.min(...[1, 2, 3].map(() => { const started = performance.now(); run(); return performance.now() - started; }));
  const took = [];
  for (const mark of ["'", '"', '.', ',', ';', ':', '!', '?']) {
    const src = `see /Users/eli/a.md${mark.repeat(100_000)}x`;
    took.push(best(() => md(src, href)), best(() => md(src)), best(() => linkedFiles(src)));
  }
  assert.ok(Math.max(...took) < 100, `slowest was ${Math.max(...took).toFixed(1)} ms`);
  assert.deepEqual(found("see /Users/eli/a.md'''. and (/tmp/b.txt)!?"), [
    { file: '/Users/eli/a.md', line: null, text: '/Users/eli/a.md' },
    { file: '/tmp/b.txt', line: null, text: '/tmp/b.txt' },
  ]);
});

test('a link whose text is over 1000 characters or whose target is over 4096 is not drawn as a link, so a line of brackets cannot make each scan to its end', () => {
  const target = n => `/${'a'.repeat(n - 1)}`;
  assert.equal(found(`[${'t'.repeat(1000)}](/Users/eli/a.md)`).length, 1);
  assert.deepEqual(found(`[${'t'.repeat(1001)}](/Users/eli/a.md)`), [{ file: '/Users/eli/a.md', line: null, text: '/Users/eli/a.md' }], 'its target is read as a path in prose');
  assert.equal(found(`[a](${target(4096)})`).length, 1);
  assert.deepEqual(found(`[a](${target(4097)})`), []);
  assert.equal(found(`[a](<${target(4096)}>)`).length, 1);
  assert.deepEqual(found(`[a](<${target(4097)}>)`), []);
});

test('an http link and a link drawn as code have the same bounds, so no link rule scans a line of brackets to its end on the server', () => {
  const url = n => `http://${'a'.repeat(n)}`;
  assert.match(md(`[a](${url(4096)})`), />a<\/a>/);
  assert.doesNotMatch(md(`[a](${url(4097)})`), />a<\/a>/);
  assert.match(md(`[${'t'.repeat(1000)}](http://x)`), /<a href="http:\/\/x"/);
  assert.equal(md(`[${'t'.repeat(1001)}](http://x)`), `<p>[${'t'.repeat(1001)}](http://x)</p>`);
  assert.equal(md(`[a](${'b'.repeat(4096)})`), `<p><code title="${'b'.repeat(4096)}">a</code></p>`);
  assert.equal(md(`[a](${'b'.repeat(4097)})`), `<p>[a](${'b'.repeat(4097)})</p>`);
  assert.equal(md(`[${'t'.repeat(1001)}](b)`), `<p>[${'t'.repeat(1001)}](b)</p>`);
});

test('a link target is read with its percent escapes decoded, in the plain and the angle form, and the page and the server get the decoded path', () => {
  assert.deepEqual(found('[a](/Users/eli/my%20notes/a%20b.md)'), [{ file: '/Users/eli/my notes/a b.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](</Users/eli/my%20notes/a%20b.md>)'), [{ file: '/Users/eli/my notes/a b.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](~/caf%C3%A9.md)'), [{ file: '~/café.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](/Users/eli/a%20b.js:12:5)'), [{ file: '/Users/eli/a b.js', line: 12, text: 'a' }]);
  assert.deepEqual(found('[a](/Users/eli/100%25.md)'), [{ file: '/Users/eli/100%.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](%2FUsers%2Feli%2Fa.md)'), [{ file: '/Users/eli/a.md', line: null, text: 'a' }], 'what the escapes decode to is what is checked');
  assert.deepEqual([...linkedFiles('[a](/Users/eli/a%20b.md) [b](<~/c%20d.md:3>)')].sort(), ['/Users/eli/a b.md', '~/c d.md']);
  assert.deepEqual(fileTarget('/Users/eli/a%20b.md', true), { path: '/Users/eli/a b.md', line: null });
  assert.deepEqual(fileTarget('/Users/eli/a%20b.md'), { path: '/Users/eli/a%20b.md', line: null }, 'only a link target is read as encoded');
  assert.equal(md('[a](/Users/eli/a%20b.md)', href).includes('href="/f?p=%2FUsers%2Feli%2Fa%20b.md"'), true);
});

test('a bare path or a code span is not decoded, so %20 in it stays three characters', () => {
  assert.deepEqual(found('see /Users/eli/a%20b.md now').map(l => l.file), ['/Users/eli/a%20b.md']);
  assert.deepEqual(found('`/Users/eli/a%20b.md`').map(l => l.file), ['/Users/eli/a%20b.md']);
  assert.deepEqual([...linkedFiles('see /Users/eli/a%20b.md and `~/c%20d.md`')].sort(), ['/Users/eli/a%20b.md', '~/c%20d.md']);
});

test('a link target with an escape that does not decode, or that decodes to something refused, is drawn as it is today', () => {
  for (const target of ['/Users/eli/%zz', '/Users/eli/%', '/Users/eli/%E0%A4%A', '/Users/eli/a%00b', '/Users/eli/%2e%2e/b', '/Users/eli/%2E', '/Users/eli/a%0Ab', '/Users/eli/a%2F%2Fb', '/Users/eli/a%3A12', '/Users/eli/a%3A12%3A5']) {
    assert.deepEqual(found(`[a](${target})`), [], target);
    assert.deepEqual(found(`[a](<${target}>)`), [], target);
    assert.equal(md(`[a](${target})`, href), md(`[a](${target})`), target);
  }
  assert.equal(fileTarget('/Users/eli/a%3A12', true), null);
  assert.equal(fileTarget('/Users/eli/a%zz', true), null);
});

test('a path inside a code block is text', () => {
  assert.deepEqual(found('```\n/Users/eli/a.md\n[a](/Users/eli/a.md)\n```'), []);
});

test('a code span links only when all of it is a rooted path, and keeps its code styling', () => {
  assert.equal(md('`/Users/eli/a.md`', href),
    '<p><a class="file-link" href="/f?p=%2FUsers%2Feli%2Fa.md" target="_blank" rel="noopener" data-file="/Users/eli/a.md"><code>/Users/eli/a.md</code></a></p>');
  assert.deepEqual(found('`~/b.md`').map(l => l.file), ['~/b.md']);
  assert.deepEqual(found('`ls /Users/eli/a.md`'), []);
  assert.deepEqual(found('`/Users/eli/a.md --flag`'), []);
  assert.deepEqual(found('`/api/x`'), []);
  assert.equal(md('`ls /Users/eli/a.md`', href), '<p><code>ls /Users/eli/a.md</code></p>');
});

test('a link already made around a code span is one anchor, not two', () => {
  assert.deepEqual(found('[`/Users/eli/a.md`](/Users/eli/a.md)'), [{ file: '/Users/eli/a.md', line: null, text: '<code>/Users/eli/a.md</code>' }]);
  assert.equal((md('[a path /Users/eli/b.md](/Users/eli/a.md)', href).match(/<a /g) || []).length, 1);
});

test('a path with a quote, an angle bracket or an ampersand is escaped in the attributes and in the text', () => {
  const markup = md('[a](/Users/eli/a"b<c&d.md) and /Users/eli/e"f.md', href);
  assert.deepEqual(links(markup).map(l => l.file), ['/Users/eli/a&quot;b&lt;c&amp;d.md', '/Users/eli/e&quot;f.md']);
  assert.equal(/<c|"b/.test(markup.replace(/<a [^>]*>|<\/a>|<\/?p>/g, '')), false);
  assert.equal(markup.includes('href="/f?p=%2FUsers%2Feli%2Fa%22b%3Cc%26d.md"'), true);
  assert.deepEqual([...linkedFiles('[a](/Users/eli/a"b<c&d.md)')], ['/Users/eli/a"b<c&d.md']);
});

test('links appear in lists, headings, quotes and tables, and a path the page does not link is drawn as it was', () => {
  const src = '# See /Users/eli/h.md\n\n- /Users/eli/l.md\n\n> /Users/eli/q.md\n\n|a|b|\n|---|---|\n|/Users/eli/t.md|[x](/Users/eli/u.md)|';
  assert.deepEqual(found(src).map(l => l.file), ['/Users/eli/h.md', '/Users/eli/l.md', '/Users/eli/q.md', '/Users/eli/t.md', '/Users/eli/u.md']);
  assert.equal(md('[a](/Users/eli/a.md) /Users/eli/b.md `/Users/eli/c.md`', () => null), md('[a](/Users/eli/a.md) /Users/eli/b.md `/Users/eli/c.md`'));
  assert.equal(md('[a](/Users/eli/a.md) /Users/eli/b.md', p => (p.endsWith('a.md') ? href(p) : null)).match(/<a /g).length, 1);
});

test('http links and plain emphasis are the same with and without the file callback', () => {
  const src = 'See [site](https://example.com) and https://example.com/a_b_c with *em* and **strong** and `code`.';
  assert.equal(md(src, href), md(src));
});

test('with no callback the output is exactly what it was before file links', () => {
  const was = [
  ["[a](/Users/x/a.md:12) and [b](<~/my file.md>) and /Users/x/c.md.",
    "<p><code title=\"/Users/x/a.md:12\">a</code> and [b](&lt;~/my file.md&gt;) and /Users/x/c.md.</p>"],
  ["`/Users/x/a.md` and `ls`",
    "<p><code>/Users/x/a.md</code> and <code>ls</code></p>"],
  ["# Title\n\n- one [a](/Users/x/a.md)\n- two **bold** _it_\n\n> quote /tmp/b.txt\n\n| a | b |\n|---|---|\n| /Users/x/a.md | `c` |",
    "<h3>Title</h3><ul><li>one <code title=\"/Users/x/a.md\">a</code></li><li>two <strong>bold</strong> <em>it</em></li></ul><blockquote><p>quote /tmp/b.txt</p></blockquote><div class=\"table\"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>/Users/x/a.md</td><td><code>c</code></td></tr></tbody></table></div>"],
  ["Visit https://example.com/a_b_c and [site](https://example.com). Mixed *em* and __strong__.",
    "<p>Visit <a href=\"https://example.com/a_b_c\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com/a_b_c</a> and <a href=\"https://example.com\" target=\"_blank\" rel=\"noopener noreferrer\">site</a>. Mixed <em>em</em> and __strong__.</p>"]
  ];
  for (const [text, markup] of was) {
    assert.equal(md(text), markup, text);
    assert.equal(md(text, null), markup, text);
    assert.equal(md(text, undefined), markup, text);
  }
});

test('linkedFiles is every path the markdown links, each once, and none for text with no file in it', () => {
  const src = 'a [x](/Users/eli/a.md:3) b /Users/eli/a.md c `~/b.md` d [y](<~/my c.md>) e `ls /tmp/z` f [z](https://example.com)';
  assert.deepEqual([...linkedFiles(src)].sort(), ['/Users/eli/a.md', '~/b.md', '~/my c.md']);
  assert.equal(linkedFiles('nothing to see, /api/x').size, 0);
  assert.equal(linkedFiles('').size, 0);
});

test('linkedFiles names the path with no line, so a link with a line and one without are the same file', () => {
  assert.deepEqual([...linkedFiles('[a](/Users/eli/a.md:3) [b](/Users/eli/a.md:9)')], ['/Users/eli/a.md']);
});

test('fileTarget takes only a string', () => {
  for (const bad of [undefined, null, 4, {}, ['/Users/eli/a']]) assert.equal(fileTarget(bad), null);
});

// The buttons and code of each fenced block, as { lang, tools, code }, where tools is the data-code of each button in order.
const blocks = markup => [...markup.matchAll(/<div class="code-block"><div class="code-head">(?:<span class="code-lang">(.*?)<\/span>)?<span class="code-tools">(.*?)<\/span><\/div><pre class="code"[^>]*><code>(.*?)<\/code><\/pre><\/div>/gs)]
  .map(([, lang, tools, code]) => ({ lang: lang ?? null, tools: [...tools.matchAll(/data-code="(\w+)"/g)].map(m => m[1]), code }));

test('every fenced block has a Copy button, and the code inside it is escaped as it was', () => {
  assert.deepEqual(blocks(md('```js\nconst a = "<b>" && 1;\n```')), [{ lang: 'js', tools: ['copy'], code: 'const a = &quot;&lt;b&gt;&quot; &amp;&amp; 1;' }]);
  assert.deepEqual(blocks(md('```\nplain text\nin two lines\n```')), [{ lang: null, tools: ['copy'], code: 'plain text\nin two lines' }]);
  assert.match(md('```js\nx\n```'), /<pre class="code" data-lang="js"><code>x<\/code><\/pre>/);
});

test('a block that is a command also has a Run button, and the rule is the one the page reads the command by', () => {
  assert.deepEqual(blocks(md('```bash\nls -la\n```')).map(b => b.tools), [['copy', 'run']]);
  assert.deepEqual(blocks(md('```\necho hello\n```')).map(b => b.tools), [['copy', 'run']], 'one line with no language');
  assert.deepEqual(blocks(md('```console\n$ ls\noutput\n```')).map(b => b.tools), [['copy', 'run']]);
  assert.deepEqual(blocks(md('```\none\ntwo\n```')).map(b => b.tools), [['copy']], 'two lines with no language');
  assert.deepEqual(blocks(md('```js\nls\n```')).map(b => b.tools), [['copy']]);
  assert.deepEqual(blocks(md('```console\noutput only\n```')).map(b => b.tools), [['copy']]);
});

test('a command block holding hidden characters has a Run button that is marked unavailable, and Copy is not', () => {
  const run = markup => /<button[^>]*data-code="run"[^>]*>/.exec(markup)[0];
  for (const hidden of ['‮', '​', '\u0007', '⁦']) {
    const button = run(md(`\`\`\`bash\nls ${hidden}-la\n\`\`\``));
    assert.match(button, /aria-disabled="true"/);
    assert.match(button, /data-tip="This block holds hidden characters, so it cannot be run"/);
  }
  assert.doesNotMatch(run(md('```bash\nls\t-la\n```')), /aria-disabled/, 'a tab is plain');
  assert.doesNotMatch(/<button[^>]*data-code="copy"[^>]*>/.exec(md('```bash\nls ‮\n```'))[0], /aria-disabled/);
});

test('every button has a label and a tooltip, and is a button that submits nothing', () => {
  const buttons = [...md('```bash\nls\n```').matchAll(/<button\b[^>]*>/g)].map(m => m[0]);
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.match(button, /type="button"/);
    assert.match(button, /aria-label="[^"]+"/);
    assert.match(button, /data-tip="[^"]+"/);
  }
});

test('a language word shows in the label, and a block inside a quote has its buttons too', () => {
  assert.equal(blocks(md('```a+b\nx\n```'))[0].lang, 'a+b');
  assert.deepEqual(blocks(md('> ```bash\n> ls\n> ```')).map(b => b.tools), [['copy', 'run']]);
});

// The text a browser would read from a block's code: its markup without tags, with the entities undone.
const textOfCode = markup => markup.replace(/<[^>]*>/g, '').replace(/&(lt|gt|quot|#39|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[e]);
const commands = markup => [...markup.matchAll(/<span class="cmd">(.*?)<\/span>/gs)].map(m => textOfCode(m[1]));

test('a console block marks its commands and keeps its text exactly as written', () => {
  const sources = [
    '$ ls\nREADME.md\n$ echo "<b>" && cat a.txt\ndone',
    '$ docker run \\\n  -it app\nstarted\n$ pwd',
    '\nbefore\n\n  $ indented\n\nafter\n',
    '$ only\n',
    'output only',
    '$ a\n$ b\n$ c',
  ];
  for (const text of sources) {
    const [block] = blocks(md(`\`\`\`console\n${text}\n\`\`\``));
    assert.equal(textOfCode(block.code), text, JSON.stringify(text));
  }
  assert.deepEqual(commands(md('```console\n$ ls\nREADME.md\n$ echo "<b>" && cat a.txt\ndone\n```')), ['$ ls', '$ echo "<b>" && cat a.txt']);
  assert.deepEqual(commands(md('```console\n$ docker run \\\n  -it app\nstarted\n$ pwd\n```')), ['$ docker run \\\n  -it app', '$ pwd']);
  assert.deepEqual(commands(md('```console\noutput only\n```')), []);
});

test('a block that is read as a console without saying so marks its commands too, and one that runs as written marks none', () => {
  assert.deepEqual(commands(md('```bash\n$ npm test\n$ npm run build\n```')), ['$ npm test', '$ npm run build']);
  assert.deepEqual(commands(md('```\n$ pwd\n```')), ['$ pwd']);
  assert.deepEqual(commands(md('```bash\n$HOME/bin/x\necho "$ x"\n```')), []);
  assert.deepEqual(commands(md('```js\n$ not a command\n```')), []);
  assert.deepEqual(commands(md('```\none\n$ two\n```')), []);
});

test('marking a console block\'s commands adds nothing for the server to link, and what the span holds is escaped', () => {
  assert.deepEqual([...linkedFiles('```console\n$ cat /Users/eli/a.md\n[x](/Users/eli/b.md)\n```')], []);
  assert.equal(md('```console\n$ echo "</span><img src=x onerror=alert(1)>"\n```').includes('<img'), false);
});

const pictures = markup => [...markup.matchAll(/<button type="button" class="md-image" data-md-image="([^"]*)" data-path="([^"]*)"><img loading="lazy" src="[^"]*" alt="([^"]*)"><\/button>/g)]
  .map(([, src, file, alt]) => ({ src, file, alt }));

test('an image whose target is a picture on this Mac is drawn as a button holding the picture, and its path is one the server may open', () => {
  assert.equal(md('![the chart](/Users/me/chart.png)', href),
    '<p><button type="button" class="md-image" data-md-image="/f?p=%2FUsers%2Fme%2Fchart.png" data-path="/Users/me/chart.png"><img loading="lazy" src="/f?p=%2FUsers%2Fme%2Fchart.png" alt="the chart"></button></p>');
  assert.deepEqual(pictures(md('![a](~/shots/a.JPG)', href)), [{ src: '/f?p=~%2Fshots%2Fa.JPG', file: '~/shots/a.JPG', alt: 'a' }]);
  assert.deepEqual(pictures(md('![a](</Users/me/my shots/a b.webp>)', href)).map(p => p.file), ['/Users/me/my shots/a b.webp']);
  assert.deepEqual(pictures(md('![a](/Users/me/my%20shots/a.gif)', href)).map(p => p.file), ['/Users/me/my shots/a.gif']);
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) assert.equal(pictures(md(`![a](/Users/me/a.${ext})`, href)).length, 1, ext);
  assert.deepEqual([...linkedFiles('![chart](/Users/me/chart.png)')], ['/Users/me/chart.png']);
});

test('an image with no alt text takes the name of its file, and the alt text is escaped', () => {
  assert.equal(pictures(md('![](/Users/me/shots/board.png)', href))[0].alt, 'board.png');
  assert.equal(pictures(md('![a "b" <i>c</i> & `d`](/Users/me/a.png)', href))[0].alt, 'a &quot;b&quot; &lt;i&gt;c&lt;/i&gt; &amp; d');
  assert.equal(md('![x" onerror="y](/Users/me/a.png)', href).includes('onerror="'), false);
});

test('an image the page will not open as a picture draws what the same link draws, with no stray bang', () => {
  const same = target => {
    const image = md(`![alt](${target})`, href);
    assert.equal(pictures(image).length, 0, target);
    assert.equal(image, md(`[alt](${target})`, href), target);
    assert.equal(image.includes('!'), false, target);
  };
  for (const target of ['shots/a.png', '../a.png', '/Users/me/../a.png', '/Users/me/a.png:12', '/Users/me/a.txt', '/Users/me/a.svg', '/Users/me/a']) same(target);
  assert.deepEqual(found('![alt](/Users/me/a.txt)'), [{ file: '/Users/me/a.txt', line: null, text: 'alt' }]);
  assert.equal(md('![alt](/Users/me/a.png)', () => null), md('[alt](/Users/me/a.png)', () => null));
  assert.equal(pictures(md('![alt](/Users/me/a.png)')).length, 0);
  assert.equal(md('![alt](/Users/me/a.png)'), md('[alt](/Users/me/a.png)'));
  assert.deepEqual([...linkedFiles('![a](shots/a.png) ![b](/Users/me/../a.png)')], []);
});

test('an https image stays a link labelled with its alt text, or its address, and is never loaded', () => {
  const url = 'https://example.com/a.png?x=1';
  assert.equal(md(`![chart](${url})`, href), `<p><a href="${url}" target="_blank" rel="noopener noreferrer">chart</a></p>`);
  assert.equal(md(`![](${url})`, href), `<p><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>`);
  assert.equal(/<img|md-image/.test(md(`![chart](${url}) ![b](http://example.com/b.png)`, href)), false);
});

test('an image in a list item, a table cell and a line of text is drawn, and each path is linked', () => {
  const list = md('- ![a](/Users/me/a.png)\n- ![b](/Users/me/b.png) text', href);
  assert.deepEqual(pictures(list).map(p => p.file), ['/Users/me/a.png', '/Users/me/b.png']);
  assert.match(list, /<li><button/);
  const table = md('| x | y |\n| --- | --- |\n| ![a](/Users/me/a.png) | b |', href);
  assert.match(table, /<td><button[^>]*class="md-image"/);
  assert.deepEqual([...linkedFiles('- ![a](/Users/me/a.png)\n\n| x |\n| --- |\n| ![b](/Users/me/b.png) |')], ['/Users/me/a.png', '/Users/me/b.png']);
});

test('an image is asked for as a picture, and a caller that declines pictures gets the link the text would draw', () => {
  const asked = [];
  md('![a](/Users/me/a.png)', (path, line, kind) => { asked.push(kind); return href(path, line); });
  assert.equal(asked[0], 'picture');
  const linkOnly = (path, line, kind) => (kind === 'picture' ? null : href(path, line));
  assert.equal(md('![a](/Users/me/a.png)', linkOnly), md('[a](/Users/me/a.png)', href));
});
