// Whether a Bash command only reads, so a group's chat can run it without a card. The default is to ask: a string passes only when every
// character parses under the rules below and every simple command in it is on the list, so any construct this does not know is a no.

// The word after a redirect or an `&` is read up to one of these.
const OPERATORS = new Set([' ', '\t', '\n', ';', '|', '&', '<', '>', '(', ')']);
const isBoundary = c => c === undefined || OPERATORS.has(c);

// Words in the shape { text, glob }: `text` is what the shell would pass the command, and `glob` says an unquoted *, ? or [ was in it.
// Returns the simple commands as lists of words, or null for anything this does not parse.
function parse(input) {
  const commands = [];
  let words = [];
  let buf = '';
  let inWord = false;
  let glob = false;
  let quoted = false;
  let needsNext = false;
  const endWord = () => {
    if (inWord) words.push({ text: buf, glob });
    buf = '';
    inWord = false;
    glob = false;
    quoted = false;
  };
  // A `|`, `&&` or `||` needs a command on each side and so does a `;`. A newline may stand after an operator or on its own.
  const endCommand = op => {
    endWord();
    if (words.length) {
      commands.push(words);
      words = [];
      needsNext = op === '|' || op === '&&' || op === '||';
    } else if (op !== '\n') return false;
    return true;
  };
  // $HOME and ${HOME} are the only expansions allowed, and only where the name ends.
  const home = (i) => {
    if (input.startsWith('$HOME', i) && !/[\w[:]/.test(input[i + 5] ?? '')) return 5;
    if (input.startsWith('${HOME}', i)) return 7;
    return 0;
  };
  // The target of a redirect, which must be /dev/null, read from `i`. Returns the index after it or -1.
  const devNull = (i) => {
    while (input[i] === ' ' || input[i] === '\t') i++;
    let j = i;
    while (j < input.length && !isBoundary(input[j])) j++;
    return input.slice(i, j) === '/dev/null' ? j : -1;
  };

  for (let i = 0; i < input.length;) {
    const c = input[i];
    if (c === '\0') return null;
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) return null;
      buf += input.slice(i + 1, end);
      inWord = quoted = true;
      i = end + 1;
    } else if (c === '"') {
      inWord = quoted = true;
      i++;
      for (;;) {
        const d = input[i];
        if (d === undefined) return null;
        if (d === '"') { i++; break; }
        if (d === '\\') {
          const e = input[i + 1];
          if (e === undefined) return null;
          if ('$`"\\'.includes(e)) buf += e;
          else if (e !== '\n') buf += d + e;
          i += 2;
        } else if (d === '$') {
          const n = home(i);
          if (!n) return null;
          buf += '$HOME';
          i += n;
        } else if (d === '`') {
          return null;
        } else {
          buf += d;
          i++;
        }
      }
    } else if (c === '\\') {
      const e = input[i + 1];
      if (e === undefined) return null;
      if (e !== '\n') {
        buf += e;
        inWord = quoted = true;
      }
      i += 2;
    } else if (c === '$') {
      const n = home(i);
      if (!n) return null;
      buf += '$HOME';
      inWord = true;
      i += n;
    } else if (c === '`' || c === '(' || c === ')' || c === '{' || c === '}' || c === '<') {
      return null;
    } else if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '\n') {
      if (!endCommand('\n')) return null;
      i++;
    } else if (c === ';') {
      if (!endCommand(';')) return null;
      i++;
    } else if (c === '|') {
      const next = input[i + 1];
      if (next === '&') return null;
      const op = next === '|' ? '||' : '|';
      if (!endCommand(op)) return null;
      i += op.length;
    } else if (c === '&') {
      const next = input[i + 1];
      if (next === '&') {
        if (!endCommand('&&')) return null;
        i += 2;
      } else if (next === '>') {
        if (input[i + 2] === '>' || input[i + 2] === '|' || input[i + 2] === '&') return null;
        endWord();
        const end = devNull(i + 2);
        if (end < 0) return null;
        i = end;
      } else {
        return null;
      }
    } else if (c === '>') {
      if (inWord && !quoted && /^\d+$/.test(buf) && buf !== '1' && buf !== '2') return null;
      const fd = inWord && !quoted && (buf === '1' || buf === '2') ? buf : '';
      if (fd) {
        buf = '';
        inWord = false;
      } else endWord();
      const next = input[i + 1];
      if (next === '>' || next === '|') return null;
      if (next === '&') {
        if (fd !== '2' || input[i + 2] !== '1' || !isBoundary(input[i + 3])) return null;
        i += 3;
      } else {
        const end = devNull(i + 1);
        if (end < 0) return null;
        i = end;
      }
    } else if ((c === '#' || c === '!') && !inWord) {
      return null;
    } else if (c < ' ' || c === '\x7f') {
      return null;
    } else {
      // ^, and # or ~ inside a word, are glob operators under zsh's extendedglob.
      if (c === '*' || c === '?' || c === '[' || c === '^' || (inWord && (c === '#' || c === '~'))) glob = true;
      buf += c;
      inWord = true;
      i++;
    }
  }
  endWord();
  if (words.length) commands.push(words);
  else if (needsNext) return null;
  return commands.length ? commands : null;
}

const isFlag = a => a.length > 1 && a.startsWith('-');
// A long option written short is still that option to getopt and to git, so `--out=f` is `--output`.
const abbreviates = (arg, names) => {
  const name = arg.split('=')[0];
  return name.startsWith('--') && name.length >= 3 && names.some(n => n.startsWith(name));
};
// A short-option cluster such as -ro that contains the letter.
const clusterHas = (arg, letter) => /^-[^-]/.test(arg) && arg.includes(letter);

// NOTE: [28 Oct 2026] EK - Keep git and cd off these lists. A git read runs programs a repo's own config names (core.fsmonitor, diff.external),
// and a folder holding a bare repo, such as one committed inside a pull request's branch, supplies that config. See docs/adr/20261023-a-session-for-each-group.md.
const GLOB_SAFE = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'pwd', 'echo', 'basename', 'dirname', 'realpath', 'readlink', 'stat', 'du', 'df', 'cut', 'tr', 'comm',
  'diff', 'cmp', 'nl', 'rev', 'column', 'whoami', 'id', 'uname', 'which', 'ps', 'true', 'false', 'strings', 'od', 'shasum', 'md5', 'jq', 'grep', 'egrep', 'fgrep']);

// NOTE: [28 Oct 2026] EK - Keep repo view off. gh reads its operand as HOST/OWNER/REPO and sends the request to that host, so a steered chat could send
// what it has read anywhere. github_status covers the status reads it was used for.
const GH_PAIRS = {
  pr: ['view', 'list', 'diff', 'checks', 'status'], issue: ['view', 'list', 'status'], run: ['view', 'list'],
  release: ['view', 'list'], workflow: ['view', 'list'], search: ['prs', 'issues', 'repos', 'commits', 'code'],
};
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const repoOk = v => REPO_NAME.test(v.replace(/^(https:\/\/)?github\.com\//, ''));
const hostOk = v => v === 'github.com';
const githubUrl = a => !a.includes('://') || a.startsWith('https://github.com/');
// A word gh could read as another host: HOST/OWNER/REPO with a dot in HOST, user@HOST: or user@HOST/, or an address off github.com. Checked on every gh word,
// values included, so no form gh parses can reach a host the other checks did not name.
function namesHost(word) {
  const a = /^-[^=]*=/.test(word) ? word.slice(word.indexOf('=') + 1) : word.replace(/^-+/, '');
  if (a.startsWith('https://github.com/') || a.startsWith('github.com/')) return false;
  return a.includes('://') || /^[^/]*\.[^/]*\/[^/]+\/./.test(a) || /@[\w-]+\.[\w.-]+[:/]/.test(word);
}

// The value of a flag written as `--name value`, `--name=value`, or for a short one `-Xvalue`, `-X=value`: [found, value or null when it is the next argument].
function valueOf(arg, long, short) {
  if (arg === long || (short && arg === short)) return [true, null];
  if (arg.startsWith(`${long}=`)) return [true, arg.slice(long.length + 1)];
  if (short && arg.startsWith(short) && !arg.startsWith('--')) return [true, arg.slice(short.length).replace(/^=/, '')];
  return [false, null];
}

function ghOk(args) {
  if (args[0] === 'api') return ghApiOk(args.slice(1));
  const [group, verb] = args;
  if (!GH_PAIRS[group]?.includes(verb)) return false;
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    // After -- gh reads a word that starts with a dash as an operand, which this check would take for a flag.
    if (a === '--' || namesHost(a) || !githubUrl(a) || clusterHas(a, 'w') || abbreviates(a, ['--web'])) return false;
    const [host, hostValue] = valueOf(a, '--hostname');
    if (host && !hostOk(hostValue ?? args[++i] ?? '')) return false;
    // -R may sit in a cluster of short flags, with its value after it or in the next argument.
    let given = null;
    if (a === '--repo' || a === '-R') given = args[++i] ?? '';
    else if (a.startsWith('--repo=')) given = a.slice('--repo='.length);
    else if (/^-[A-Za-z]/.test(a) && a.includes('R')) given = a.slice(a.indexOf('R') + 1).replace(/^=/, '') || (args[++i] ?? '');
    if (given !== null && !repoOk(given)) return false;
  }
  return true;
}

function ghApiOk(args) {
  let endpoint = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (namesHost(a) || !githubUrl(a)) return false;
    if (!isFlag(a)) {
      if (endpoint !== null || a.includes('://')) return false;
      endpoint = a;
      continue;
    }
    if (['--paginate', '--slurp', '-i', '--include', '--silent'].includes(a)) continue;
    const next = () => args[++i] ?? null;
    let hit;
    if ((hit = valueOf(a, '--jq', '-q'))[0] || (hit = valueOf(a, '--template', '-t'))[0] || (hit = valueOf(a, '--cache'))[0]) {
      if ((hit[1] ?? next()) === null) return false;
    } else if ((hit = valueOf(a, '--header', '-H'))[0]) {
      if (!/^accept:/i.test(hit[1] ?? next() ?? '')) return false;
    } else if ((hit = valueOf(a, '--method', '-X'))[0]) {
      if ((hit[1] ?? next())?.toUpperCase() !== 'GET') return false;
    } else if ((hit = valueOf(a, '--hostname'))[0]) {
      if (!hostOk(hit[1] ?? next() ?? '')) return false;
    } else return false;
  }
  if (endpoint === null) return false;
  return endpoint.replace(/^\/+/, '').toLowerCase().split(/[?/]/)[0] !== 'graphql';
}

const DATE_FLAGS = new Set(['-u', '-j', '-R', '--utc', '--universal', '--rfc-email', '--iso-8601', '--rfc-3339']);
const HOSTNAME_FLAGS = new Set(['-s', '-f', '-d', '-i', '-I', '-a', '-A', '-y', '--short', '--fqdn', '--long', '--domain', '--ip-address', '--all-ip-addresses']);

// Each command with checks gets its arguments (the words after its name) and says whether they only read.
const CHECKS = {
  // BSD uniq stops reading options at its first operand or at --, so every word after those is a file name, and a second one is written.
  uniq: args => {
    const first = args.findIndex(a => a === '--' || !isFlag(a));
    return first < 0 || args.length - first - (args[first] === '--' ? 1 : 0) <= 1;
  },
  date: args => args.every(a => a.startsWith('+') || DATE_FLAGS.has(a) || /^-I\w*$/.test(a) || /^--(iso-8601|rfc-3339)=\w+$/.test(a)),
  hostname: args => args.every(a => HOSTNAME_FLAGS.has(a)),
  file: args => !args.some(a => clusterHas(a, 'C') || abbreviates(a, ['--compile'])),
  sort: args => !args.some(a => clusterHas(a, 'o') || abbreviates(a, ['--output', '--compress-program'])),
  find: args => !args.some(a => ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(a)),
  // GNU sed reads options after the script too, so -i there is as bad as before it.
  sed(args) {
    let i = 0;
    let quiet = false;
    for (; i < args.length && isFlag(args[i]); i++) {
      if (!/^-[nEr]+$/.test(args[i])) return false;
      quiet ||= args[i].includes('n');
    }
    return quiet && /^(\d+|\$)(,(\d+|\$))?p$/.test(args[i] ?? '') && !args.slice(i + 1).some(isFlag);
  },
  gh: ghOk,
};

function simpleOk(words) {
  const [{ text: name }, ...rest] = words;
  if (name.includes('=')) return false;
  const known = GLOB_SAFE.has(name) || Object.hasOwn(CHECKS, name);
  if (!known) return false;
  if (!GLOB_SAFE.has(name) && rest.some(w => w.glob)) return false;
  // A command's checks run whenever it has them, even one that may also take a glob.
  return Object.hasOwn(CHECKS, name) ? CHECKS[name](rest.map(w => w.text)) : true;
}

export function readOnlyCommand(command) {
  if (typeof command !== 'string') return false;
  const commands = parse(command);
  return !!commands && commands.every(simpleOk);
}
