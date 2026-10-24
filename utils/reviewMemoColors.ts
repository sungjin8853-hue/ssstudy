import { isReviewSlash } from './reviewSlash';
import { isReviewGroupClose, isReviewGroupOpen, readReviewFieldOverride, reviewGroups } from './reviewFieldOverride';
import { isNoteShorthandOn, isRelationMark } from './noteShorthand';
import { isReviewSequenceSeparator } from './reviewMemoLogic';
import { matchingBracket } from './setExpression';
import { reviewQuoteMarks, reviewQuotes } from './reviewQuote';
import { readNoteTemplate } from './noteSets';
import { openTailOf } from './noteOpenTail';

/** 한 칸 안에서 값을 잇는 논리어: `,` 그리고(and) · `-` 다음(sequence) · `=` 같음(equal) */
export type MemoOperator = 'and' | 'sequence' | 'equal';

export interface MemoColorPart {
  text: string;
  colonIndex?: number;
  /** 한 칸 안의 논리어 글자(`,` `-` `=`) 하나. 종류는 알려 주지만 색은 다른 논리어와 같다. */
  operator?: MemoOperator;
  /** 논리어로 쓰인 글: 짝이 맞는 `[ ]` 한 덩어리(안쪽 `[ ]`·기호 포함), `( )`의 괄호 글자, `:{이름}`, 따옴표 글자, `@`, 틀의 `#`. 논리어 색을 받는다. */
  logic?: boolean;
}

/** `base`: 이 글이 시작하는 칸 번호. 끝이 열린 토글 제목(`자동차 :`) 아래 줄은 제목의 칸 수만큼 뒤에서 시작하므로 `:` 색도 그 번호부터 센다(문제 만들기와 같은 번호). */
export const splitReviewMemoColonColors = (text: string, inherited: ReadonlyMap<number, string> = new Map(), base = 0): MemoColorPart[] => {
  const parts: MemoColorPart[] = [];
  let start = 0;
  let colonIndex = base;
  let fieldIndex = base;
  const scopes: Array<{ colonIndex: number; fieldIndex: number }> = [];
  const quoted = reviewQuoteMarks(text);
  // 맨 끝이 연결어로 덜 끝난 줄(`자동차 :`) 바로 밑 줄은 그 줄 칸 수만큼 뒤에서 시작한다(토글 제목 아래 줄과 같은 번호).
  let lineBase = base;
  let lineStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (isReviewGroupOpen(text[index])) { scopes.push({ colonIndex, fieldIndex }); colonIndex = 0; fieldIndex = 0; }
    if (isReviewGroupClose(text[index])) {
      const parent = scopes.pop();
      if (parent) { colonIndex = parent.colonIndex; fieldIndex = parent.fieldIndex; }
    }
    if (text[index] === '\n' || isReviewSlash(text, index)) {
      if (text[index] === '\n') {
        lineBase = openTailOf(text.slice(lineStart, index))?.connector ? fieldIndex : base;
        lineStart = index + 1;
      }
      colonIndex = lineBase; fieldIndex = lineBase; scopes.length = 0;
    }
    // 따옴표 `'…'` 안의 `:` `;` `<`는 칸을 나누지 않으므로 칸 색(`:` 번호)을 받지 않는다(아래 논리어 색을 받는다).
    if (!isRelationMark(text[index]) || quoted.has(index)) continue;
    // `=`는 칸을 나누지 않는 한 칸 안의 논리어라서 자리 색을 받지 않는다(여기서는 `:` `;` `<`만 칸을 나눈다).
    const override = readReviewFieldOverride(text, index + 1);
    fieldIndex += 1;
    if (override || inherited.has(fieldIndex)) {
      if (override) index = override.end - 1;
      continue;
    }
    if (index > start) parts.push({ text: text.slice(start, index) });
    parts.push({ text: text[index], colonIndex: colonIndex++ });
    start = index + 1;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
};

export const getReviewMemoColonColor = (index: number, dark: boolean) => {
  const colors = dark
    ? ['#fb7185', '#fbbf24', '#cbd5e1', '#a1a1aa', '#94a3b8']
    : ['#dc2626', '#a16207', '#475569', '#71717a', '#64748b'];
  return colors[Math.min(index, colors.length - 1)];
};

/**
 * `#` 틀 줄(`[A] #'-'#: #+#`)의 따옴표 안 글자 위치: 틀 안의 따옴표는 안의 글을 그대로 글자로 쓰므로(`-`도 `#`도) 논리어가 아니다.
 * 따옴표 글자 위치(quotes)와 그 사이 글자(literal)를 돌려준다. 틀이 아닌 줄에는 없다.
 */
const frameQuotes = (text: string) => {
  const quotes: number[] = [];
  const literal = new Set<number>();
  const hashes: number[] = [];
  if (!text.includes('#')) return { quotes, literal, hashes };
  let lineStart = 0;
  text.split('\n').forEach(line => {
    if (line.includes('#') && readNoteTemplate(line.trim())) {
      for (let at = 0; at < line.length; at += 1) {
        if (line[at] === "'") {
          const close = line.indexOf("'", at + 1);
          if (close > at + 1) {
            quotes.push(lineStart + at, lineStart + close);
            for (let inner = at + 1; inner < close; inner += 1) literal.add(lineStart + inner);
            at = close;
            continue;
          }
        }
        if (line[at] === '#') hashes.push(lineStart + at);
      }
    }
    lineStart += line.length + 1;
  });
  return { quotes, literal, hashes };
};

/**
 * 색 조각들 위에 논리어를 덧입힌다. 논리어는 `:` `;` `<`(칸을 나누는 관계 기호, 자리 색)를 뺀 모두이고 같은 색 하나를 받는다:
 *  - 짝이 맞는 `[ ]`(겹친 것은 가장 바깥 하나)는 안쪽 글·기호까지 논리어다.
 *  - 짝이 맞는 `( )`는 괄호 글자만 논리어다(안쪽 글은 그대로).
 *  - `:{이름}`의 `{이름}`(중괄호 포함), 따옴표 `'…'`의 따옴표 글자, 앞 칸을 가리키는 `@`, `#` 틀의 `#`(틀 안의 따옴표 글자 포함).
 * 조각은 글을 더하거나 빼지 않고 논리어 경계에서만 더 잘게 나뉜다(이어 붙이면 원문과 같다). 아직 닫지 않은 `[` `(`는 논리어가 아니다.
 * `:` 조각의 colonIndex는 그대로 두고 logic만 켠다. 논리어가 하나도 없으면 받은 조각을 그대로 돌려준다.
 */
export const markReviewMemoLogicWords = (text: string, parts: MemoColorPart[]): MemoColorPart[] => {
  if (!/[\[(@#'{]/.test(text)) return parts;
  const inside = new Uint8Array(text.length);
  let any = false;
  const mark = (from: number, to: number) => { inside.fill(1, from, to); any = true; };
  if (text.includes('[')) {
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '[') continue;
      const end = matchingBracket(text, index);
      if (end < 0) continue;
      mark(index, end + 1);
      index = end;
    }
  }
  if (text.includes('(')) reviewGroups(text).closed.forEach((close, open) => { if (text[open] === '(') { mark(open, open + 1); mark(close, close + 1); } });
  if (text.includes('{')) {
    const { marks } = reviewQuotes(text);
    for (let index = 0; index < text.length; index += 1) {
      if (!isRelationMark(text[index]) || marks.has(index)) continue;
      const override = readReviewFieldOverride(text, index + 1);
      if (override) { mark(override.start, override.end); index = override.end - 1; }
    }
  }
  if (text.includes("'")) reviewQuotes(text).edges.forEach(at => mark(at, at + 1));
  if (text.includes('@')) {
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '@' && !(index > 0 && /[\p{L}\p{N}_]/u.test(text[index - 1]))) mark(index, index + 1);
    }
  }
  if (text.includes('#')) {
    const frame = frameQuotes(text);
    frame.quotes.forEach(at => mark(at, at + 1));
    frame.hashes.forEach(at => mark(at, at + 1));
  }
  if (!any) return parts;
  const result: MemoColorPart[] = [];
  let offset = 0;
  parts.forEach(part => {
    let runStart = 0;
    for (let at = 1; at <= part.text.length; at += 1) {
      if (at < part.text.length && inside[offset + at] === inside[offset + runStart]) continue;
      const piece = part.text.slice(runStart, at);
      result.push(inside[offset + runStart] ? { ...part, text: piece, logic: true } : { ...part, text: piece });
      runStart = at;
    }
    offset += part.text.length;
  });
  return result;
};

/** 논리어 색 하나: 기호 막대의 `, = - ( )`와 같은 청록. `:` `;` `<`는 칸 자리 색이라 따로 둔다. */
export const getReviewMemoLogicColor = (dark: boolean) => (dark ? '#5eead4' : '#0f766e');

/**
 * 논리어 색: 한 칸 안에서 값을 잇는 `,`(그리고) · `-`(다음) · `=`(같음) 글자를 종류를 단 조각으로 나눈다(색은 모두 같다). 글은 더하거나 빼지 않는다.
 * 문제를 만들 때 실제로 논리어로 읽히는 것만 칠한다: `-`는 이음표로 읽히는 자리(양쪽에 글이 없는 `-`·음수 `-5`·지수 `1e-5` 제외), `=`와 `-`는 단축어가 켜진 때만,
 * `:{이름}`의 이름 안쪽과 `[ ]` 덩어리(이미 논리어 색) 안쪽은 칠하지 않는다. 관계 기호 `:` `;` `<`의 칸 색은 그대로다.
 */
export const markReviewMemoOperators = (text: string, parts: MemoColorPart[]): MemoColorPart[] => {
  const quoted = reviewQuoteMarks(text);
  if (!/[,\-=]/.test(text) && !quoted.size) return parts;
  // 따옴표 안의 `,` `-` `=`와 `#` 틀의 따옴표 안 글자는 논리어가 아니라 글자다
  const literal = new Set<number>([...reviewQuotes(text).literal, ...frameQuotes(text).literal]);
  const kinds = new Map<number, MemoOperator>();
  let lineStart = 0;
  let lineEnd = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n');
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lineStart = index + 1;
      lineEnd = text.indexOf('\n', lineStart) < 0 ? text.length : text.indexOf('\n', lineStart);
      continue;
    }
    const character = text[index];
    const role = quoted.get(index);
    if (role) {
      // 따옴표 안의 `:`는 `=`처럼(같음), `;`와 `<`는 `-`처럼(순서) 한 칸 안의 논리어다. 단축어가 켜진 때만 읽힌다.
      if (isNoteShorthandOn()) kinds.set(index, role === 'equal' ? 'equal' : 'sequence');
    } else if (isRelationMark(character)) {
      const override = readReviewFieldOverride(text, index + 1);
      if (override) index = override.end - 1;
    } else if (literal.has(index)) continue;
    else if (character === ',') kinds.set(index, 'and');
    else if (character === '-' && isReviewSequenceSeparator(text, index, lineStart, lineEnd)) kinds.set(index, 'sequence');
    else if (character === '=' && isNoteShorthandOn()) kinds.set(index, 'equal');
  }
  if (!kinds.size) return parts;
  const result: MemoColorPart[] = [];
  let offset = 0;
  parts.forEach(part => {
    if (part.logic || part.colonIndex !== undefined) { result.push(part); offset += part.text.length; return; }
    let runStart = 0;
    for (let at = 0; at < part.text.length; at += 1) {
      const kind = kinds.get(offset + at);
      if (!kind) continue;
      if (at > runStart) result.push({ ...part, text: part.text.slice(runStart, at) });
      result.push({ ...part, text: part.text[at], operator: kind });
      runStart = at + 1;
    }
    if (runStart < part.text.length) result.push({ ...part, text: part.text.slice(runStart) });
    offset += part.text.length;
  });
  return result;
};

/** 한 칸 안의 논리어(`,` `-` `=`)도 다른 논리어와 같은 색이다. 종류(and·sequence·equal)는 글 조각에만 남아 있다. */
export const getReviewMemoOperatorColor = (_operator: MemoOperator, dark: boolean) => getReviewMemoLogicColor(dark);
