import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { readReviewFieldOverride } from './reviewFieldOverride';

/**
 * 17일 "`{}` 틀": `{[C] A-B-C}야 ; {C} 안녕`은 `A야 ; A 안녕`, `B야 ; B 안녕`, `C야 ; C 안녕` 세 줄로 쓴 것과 같다.
 * `[ ]`가 값을 정의하듯 `{ }`도 정의다: A-B-C에 대한 문제(순서)를 만들지 않고, 그 줄을 틀로 써서 값마다 한 줄씩 문제를 만든다.
 *  - 틀 칸: `{ }` 안에 `-` `=` `,`로 나눈 값들(쓴 순서대로), 또는 `{[이름] 값들}`(그 이름으로 같은 줄의 `{이름}`이 같은 차례 값을 받는다).
 *    `{ }` 안의 `-` `=` `,` `[이름]`은 문제를 만드는 틀이지 실제 논리가 아니다(순서 · 같음 · 그리고 문제나 집합을 만들지 않는다).
 *  - 같은 줄의 `{이름}`: 그 줄에서 정의한 이름이면 같은 차례의 값, 아니면 노트의 집합(그 이름 밑의 항목)을 차례로 가져온다.
 *    가져올 것이 없으면 가져오지 않는다(전처럼 그 글 그대로).
 *  - 한 줄에 틀 칸이 여럿이면 같은 차례끼리 짝짓는다: `{A-B-C}야 ; {D-S-f} 가져가` → `A야 ; D 가져가`, `B야 ; S 가져가`, `C야 ; f 가져가`.
 *    값 수가 다르면 짧은 쪽까지만 만든다. 빈 자리(`{A-B--N}`의 `--`)는 바로 앞 값을 다시 쓴 것이다: A, B, B, N.
 *  - 틀 칸이 없는 줄의 `{X}`(키워드 · 칸 이름표)는 전과 같다. 토글 제목 줄은 펼치지 않는다.
 *  - `{ }` 안의 `( )`는 값 하나다: 가장 바깥 `-` `=` `,`로만 나누고, 괄호 안에는 연결어(`:` `;` `<`) · `//` · `[ ]` 등 무엇이든 쓸 수 있다.
 */

interface Brace { start: number; end: number; inner: string; label: boolean }

const bracesOf = (line: string): Brace[] => {
  const out: Brace[] = [];
  let quote = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'") { quote = !quote; continue; }
    if (quote || character !== '{') continue;
    const close = line.indexOf('}', index + 1);
    if (close < 0) break;
    const inner = line.slice(index + 1, close);
    if (inner.includes('{')) continue;
    // 연결어 바로 뒤의 칸 이름표 자리(`a:{원인} b`)는 틀 칸(값 목록)이 아니다. 같은 줄에서 정의한 이름이나 노트의 집합이면 그 값을 받고,
    // 아니면 전처럼 이름표다(`{[C] A-B-C}야 ; {C} 안녕`의 `{C}`는 C를 받는다)
    let before = index - 1;
    while (before >= 0 && /[^\S\r\n]/.test(line[before])) before -= 1;
    const label = before >= 0 && /[:;<]/.test(line[before]) && readReviewFieldOverride(line, before + 1, line.length, false)?.start === index;
    out.push({ start: index, end: close + 1, inner, label: Boolean(label) });
    index = close;
  }
  return out;
};

/** 괄호 · 대괄호 · 따옴표 밖(맨 바깥)에서 pick이 참인 자리들 */
const topCuts = (text: string, pick: (character: string, index: number) => boolean): number[] => {
  const cuts: number[] = [];
  let depth = 0;
  let quote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "'") { quote = !quote; continue; }
    if (quote) continue;
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') depth = Math.max(0, depth - 1);
    else if (!depth && pick(character, index)) cuts.push(index);
  }
  return cuts;
};

/** `{ }` 안을 `-` `=` `,`로 나눈 글과 그 사이에 쓴 연결 기호(다시 조립할 때 쓴다) */
const splitParts = (text: string): { items: string[]; marks: string[] } => {
  const cuts = topCuts(text, character => /[-=,]/.test(character));
  const items: string[] = [];
  const marks: string[] = [];
  let from = 0;
  cuts.forEach(at => { items.push(text.slice(from, at)); marks.push(text[at]); from = at + 1; });
  items.push(text.slice(from));
  return { items, marks };
};

/** 19일 "{}중첩들을 대응 시킬때, 중첩 횟수가 같은 것에서 대응시킴": 가장 안쪽의 중첩 `{ }`부터 푼다(중첩이 더 깊어도 한 겹씩) */
const nestedBraceOf = (line: string): { start: number; end: number; inner: string } | null => {
  const outer = outerNestedBraceOf(line);
  if (!outer) return null;
  const inside = nestedBraceOf(outer.inner);
  return inside ? { start: outer.start + 1 + inside.start, end: outer.start + 1 + inside.end, inner: inside.inner } : outer;
};

/** 맨 바깥의 중첩 `{ }`(안에 또 `{ }`가 있는 것) */
const outerNestedBraceOf = (line: string): { start: number; end: number; inner: string } | null => {
  let quote = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'") { quote = !quote; continue; }
    if (quote || character !== '{') continue;
    let depth = 0;
    for (let at = index; at < line.length; at += 1) {
      if (line[at] === '{') depth += 1;
      else if (line[at] === '}') {
        depth -= 1;
        if (!depth) {
          const inner = line.slice(index + 1, at);
          if (inner.includes('{')) return { start: index, end: at + 1, inner };
          index = at;
          break;
        }
      }
    }
    if (depth) break;
  }
  return null;
};

/**
 * 19일 "{{a-b}-{n-f}};{h-i}처럼도 가능하며 {a-n} {b-f}가 되며 한번 더 작동하여": 중첩 `{ }`를 한 겹 푼다.
 * 안쪽 틀들의 같은 차례끼리 짝지어 한 겹 안쪽 틀로 만든다 — `{{a-b}-{n-f}}` → `{a-n}`, `{b-f}`.
 * 그렇게 나온 줄들이 다시 한 번 펼쳐져 같은 중첩 횟수의 `{h-i}`와 짝지어진다(`a;h` `n;i` · `b;h` `f;i`).
 */
const unnestLine = (line: string): string[] | null => {
  const nested = nestedBraceOf(line);
  if (!nested) return null;
  const { items, marks } = splitParts(nested.inner);
  const lists = items.map(item => {
    const brace = /^\s*\{([^{}]*)\}\s*$/.exec(item);
    return brace ? splitItems(brace[1]) : null;
  });
  const counts = lists.filter((list): list is string[] => list !== null).map(list => list.length);
  if (!counts.length) return null;
  const count = Math.min(...counts);
  if (!(count > 0)) return null;
  return Array.from({ length: count }, (_, at) => {
    const inner = items.map((item, index) => (lists[index] ? lists[index]![at] : item.trim()))
      .reduce((text, item, index) => (index ? `${text}${marks[index - 1]}${item}` : item), '');
    return `${line.slice(0, nested.start)}{${inner}}${line.slice(nested.end)}`;
  });
};

/** `{ }` 안을 `-` `=` `,`(괄호 · 따옴표 밖)로 나눈 값들 */
const splitItems = (text: string): string[] => {
  const items: string[] = [];
  let depth = 0;
  let quote = false;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "'") quote = !quote;
    if (quote) continue;
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[-=,]/.test(character)) { items.push(text.slice(from, index)); from = index + 1; }
  }
  items.push(text.slice(from));
  // 17일: 빈 자리(`A-B--N`의 `--`)는 바로 앞 값을 한 번 더 쓴 것이다(생략) → A, B, B, N. 맨 앞 빈 자리는 버린다
  const filled: string[] = [];
  items.map(item => item.trim()).forEach(item => {
    if (item) filled.push(item);
    else if (filled.length) filled.push(filled[filled.length - 1]);
  });
  // 맨 끝의 빈 자리(`{A-B-}`처럼 쓰는 중)는 값으로 치지 않는다
  if (items.length && !items[items.length - 1].trim() && filled.length) filled.pop();
  return filled;
};

/** 괄호 `( )` · 따옴표 안을 뺀 글(그 안의 연결어 · 논리어는 값의 일부라 이름표인지 가를 때 보지 않는다) */
const outsideGroups = (text: string): string => {
  let out = '';
  let depth = 0;
  let quote = false;
  for (const character of text) {
    if (character === "'") { quote = !quote; continue; }
    if (quote) continue;
    if (character === '(') { depth += 1; continue; }
    if (character === ')') { depth = Math.max(0, depth - 1); continue; }
    if (!depth) out += character;
  }
  return out;
};

type Alias = { at: number; text: string };
type Part = { kind: 'list'; items: string[]; name?: string; aliases?: Alias[] } | { kind: 'ref'; name: string; label?: boolean } | { kind: 'keep' };

/**
 * 19일 "=는 모든 차례와 짝짓는 거야 ==처럼 두번 쓴거는 뒤에 같은거라는 거, 왼쪽의 것이 오른쪽의 것과 같다":
 * `=`로 이어 쓴 쪽들은 서로 같은 것이라, 한 칸짜리 쪽이 있는 차례에는 다른 쪽들도 (그 쪽 전체로) 올 수 있다.
 *  - `{a,b=c};{q-w-e}` → `a;q` `b;w` `c;e`(차례대로) + `a,b;e`(한 칸짜리 쪽 `c`의 차례에 왼쪽 쪽 전체가 온다).
 *    `c`는 여러 칸으로 된 쪽(`a,b`)의 차례에는 오지 않는다 — 한 칸에 들어갈 자리가 아니다.
 *  - `{(a,b)==c}`는 `(a,b)=(a,b)=c`다(`==`의 빈 자리는 바로 앞 쪽을 다시 쓴 것). 세 쪽이 다 한 칸이라 서로의 차례에 모두 와서
 *    `(a,b);q` `(a,b);w` `(a,b);e` `c;q` `c;w` `c;e`가 된다. `a===v`면 `a=a=a=v`다.
 *  - `( )` 안은 `{ }`의 틀 논리가 닿지 않는 그 안의 실제 논리다(`(a,b)`는 한 칸이고, 그 안의 `,`는 "그리고").
 */
const readSides = (inner: string): { items: string[]; aliases?: Alias[] } => {
  const { items: written, marks } = splitParts(inner);
  const items: string[] = [];
  const origin: number[] = [];
  written.map(item => item.trim()).forEach((item, index) => {
    if (item) { items.push(item); origin.push(index); }
    else if (items.length) { items.push(items[items.length - 1]); origin.push(index); }
  });
  // 맨 끝의 빈 자리(`{A-B-}`처럼 쓰는 중)는 값으로 치지 않는다
  if (written.length && !written[written.length - 1].trim() && items.length) { items.pop(); origin.pop(); }
  if (items.length < 2) return { items };
  const sides: { text: string; from: number; count: number }[] = [];
  items.forEach((item, at) => {
    const mark = origin[at] > 0 ? marks[origin[at] - 1] : null;
    if (!sides.length || mark === '=') sides.push({ text: item, from: at, count: 1 });
    else {
      const side = sides[sides.length - 1];
      side.text += `${mark}${item}`;
      side.count += 1;
    }
  });
  if (sides.length < 2) return { items };
  const aliases = sides.flatMap(side => sides.filter(other => other !== side && other.count === 1).map(other => ({ at: other.from, text: side.text })));
  return { items, aliases };
};

/**
 * label: 연결어 바로 뒤 이름표 자리. 그 자리는 같은 줄이 틀 줄일 때만 값 목록(`;{D-S-f-h} 가져가`)으로 읽고, 이름표처럼 쓴 글
 * (`:` `;` `<` `/`나 중간의 `[ ]`가 든 것)은 이름표 그대로다. 이름 하나면 같은 줄에서 정의한 이름일 때만 그 값을 받는다.
 */
const readBrace = (inner: string, label = false, templateLine = false): Part => {
  if (label) {
    const name = (/^\s*\[([^\]]+)\]\s*$/.exec(inner)?.[1] ?? inner).trim();
    // 17일 "( ) 안 연결어나 다른 것들도 들어갈 수 있게": 괄호 · 따옴표 안의 `:` `;` `<` `//` `[ ]`는 값의 일부다
    const bare = outsideGroups(inner);
    if (!name || /[:;<\/]/.test(bare) || /.\[/.test(bare.trim())) return { kind: 'keep' };
    if (!/[-=,]/.test(outsideGroups(name))) return { kind: 'ref', name, label: true };
    if (!templateLine) return { kind: 'keep' };
  }
  const named = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(inner);
  if (named && named[2].trim()) return { kind: 'list', ...readSides(named[2]), name: named[1].trim() };
  const { items, aliases } = readSides(inner);
  if (items.length > 1) return { kind: 'list', items, aliases };
  const name = (named ? named[1] : inner).trim();
  return name ? { kind: 'ref', name } : { kind: 'keep' };
};

const norm = (text: string) => text.replace(/\s+/g, '');

/** 이 줄이 틀 줄인가(틀 칸이 하나라도 있다) */
export const isTemplateLine = (line: string): boolean => line.includes('{') && (nestedBraceOf(line) !== null
  ? (unnestLine(line) ?? []).some(piece => isTemplateLine(piece))
  : bracesOf(line).some(brace => (!brace.label
  ? readBrace(brace.inner).kind === 'list'
  // 이름표 자리라도 `[이름]`을 붙였거나 `( )` 값이 든 목록이면 틀 칸이다(`Z : {(가:나)-다} 안녕`)
  : readBrace(brace.inner, true, true).kind === 'list' && (/^\s*\[[^\]]+\]/.test(brace.inner) || brace.inner.includes('(')))));

/**
 * 틀 줄을 값마다 한 줄로 푼다. resolve(이름)는 노트의 집합 밑 항목(없으면 빈 목록).
 * 17일 "문제를 만드는 로직이지 실제 논리가 아니야": `{ }` 안의 `-` `=` `,`와 `[C]`는 문제를 만드는 틀일 뿐 노트의 실제 논리(순서 · 같음 · 그리고 · 집합)가 아니다.
 * 그래서 `{[C] A-B-C}`는 집합 C를 만들지 않고(집합 색인에 넣지 않는다), A-B-C 순서 문제도 없다. defineSets는 쓰지 않는다(남겨 둔 옵션).
 * 틀 줄이 없으면 그대로 돌려준다.
 */
export const expandBraceTemplates = (memo: string, resolve?: (name: string) => string[], defineSets = false): string => {
  if (!memo.includes('{')) return memo;
  const lines = memo.split('\n');
  if (!lines.some(line => !line.startsWith(REVIEW_MEMO_TOGGLE_START) && line !== REVIEW_MEMO_TOGGLE_END && isTemplateLine(line))) return memo;
  return lines.flatMap(line => {
    if (line.startsWith(REVIEW_MEMO_TOGGLE_START) || line === REVIEW_MEMO_TOGGLE_END || !isTemplateLine(line)) return [line];
    // 중첩 `{ }`는 한 겹씩 풀어 같은 중첩 횟수끼리 짝지은 뒤, 그 줄들을 다시 펼친다
    const unnested = unnestLine(line);
    if (unnested) return unnested.flatMap(piece => expandBraceTemplates(piece, resolve, defineSets).split('\n'));
    const braces = bracesOf(line);
    const parts = braces.map(brace => readBrace(brace.inner, brace.label, true));
    const defined = new Map<string, string[]>();
    parts.forEach(part => { if (part.kind === 'list' && part.name) defined.set(norm(part.name), part.items); });
    const lists: (string[] | null)[] = parts.map(part => {
      if (part.kind === 'list') return part.items;
      if (part.kind === 'ref') {
        const own = defined.get(norm(part.name));
        if (own) return own;
        if (part.label) return null;
        const members = resolve?.(part.name) ?? [];
        return members.length ? members : null;
      }
      return null;
    });
    const lengths = lists.filter((list): list is string[] => list !== null).map(list => list.length);
    const count = Math.min(...lengths);
    if (!(count > 0)) return [line];
    const definitions = defineSets ? parts.flatMap(part => (part.kind === 'list' && part.name ? part.items.map(item => `[${part.name}] ${item}`) : [])) : [];
    const write = (at: number, pick?: { index: number; text: string }) => {
      let out = '';
      let from = 0;
      braces.forEach((brace, index) => {
        const list = lists[index];
        const chosen = pick && pick.index === index ? pick.text : list ? list[at] : undefined;
        out += line.slice(from, brace.start) + (chosen ?? line.slice(brace.start, brace.end));
        from = brace.end;
      });
      return out + line.slice(from);
    };
    const rows = Array.from({ length: count }, (_, at) => write(at));
    // `=`로 이어 쓴 쪽은 한 칸짜리 쪽이 있는 차례에도 (그 쪽 전체로) 온다
    const extra = parts.flatMap((part, index) => (part.kind === 'list' && part.aliases
      ? part.aliases.filter(alias => alias.at < count).map(alias => write(alias.at, { index, text: alias.text }))
      : []));
    return [...new Set([...definitions, ...rows, ...extra])];
  }).join('\n');
};
