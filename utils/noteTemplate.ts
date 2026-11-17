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

type Part = { kind: 'list'; items: string[]; name?: string } | { kind: 'ref'; name: string; label?: boolean } | { kind: 'keep' };

/**
 * label: 연결어 바로 뒤 이름표 자리. 그 자리는 같은 줄이 틀 줄일 때만 값 목록(`;{D-S-f-h} 가져가`)으로 읽고, 이름표처럼 쓴 글
 * (`:` `;` `<` `/`나 중간의 `[ ]`가 든 것)은 이름표 그대로다. 이름 하나면 같은 줄에서 정의한 이름일 때만 그 값을 받는다.
 */
const readBrace = (inner: string, label = false, templateLine = false): Part => {
  if (label) {
    const name = (/^\s*\[([^\]]+)\]\s*$/.exec(inner)?.[1] ?? inner).trim();
    if (!name || /[:;<\/]/.test(inner) || /.\[/.test(inner.trim())) return { kind: 'keep' };
    if (!/[-=,]/.test(name)) return { kind: 'ref', name, label: true };
    if (!templateLine) return { kind: 'keep' };
  }
  const named = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(inner);
  if (named && named[2].trim()) return { kind: 'list', items: splitItems(named[2]), name: named[1].trim() };
  const items = splitItems(inner);
  if (items.length > 1) return { kind: 'list', items };
  const name = (named ? named[1] : inner).trim();
  return name ? { kind: 'ref', name } : { kind: 'keep' };
};

const norm = (text: string) => text.replace(/\s+/g, '');

/** 이 줄이 틀 줄인가(틀 칸이 하나라도 있다) */
export const isTemplateLine = (line: string) => line.includes('{') && bracesOf(line).some(brace => !brace.label && readBrace(brace.inner).kind === 'list');

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
    return [...definitions, ...Array.from({ length: count }, (_, at) => {
      let out = '';
      let from = 0;
      braces.forEach((brace, index) => {
        const list = lists[index];
        out += line.slice(from, brace.start) + (list ? list[at] : line.slice(brace.start, brace.end));
        from = brace.end;
      });
      return out + line.slice(from);
    })];
  }).join('\n');
};
