import { isReviewSlash } from './reviewSlash';
import { isRelationMark } from './noteShorthand';
import { reviewQuoteMarks } from './reviewQuote';
export interface ReviewFieldOverride {
  label: string;
  start: number;
  end: number;
}

// Only a complete, same-line brace label immediately after a relation separator is metadata.
export const readReviewFieldOverride = (text: string, from: number, to = text.length): ReviewFieldOverride | undefined => {
  // 따옴표 `'…'` 안의 `:` `;` `<`는 칸을 나누는 기호가 아니라서 뒤의 `{이름}`도 이름표가 아니다.
  if (from > 0 && reviewQuoteMarks(text).has(from - 1)) return undefined;
  let start = from;
  while (start < to && /[^\S\r\n]/.test(text[start])) start += 1;
  if (text[start] !== '{') return undefined;
  let depth = 0;
  for (let index = start; index < to; index += 1) {
    if (text[index] === '\r' || text[index] === '\n') return undefined;
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return { label: text.slice(start + 1, index).trim(), start, end: index + 1 };
    }
  }
  return undefined;
};

export const stripReviewFieldOverrides = (text: string): string => {
  let result = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== ':' && text[index] !== ';' && text[index] !== '<') continue;
    const override = readReviewFieldOverride(text, index + 1);
    if (!override) continue;
    result += text.slice(start, override.start);
    start = override.end;
    index = override.end - 1;
  }
  return result + text.slice(start);
};

/**
 * 묶음 괄호는 `( )`다. `[ ]`는 분류 기준이라서 새로 쓰는 묶음에는 쓰지 않지만,
 * 예전에 `[ ]`로 묶어 쓴 노트가 깨지지 않게 계속 묶음으로 읽는다(제목의 분류 기준 `[개념:정의]`는 따로 가려낸다).
 */
export const isReviewGroupOpen = (character: string | undefined): boolean => character === '(' || character === '[';
export const isReviewGroupClose = (character: string | undefined): boolean => character === ')' || character === ']';

export interface ReviewGroups {
  /** 짝이 맞는 묶음: 여는 위치 → 닫는 위치 */
  closed: ReadonlyMap<number, number>;
  /** 건너뛸 곳: 여는 위치 → 묶음이 끝나는 위치. 닫지 않은 괄호는 그 줄 끝까지 묶음으로 본다(쓰던 중에 흔들리지 않게). */
  skip: ReadonlyMap<number, number>;
}

let cachedGroupText: string | undefined;
let cachedGroups: ReviewGroups = { closed: new Map(), skip: new Map() };

/**
 * 묶음 괄호를 짝지어 읽는다. `(`는 `)`와, `[`는 `]`와만 짝이 되고, 줄이 바뀌면 열려 있던 것은 닫히지 않은 채로 남는다.
 */
export const reviewGroups = (text: string): ReviewGroups => {
  if (cachedGroupText === text) return cachedGroups;
  const closed = new Map<number, number>();
  const skip = new Map<number, number>();
  let stack: number[] = [];
  const endLine = (at: number) => {
    const lineEnd = text.indexOf('\n', at);
    stack.forEach(open => skip.set(open, (lineEnd < 0 ? text.length : lineEnd) - 1));
    stack = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const override = character === ':' || character === ';' || character === '<' ? readReviewFieldOverride(text, index + 1) : undefined;
    if (override) { index = override.end - 1; continue; }
    if (character === '\n') endLine(index);
    else if (isReviewGroupOpen(character)) stack.push(index);
    else if (isReviewGroupClose(character)) {
      const open = character === ')' ? '(' : '[';
      const at = stack.map(position => text[position]).lastIndexOf(open);
      if (at >= 0) { closed.set(stack[at], index); skip.set(stack[at], index); stack.length = at; }
    }
  }
  endLine(text.length);
  cachedGroupText = text;
  cachedGroups = { closed, skip };
  return cachedGroups;
};

/** `base`: 이 글이 시작하는 칸 번호(`> 제목 :` 아래 줄은 제목 칸 수만큼 뒤에서 시작한다). 덮어쓴 이름은 처음부터 센 칸 번호로 담는다. */
export const getReviewFieldOverrides = (text: string, inherited: ReadonlyMap<number, string> = new Map(), base = 0): ReadonlyMap<number, string> => {
  const result = new Map(inherited);
  const quoted = reviewQuoteMarks(text);
  let depth = 0;
  let field = base;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted.has(index)) continue;
    if (isRelationMark(character)) {
      const override = readReviewFieldOverride(text, index + 1);
      if (depth === 0) {
        field += 1;
        if (override) result.set(field, override.label);
      }
      if (override) index = override.end - 1;
    } else if (character === '\n') { depth = 0; field = base; }
    else if (isReviewSlash(text, index) && depth === 0) field = base;
    else if (isReviewGroupOpen(character)) depth += 1;
    else if (isReviewGroupClose(character)) depth = Math.max(0, depth - 1);
  }
  return result;
};
