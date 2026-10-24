/**
 * 글 속의 "숫자 기호 숫자"를 계산한 값으로 바꾼다(19:09 규칙: 자유도가 오르면 `3-2`를 `1`처럼 계산된 값으로 보여 난도를 올린다).
 * 우선순위를 지킨다: `x^2-1`의 `2-1`은 `2`가 `^`에 더 단단히 묶여 있어 계산하지 않고, `1+2*3`은 `2*3`부터 `7`까지 접는다.
 * 괄호 안이 숫자 하나가 되면 괄호를 벗긴다(`(3-1)` → `2`). 글자에 붙은 숫자(`x2`)는 숫자가 아니다. 0으로 나누기는 그대로 둔다.
 */
type Token = { type: 'num' | 'op' | 'open' | 'close' | 'other'; text: string };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  const pattern = /(\d+(?:\.\d+)?)|([A-Za-z_À-￿][\wÀ-￿]*)|([+\-*/^])|([()])|(\s+)|(.)/gu;
  for (const found of text.matchAll(pattern)) {
    if (found[1] !== undefined) tokens.push({ type: 'num', text: found[1] });
    else if (found[2] !== undefined) tokens.push({ type: 'other', text: found[2] });
    else if (found[3] !== undefined) tokens.push({ type: 'op', text: found[3] });
    else if (found[4] !== undefined) tokens.push({ type: found[4] === '(' ? 'open' : 'close', text: found[4] });
    else tokens.push({ type: 'other', text: found[5] ?? found[6] ?? '' });
  }
  return tokens;
};

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(10))).replace(/\.?0+$/, '');
};

const compute = (left: number, operator: string, right: number): number | null => {
  switch (operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return right === 0 ? null : left / right;
    case '^': return Math.pow(left, right);
    default: return null;
  }
};

/** 공백 토큰을 건너뛴 이웃 */
const neighbour = (tokens: Token[], from: number, step: number): { token: Token; index: number } | null => {
  for (let index = from + step; index >= 0 && index < tokens.length; index += step) {
    if (!/^\s+$/.test(tokens[index].text)) return { token: tokens[index], index };
  }
  return null;
};

/** 접을 수 있는 `숫자 기호 숫자` 자리(기호 토큰의 번호)를 우선순위가 높은 것부터, 왼쪽부터 찾는다 */
const foldableAt = (tokens: Token[]): number | null => {
  let best: { index: number; precedence: number } | null = null;
  const consider = (index: number, precedence: number) => { if (!best || precedence > best.precedence) best = { index, precedence }; };
  tokens.forEach((token, index) => {
    if (token.type !== 'op') return;
    const left = neighbour(tokens, index, -1);
    const right = neighbour(tokens, index, 1);
    if (!left || !right || left.token.type !== 'num' || right.token.type !== 'num') return;
    const precedence = PRECEDENCE[token.text];
    // 왼쪽 숫자가 더 단단한(또는 같은 왼쪽 결합) 기호에 묶여 있으면 그쪽이 먼저다: `x^2-1`, `1-2-3`의 둘째 `-`
    const beforeLeft = neighbour(tokens, left.index, -1);
    if (beforeLeft?.token.type === 'op') {
      const other = PRECEDENCE[beforeLeft.token.text];
      const leftBinds = neighbour(tokens, beforeLeft.index, -1);
      const hasLeftOperand = leftBinds && (leftBinds.token.type === 'num' || leftBinds.token.type === 'other' || leftBinds.token.type === 'close');
      if (hasLeftOperand && (other > precedence || (other === precedence && token.text !== '^'))) return;
    }
    // 글자에 붙은 숫자가 아니어야 한다(`x 2`는 숫자지만 `x2`는 토큰이 다르다)
    if (beforeLeft && beforeLeft.index === left.index - 1 && beforeLeft.token.type === 'other' && !/^\s+$/.test(beforeLeft.token.text)) return;
    // 오른쪽 숫자가 더 단단한(또는 같은 오른쪽 결합 `^`) 기호에 묶여 있으면 그쪽이 먼저다: `1+2*3`, `2^3^2`
    const afterRight = neighbour(tokens, right.index, 1);
    if (afterRight?.token.type === 'op') {
      const other = PRECEDENCE[afterRight.token.text];
      if (other > precedence || (other === precedence && token.text === '^')) return;
    }
    if (afterRight && afterRight.index === right.index + 1 && afterRight.token.type === 'other' && !/^\s+$/.test(afterRight.token.text)) return;
    consider(index, precedence);
  });
  return best === null ? null : (best as { index: number }).index;
};

export const foldArithmetic = (text: string): string => {
  if (!/\d\s*[+\-*/^]\s*\d/.test(text)) return text;
  const tokens = tokenize(text);
  for (let guard = 0; guard < 64; guard += 1) {
    const at = foldableAt(tokens);
    if (at === null) break;
    const left = neighbour(tokens, at, -1)!;
    const right = neighbour(tokens, at, 1)!;
    const value = compute(Number(left.token.text), tokens[at].text, Number(right.token.text));
    const shown = value === null ? '' : formatNumber(value);
    if (!shown) break;
    const replacement: Token = { type: 'num', text: shown };
    tokens.splice(left.index, right.index - left.index + 1, replacement);
    // 괄호 안이 숫자 하나뿐이면 괄호를 벗긴다
    const open = neighbour(tokens, left.index, -1);
    const close = neighbour(tokens, left.index, 1);
    if (open?.token.type === 'open' && close?.token.type === 'close') tokens.splice(open.index, close.index - open.index + 1, replacement);
  }
  return tokens.map(token => token.text).join('');
};
