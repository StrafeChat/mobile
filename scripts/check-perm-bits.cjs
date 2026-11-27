#!/usr/bin/env node
/**
 * Permission masks past bit 30, in the app's own code. Run: npm run check:perm-bits
 *
 * JS's `&`, `|`, `^`, `~`, `<<`, `>>`, `>>>` are 32-bit signed operators: bit 31 comes out as
 * the sign and every bit from 32 up is dropped (`1 << 32` is 1, View Room) - so Manage
 * Webhooks (31) and Masquerade (32) would silently vanish from a role or an override the app
 * edits. Every operation on a mask goes through the web's lib/permBits (BigInt underneath),
 * reached as `@web/lib/permBits` or re-exported by `@web/lib/spacePermissions`.
 *
 * This is the web's scripts/check-perm-bits.mjs scanner (same blanking, same operand rules),
 * run over mobile's src/: no file may apply one of those operators to a permission - a `Perm*`
 * constant spacePermissions.ts exports, a `.permissions` / `.allow` / `.deny` /
 * `grantable_permissions` field, or (in a file that imports the permission modules) a local
 * mask (`bit`, `mask`, `cur`, `perms`...). Tests included: a fixture built with `|` would
 * silently lose the bits it means to test. The scanner tests itself first. permBits' own
 * maths is tested by the web's check (and by jest here, through the app's callers).
 *
 * Comments and string literals are blanked before the scan, so prose about `1 << 31` is fine.
 * CommonJS so jest can require it (src/features/settings/__tests__/permBits.test.ts).
 */
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const SPACE_PERMS = join(ROOT, 'web', 'src', 'lib', 'spacePermissions.ts');

// ---- static scan ---------------------------------------------------------------------------

/** Source with comments, strings, template text and regex literals replaced by spaces (line
 * structure kept, so reported line numbers stay right). Template `${…}` bodies are kept. */
function blank(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const tmplDepth = []; // brace depth at which each open template's ${ started
  let braces = 0;
  const keep = (c) => (c === '\n' ? '\n' : ' ');
  let prevSignificant = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += keep(src[i]); i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += ' '; i++; }
        out += keep(src[i] ?? ''); i++;
      }
      out += c; i++;
      prevSignificant = c;
      continue;
    }
    if (c === '`' || (c === '}' && tmplDepth.length && tmplDepth[tmplDepth.length - 1] === braces)) {
      if (c === '}') { tmplDepth.pop(); }
      out += c; i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { out += ' '; i++; out += keep(src[i] ?? ''); i++; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { out += '${'; i += 2; tmplDepth.push(braces); break; }
        out += keep(src[i]); i++;
      }
      if (src[i] === '`') { out += '`'; i++; }
      prevSignificant = '`';
      continue;
    }
    // A regex literal: `/` where an expression may start.
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^]|^$|return$/.test(prevSignificant)) {
      out += '/'; i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const r = src[i];
        if (r === '\\') { out += '  '; i += 2; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        out += ' '; i++;
      }
      if (src[i] === '/') { out += '/'; i++; }
      while (i < n && /[a-z]/i.test(src[i])) { out += src[i]; i++; }
      prevSignificant = '/x';
      continue;
    }
    if (c === '{') braces++;
    if (c === '}') braces--;
    out += c;
    if (!/\s/.test(c)) {
      // Track the previous token loosely: word chars collapse into the word.
      if (/[\w$]/.test(c)) {
        let j = out.length - 1;
        while (j > 0 && /[\w$]/.test(out[j - 1])) j--;
        prevSignificant = out.slice(j);
      } else prevSignificant = c;
    }
    i++;
  }
  return out;
}

/** Every Perm* / *PermMask constant the web's spacePermissions.ts exports. */
function permConstants() {
  return [...readFileSync(SPACE_PERMS, 'utf8').matchAll(/export const ((?:Perm[A-Z]\w*)|(?:\w*PermMask))\b/g)].map((m) => m[1]);
}
const permConsts = permConstants();
const PERMISH = new RegExp(
  [
    `\\b(?:${permConsts.join('|')})\\b`,
    String.raw`\.(?:permissions|allow|deny)\b`,
    String.raw`\bgrantable_permissions\b`,
    // the screens' mask state and locals
    String.raw`\b(?:permMask|allowMask|denyMask|genPerms|granted|grantable|roleAllow|roleDeny)\b`,
  ].join('|')
);

/** The operand right after index `i` (skipping unary `~`/`!`/spaces): a parenthesised group or
 * an identifier chain with an optional call. */
function operandAfter(s, i) {
  let j = i;
  while (j < s.length && /[\s~!]/.test(s[j])) j++;
  if (s[j] === '(') {
    let depth = 0;
    let k = j;
    for (; k < s.length; k++) {
      if (s[k] === '(') depth++;
      else if (s[k] === ')' && --depth === 0) break;
    }
    return s.slice(j, k + 1);
  }
  const m = /^[\w$.?]+(?:\(\))?/.exec(s.slice(j));
  return m ? m[0] : '';
}

/** The operand ending just before index `i`. */
function operandBefore(s, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (s[j] === ')') {
    // `x()` - a call: take the callee; `( … )` - a group: take it whole.
    if (s[j - 1] === '(') {
      let k = j - 2;
      while (k >= 0 && /[\w$.?]/.test(s[k])) k--;
      return s.slice(k + 1, j + 1);
    }
    let depth = 0;
    let k = j;
    for (; k >= 0; k--) {
      if (s[k] === ')') depth++;
      else if (s[k] === '(' && --depth === 0) break;
    }
    return s.slice(k, j + 1);
  }
  let k = j;
  while (k >= 0 && /[\w$.?]/.test(s[k])) k--;
  return s.slice(k + 1, j + 1);
}

// `a & b`, `a | b`, `a ^ b`, `a << b`, `a >> b`, `a >>> b`, compound forms, and unary `~a`.
// `&&`, `||`, `??`, `=>`, `>=`, `<=`, TS generics and JSX are not bitwise and are skipped.
const BINARY = /<<=?|>>>=?|>>=?|(?<![&|])[&|^]=?(?![&|])/g;

/** In a file that imports the permission modules, these generic local names are masks too
 * (`setAllowMask((prev) => prev | bit)`). */
const LOCAL_MASK = /\b(?:bit|bits|mask|prev|cur|perms|base)\b/;

/** Every bitwise operator applied to a permission in already-blanked source. */
function hits(s, permFile = false) {
  const out = [];
  const isPerm = (x) => PERMISH.test(x) || (permFile && LOCAL_MASK.test(x));
  for (const m of s.matchAll(BINARY)) {
    const left = operandBefore(s, m.index);
    const right = operandAfter(s, m.index + m[0].length);
    // TS union/intersection types (`A | B`) have type names as operands, which never match
    // PERMISH (the Perm* consts are values), so they need no special case.
    if (isPerm(left) || isPerm(right)) out.push({ at: m.index, text: `${left.trim()} ${m[0]} ${right.trim()}` });
  }
  for (const m of s.matchAll(/~/g)) {
    const right = operandAfter(s, m.index + 1);
    if (isPerm(right)) out.push({ at: m.index, text: `~${right.trim()}` });
  }
  return out;
}

/** The violations in one file's source: [{ line, text }]. */
function scanSource(raw) {
  const s = blank(raw);
  // A file that imports the permission modules: its generic local names are masks too.
  const permFile = /from '(?:@web|@web-original)\/lib\/(?:spacePermissions|permBits)'/.test(raw);
  const lineOf = (idx) => s.slice(0, idx).split('\n').length;
  return hits(s, permFile).map((h) => ({ line: lineOf(h.at), text: h.text }));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes(join('i18n', ''))) out.push(p);
  }
  return out;
}

/** Every violation under src/: ["path:line: ..."]. */
function scanTree(dir = SRC) {
  const out = [];
  for (const file of walk(dir)) {
    for (const h of scanSource(readFileSync(file, 'utf8'))) {
      out.push(`${relative(ROOT, file)}:${h.line}: bitwise operator on a permission (\`${h.text}\`) - use @web/lib/permBits`);
    }
  }
  return out;
}

/** The scanner must catch the classic mistakes and leave the rest alone. */
function selfTest() {
  const problems = [];
  const caught = [
    'const x = mask & PermManageWebhooks;',
    'const y = (role.permissions | PermViewChannel);',
    'p = (p & ~o.deny) | o.allow;',
    'const z = (existing?.allow ?? 0) & ~PermViewChannel;',
    'const w = 1 << 31 | PermSendMessages;',
    'base |= r.permissions;',
    'return requested & (grantable & PermAdministrator ? ~0 : grantable);',
  ];
  const caughtInPermFile = ['setPerms((cur) => (on ? cur | r.bit : cur & ~r.bit));'];
  const clean = [
    "const s = '1 << 31 & PermViewChannel';",
    '// mask & PermViewChannel',
    'const a = hasPerm(mask, PermViewChannel) && ok || other;',
    'type T = PermRow | undefined;',
    'const flags = space.automod_flags & 4;',
    'const re = /<@&(\\d+)>/g; const q = PermViewChannel;',
  ];
  for (const c of caught) if (hits(blank(c)).length === 0) problems.push(`missed \`${c}\``);
  for (const c of caughtInPermFile) if (hits(blank(c), true).length === 0) problems.push(`missed \`${c}\``);
  for (const c of clean) if (hits(blank(c)).length > 0) problems.push(`false positive on \`${c}\``);
  return problems;
}

module.exports = { blank, hits, scanSource, scanTree, selfTest, permConstants };

if (require.main === module) {
  const failures = [...selfTest().map((p) => `scanner self-test ${p}`), ...scanTree()];
  for (const f of failures) console.error(`FAIL ${f}`);
  if (failures.length) {
    console.error(`\n${failures.length} permission-bit check(s) failed`);
    process.exit(1);
  }
  console.log(`perm bits: ok (${permConsts.length} permission constants, src/ scanned)`);
}
