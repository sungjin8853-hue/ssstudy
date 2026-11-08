/**
 * 따옴표 `'…'`: 안에 쓴 것은 모두 글자다(논리어가 없다). 4일: 따옴표로 `:` `;` `<`를 한 칸 안의 논리어(`=` `-`)로 바꾸던 것은 없앴다
 * ("‘’를 더해 분류기준을 없애는 것을 없애").
 *  - 안에 쓴 `:` `;` `<` `,` `-` `=` `//`는 괄호 안이어도 칸을 나누지 않고 논리어도 아니다: `A:'B:C'`, `A:'B;C'`, `A:'B-C'`는 모두 A와 한 셀.
 *  - 기호만 감싼 `':'` `';'` `'<'`는 단어에 붙여 써도(`f':'g`) 그 기호를 글자로 쓴 것이다(`f:g` 한 셀).
 *  - 휴대폰 · 태블릿 자판이 바꿔 넣는 둥근 따옴표 `‘…’`도 같은 따옴표다(4일: 둥근 따옴표 안의 논리어로 문제가 나오던 것).
 * 단어 속 `'`(don't)와 짝이 없는 `'`는 따옴표가 아니라 그냥 글자다. 같은 줄 안에서만 짝이 된다.
 */

export type QuoteRole = 'equal' | 'sequence' | 'reverse';

export interface ReviewQuotes {
  /** 따옴표 안(괄호 안이어도)의 `:` `;` `<` 위치. 4일부터 글자다(칸을 나누지 않고 논리어도 아니다). 8일: 숫자에 붙은 `-` `:`(isPlainTextMark)도 여기 담는다 */
  marks: ReadonlyMap<number, QuoteRole>;
  /** 따옴표 글자(여는 것과 닫는 것) 위치 */
  edges: ReadonlySet<number>;
  /** 따옴표 안(괄호 안이어도)에 쓴 `,` `-` `=` `/`의 위치: 논리어가 아니라 글자다 */
  literal: ReadonlySet<number>;
}

const ROLE: Record<string, QuoteRole> = { ':': 'equal', ';': 'sequence', '<': 'reverse' };
/** 따옴표가 맡은 논리어가 글자로 쓰면 어느 것인가(`=` 또는 `-`) */
export const quoteGlue = (role: QuoteRole): '=' | '-' => (role === 'equal' ? '=' : '-');

const OPEN_AFTER = /[\s(\[{,:;<=\-/]/;
const CLOSE_BEFORE = /[\s)\]},:;<=\-/.]/;

let cachedText: string | undefined;
let cached: ReviewQuotes = { marks: new Map(), edges: new Set(), literal: new Set() };

/** 따옴표 글자(곧은 `'`, 둥근 `‘` `’`) */
export const isQuoteMark = (character: string | undefined) => character === "'" || character === '‘' || character === '’';
export const hasQuoteMark = (text: string) => /['‘’]/.test(text);

/**
 * 8일: 띄어 쓰지 않고 숫자에 붙은 `-` `:`는 논리어가 아니라 글자다(따옴표로 감싼 것과 같다).
 *  - `-`: 양옆이 영문자 · 숫자이고 한쪽이라도 숫자(`2024-11-08`, `3-2`, `COVID-19`)
 *  - `-`: 영문자 한 글자 + 소문자 세 글자 이상 낱말(`X-ray`, `e-mail`, `T-shirt`, `x-axis`)
 *  - `:`: 양옆이 모두 숫자(`10:30`, `3:2`)
 * 띄어 쓴 것(`3 - 2`, `10 : 30`)과 한글 · 영문자끼리(`서울-부산`, `a-b`)는 그대로 논리어다.
 */
export const isPlainTextMark = (text: string, index: number): boolean => {
  const character = text[index];
  if (character !== '-' && character !== ':') return false;
  const left = text[index - 1];
  const right = text[index + 1];
  if (!left || !right) return false;
  if (character === ':') return /\d/.test(left) && /\d/.test(right);
  if (!/[A-Za-z0-9]/.test(left) || !/[A-Za-z0-9]/.test(right)) return false;
  if (/\d/.test(left) || /\d/.test(right)) return true;
  return !/[A-Za-z]/.test(text[index - 2] ?? '') && /^[a-z]{3,}/.test(text.slice(index + 1));
};

export const reviewQuotes = (original: string): ReviewQuotes => {
  if (cachedText === original) return cached;
  // 둥근 따옴표는 곧은 따옴표로 읽는다(글자 수가 같아 자리가 그대로다)
  const text = /[‘’]/.test(original) ? original.replace(/[‘’]/g, "'") : original;
  const marks = new Map<number, QuoteRole>();
  const edges = new Set<number>();
  const literal = new Set<number>();
  if (text.includes("'")) {
    for (let open = 0; open < text.length; open += 1) {
      if (text[open] !== "'") continue;
      // 기호만 따옴표로 감싼 `':'` `';'` `'<'`는 이웃 글자와 붙어 있어도(`f':'g`) 그 기호가 논리어(`=` `-`)다: `a:f':'g` = `a:(f=g)`
      if (ROLE[text[open + 1]] && text[open + 2] === "'") {
        marks.set(open + 1, ROLE[text[open + 1]]);
        edges.add(open);
        edges.add(open + 2);
        open += 2;
        continue;
      }
      if (open > 0 && !OPEN_AFTER.test(text[open - 1])) continue;
      let close = -1;
      for (let at = open + 1; at < text.length; at += 1) {
        if (text[at] === '\n') break;
        if (text[at] === "'" && at > open + 1 && (at + 1 >= text.length || CLOSE_BEFORE.test(text[at + 1]))) { close = at; break; }
      }
      if (close < 0) continue;
      let depth = 0;
      let balanced = true;
      const found: number[] = [];
      const plain: number[] = [];
      for (let at = open + 1; at < close && balanced; at += 1) {
        const character = text[at];
        if (character === '(' || character === '[') depth += 1;
        else if (character === ')' || character === ']') { depth -= 1; if (depth < 0) balanced = false; }
        // 4일: `:` `;` `<`도 괄호 안이어도 글자다(칸을 나누지 않고 논리어도 아니다)
        else if (ROLE[character]) found.push(at);
        // `,` `-` `=` `/`는 괄호 안에서도 글자다: 수식 `'(f(x+h)-f(x))/h'`의 `-`가 순서가 되지 않는다
        else if (character === ',' || character === '-' || character === '=' || character === '/') plain.push(at);
      }
      if (!balanced || depth !== 0) continue;
      found.forEach(at => marks.set(at, ROLE[text[at]]));
      plain.forEach(at => literal.add(at));
      edges.add(open);
      edges.add(close);
      open = close;
    }
  }
  if (/\d[-:]|[-:]\d/.test(text)) {
    for (let at = 1; at < text.length - 1; at += 1) {
      if (!marks.has(at) && !literal.has(at) && isPlainTextMark(text, at)) marks.set(at, text[at] === ':' ? 'equal' : 'sequence');
    }
  }
  cachedText = original;
  cached = { marks, edges, literal };
  return cached;
};

export const reviewQuoteMarks = (text: string): ReadonlyMap<number, QuoteRole> => reviewQuotes(text).marks;

/** 이 글자 집합(`delimiters`)으로 칸 안을 자를 때 따옴표 안의 이 기호도 자르는 곳인가: 4일부터 따옴표 안은 모두 글자라 자르지 않는다 */
export const quotedMarkCuts = (_role: QuoteRole, _delimiters: string): boolean => false;
