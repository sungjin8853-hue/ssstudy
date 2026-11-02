import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { matchingBracket } from './setExpression';

/**
 * 집합 줄임말(2일 요청): 뒤에서 계속 쓸 집합을 빠르게 적는다. `[ ]` 안에서만 새 뜻이고, `[ ]` 밖의 `#`(틀) · `//`(칸 나누기)는 예전 그대로다.
 *  - `[A.#]`: 여기서부터 붙여 쓸 집합 "A"(붙여 쓸 것이 이미 있으면 그 뒤에 이어 A를 붙인다). 이 칸의 집합은 A이고, 이것만 쓴 줄은 정하기만 한다.
 *  - `//`는 논리어 하나다(꼭 쓰지 않아도 된다): 바로 앞에서 붙은 요소 하나만 없앤다(2일). 붙여 쓸 것이 A.B일 때 `[//K.#]`는 A.K. 두 번(`////`) 쓰면 둘을 뗀다(A.B.C에서 `[////K.#]`는 A.K).
 *  - `[B.#]`: 이 칸은 (붙여 쓸 것).B = A.B이고, 이후 붙여 쓸 것이 A.B로 늘어난다.
 *  - `[#.B]`: 이 칸은 A.B(앞 요소들을 붙인다, `//` 앞의 것은 붙이지 않는다). 붙여 쓸 것은 그대로 A다.
 *  - `[#]`: 붙여 쓸 것 그대로(A).
 * 붙여 쓸 것은 쓴 곳 뒤로(같은 줄의 뒤 칸 · 아래 줄 · 하위 토글) 이어지고, 그 토글이 끝나면 풀린다.
 * 노트를 읽기 전에 풀어 쓴 글(`[A.B]`)로 바꾼다. `#`이 든 `[ ]`가 없는 노트는 그대로다.
 */
const wrap = (part: string) => (/[,%]/.test(part) && !/^\(.*\)$/.test(part) ? `(${part})` : part);
/** `[ ]` 안 글을 요소로: `.`로 나누고 `//`는 따로 뗀다. `#`는 붙여 쓸 것의 자리 */
const tokensOf = (inner: string) => inner.replace(/\/\//g, './/.').split('.').map(token => token.trim()).filter(Boolean);

const isMark = (token: string) => /^%?!$/.test(token);

export const hasSetCarry = (memo: string) => /\[[^\]\n]*#[^\]\n]*\]/.test(memo);

/** keepLines: 정하기만 하는 줄을 빈 줄로 남겨 원래 글과 줄 수를 맞춘다(복습에서 원래 줄을 찾을 때). 기본은 그 줄을 뺀다(노트에 빈 줄로 보이지 않게) */
export const expandSetCarry = (memo: string, keepLines = false): string => {
  if (!hasSetCarry(memo)) return memo;
  const stack: string[][] = [];
  let carry: string[] = [];
  const rewriteLine = (line: string): { text: string; carry: string[] } => {
    let next = carry;
    let out = '';
    for (let index = 0; index < line.length; index += 1) {
      const end = line[index] === '[' ? matchingBracket(line, index) : -1;
      if (end < 0) { out += line[index]; continue; }
      const inner = line.slice(index + 1, end);
      if (!inner.includes('#')) { out += line.slice(index, end + 1); index = end; continue; }
      // 붙여 쓸 것 뒤에 이 `[ ]`의 요소를 차례로 붙인다. `//`는 바로 앞의 요소 하나를 없앤다(2일).
      // `#`가 맨 뒤면 이 칸의 집합이 이후 붙여 쓸 것이 되고, 그 밖에는 붙여 쓸 것이 그대로다.
      // `!`(`%!`)는 복습에서 붙인 표시라 요소가 아니다: 붙여 쓸 것에 넣지 않고 풀어 쓴 집합 뒤에 그대로 둔다(2일 점검: `[A.#.!]`도 A를 이어 붙인다)
      const all = tokensOf(inner);
      const marks = all.filter(isMark);
      const tokens = all.filter(token => !isMark(token));
      // `#`가 요소 하나로 따로 있어야 줄임말이다(`[C#]` 같은 이름 속 `#`는 글자다, 2일 점검)
      if (!tokens.includes('#')) { out += line.slice(index, end + 1); index = end; continue; }
      const elements = [...next];
      tokens.forEach(token => {
        if (token === '#') return;
        if (token === '//') { elements.pop(); return; }
        elements.push(token);
      });
      const set = [...elements.map(wrap), ...marks].join('.');
      if (tokens[tokens.length - 1] === '#') next = elements;
      out += elements.length ? `[${set}]` : line.slice(index, end + 1);
      index = end;
    }
    return { text: out, carry: next };
  };
  const lines = memo.split('\n').map((line): string | null => {
    if (line.startsWith(REVIEW_MEMO_TOGGLE_START)) {
      // 토글 제목에서 붙여 쓸 것을 정하면 그 토글 안에만 이어진다
      const { text, carry: inside } = rewriteLine(line.slice(REVIEW_MEMO_TOGGLE_START.length));
      stack.push(carry);
      carry = inside;
      return REVIEW_MEMO_TOGGLE_START + text;
    }
    if (line === REVIEW_MEMO_TOGGLE_END) { carry = stack.pop() ?? []; return line; }
    const { text, carry: after } = rewriteLine(line);
    carry = after;
    // `[A.#]`·`[//A.#]`만 쓴 줄은 붙여 쓸 것을 정하기만 한다(칸이 없다)
    const only = /^\s*\[([^\]\n]*)\]\s*$/.exec(line);
    if (!only || !tokensOf(only[1]).filter(token => !isMark(token)).includes('#')) return text;
    return keepLines ? '' : null;
  });
  return lines.filter((line): line is string => line !== null).join('\n');
};
