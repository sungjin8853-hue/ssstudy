/**
 * 따옴표 `'…'`: 분류기준 없는 한 칸. 안에 쓴 `:` `;` `<`는 칸을 나누지 않고 한 칸 안의 논리어로 쓰인다.
 *   `:` → `=` (같음, 양쪽)   `;` → `-` (앞→뒤 순서)   `<` → `-`의 반대(뒤→앞 순서)
 * 앞의 분류기준을 그대로 이으므로(바뀌지 않으므로) 같은 칸이다. `( )` `[ ]` 안은 다시 보통 규칙이라 그 안의 `:` `;` `<`는 그대로 칸을 나눈다.
 * 단, 따옴표 안에는 논리어가 없다는 규칙은 괄호 안에서도 그대로다: `'(f(x+h)-f(x))/h'`의 `-`는 순서가 아니라 글자다(순서를 쓰려면 `;`).
 * 기호만 감싼 `':'` `';'` `'<'`는 단어에 붙여 써도(`f':'g`) 그 기호가 논리어다(`a:f':'g` = `a:(f=g)`).
 * 따옴표 안에는 논리어가 없다: 안에 쓴 `,` `-` `=`는 논리어가 아니라 글자다(`'B-C'`는 한 셀 `B-C`).
 * 단어 속 `'`(don't)와 짝이 없는 `'`는 따옴표가 아니라 그냥 글자다. 같은 줄 안에서만 짝이 된다.
 */
import { isNoteShorthandOn } from './noteShorthand';

export type QuoteRole = 'equal' | 'sequence' | 'reverse';

export interface ReviewQuotes {
  /** 따옴표 안(묶음 괄호 바깥)의 `:` `;` `<` 위치 → 맡은 논리어 */
  marks: ReadonlyMap<number, QuoteRole>;
  /** 따옴표 글자(여는 것과 닫는 것) 위치 */
  edges: ReadonlySet<number>;
  /** 따옴표 안(묶음 괄호 안이어도)에 쓴 `,` `-` `=`의 위치: 논리어가 아니라 글자다 */
  literal: ReadonlySet<number>;
}

const ROLE: Record<string, QuoteRole> = { ':': 'equal', ';': 'sequence', '<': 'reverse' };
/** 따옴표가 맡은 논리어가 글자로 쓰면 어느 것인가(`=` 또는 `-`) */
export const quoteGlue = (role: QuoteRole): '=' | '-' => (role === 'equal' ? '=' : '-');

const OPEN_AFTER = /[\s(\[{,:;<=\-/]/;
const CLOSE_BEFORE = /[\s)\]},:;<=\-/.]/;

let cachedText: string | undefined;
let cached: ReviewQuotes = { marks: new Map(), edges: new Set(), literal: new Set() };

export const reviewQuotes = (text: string): ReviewQuotes => {
  if (cachedText === text) return cached;
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
        else if (depth === 0 && ROLE[character]) found.push(at);
        // `,` `-` `=`는 괄호 안에서도 글자다: 수식 `'(f(x+h)-f(x))/h'`의 `-`가 순서가 되지 않는다
        else if (character === ',' || character === '-' || character === '=') plain.push(at);
      }
      if (!balanced || depth !== 0) continue;
      found.forEach(at => marks.set(at, ROLE[text[at]]));
      plain.forEach(at => literal.add(at));
      edges.add(open);
      edges.add(close);
      open = close;
    }
  }
  cachedText = text;
  cached = { marks, edges, literal };
  return cached;
};

export const reviewQuoteMarks = (text: string): ReadonlyMap<number, QuoteRole> => reviewQuotes(text).marks;

/** 이 글자 집합(`delimiters`)으로 칸 안을 자를 때 따옴표 안의 이 기호도 자르는 곳인가: `=`·`-` 단축어가 켜져 있고 맡은 논리어 글자가 `delimiters`에 있을 때 */
export const quotedMarkCuts = (role: QuoteRole, delimiters: string): boolean => isNoteShorthandOn() && delimiters.includes(quoteGlue(role));
