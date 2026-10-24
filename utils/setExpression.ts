/**
 * `[ ]` 안팎에서 쓰는 집합식 읽기.
 *  - `,` 합집합, `.` 교집합, `%` 여집합, `( )` 먼저 묶기, `[A:C]` 위치 표시(조건 집합), `..` 이어짐(뜻만 남기고 계산에서는 뺀다)
 *  - 이름은 `[ ] ( ) , . %` 를 뺀 글이다(띄어쓰기 가능). `: ; =` 가 들어간 이름은 관계 줄이라 집합식이 아니다.
 */
export type SetExprNode =
  | { type: 'name'; name: string }
  | { type: 'mark'; inner: string }
  | { type: 'not'; of: SetExprNode }
  | { type: 'and'; items: SetExprNode[] }
  | { type: 'or'; items: SetExprNode[] };

type Token =
  | { t: 'name'; text: string }
  | { t: 'mark'; text: string }
  | { t: 'sym'; text: ',' | '.' | '%' | '(' | ')' };

/** `[`(start)와 짝이 맞는 `]`의 자리. 짝이 없거나 줄이 바뀌면 -1. 안쪽에 `[ ]`가 겹쳐 있어도 센다. */
export const matchingBracket = (text: string, start: number): number => {
  if (text[start] !== '[') return -1;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') return -1;
    if (char === '[') depth += 1;
    else if (char === ']') { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
};

const tokenize = (text: string): Token[] | null => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '[') {
      // 안쪽에 `[ ]`가 또 있어도(`[급수.[A:C]]`) 짝이 맞는 `]`까지가 위치 표시 하나다
      const end = matchingBracket(text, index);
      if (end < 0) return null;
      const inner = text.slice(index + 1, end);
      if (!inner.trim() || /\n/.test(inner)) return null;
      tokens.push({ t: 'mark', text: inner.trim() });
      index = end + 1;
      continue;
    }
    if (char === '.' && text[index + 1] === '.') {
      // `..`는 "이어짐" 표시: 뜻만 남기고 식에서는 없는 것으로 본다
      while (text[index] === '.') index += 1;
      continue;
    }
    if (',.%()'.includes(char)) { tokens.push({ t: 'sym', text: char as ',' | '.' | '%' | '(' | ')' }); index += 1; continue; }
    if (char === ']') return null;
    let end = index;
    while (end < text.length && !'[](),.%'.includes(text[end])) end += 1;
    const name = text.slice(index, end).trim();
    if (!name || /[:;<=]/.test(name)) return null;
    tokens.push({ t: 'name', text: name });
    index = end;
  }
  return tokens;
};

/** 집합식 글을 식 나무로. 읽을 수 없으면 null. */
export const parseSetExpression = (text: string): SetExprNode | null => {
  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return null;
  let position = 0;
  const peek = () => tokens[position];
  const isSym = (token: Token | undefined, symbol: string) => !!token && token.t === 'sym' && token.text === symbol;
  let failed = false;
  const fail = (): SetExprNode => { failed = true; return { type: 'name', name: '' }; };
  const atom = (): SetExprNode => {
    const token = tokens[position];
    if (!token) return fail();
    position += 1;
    if (token.t === 'name') return { type: 'name', name: token.text };
    if (token.t === 'mark') return { type: 'mark', inner: token.text };
    if (token.text === '(') {
      const inner = union();
      if (!isSym(peek(), ')')) return fail();
      position += 1;
      return inner;
    }
    return fail();
  };
  const factor = (): SetExprNode => {
    if (isSym(peek(), '%')) { position += 1; return { type: 'not', of: factor() }; }
    return atom();
  };
  const intersection = (): SetExprNode => {
    const items = [factor()];
    while (!failed && isSym(peek(), '.')) { position += 1; items.push(factor()); }
    return items.length === 1 ? items[0] : { type: 'and', items };
  };
  function union(): SetExprNode {
    const items = [intersection()];
    while (!failed && isSym(peek(), ',')) { position += 1; items.push(intersection()); }
    return items.length === 1 ? items[0] : { type: 'or', items };
  }
  const node = union();
  if (failed || position !== tokens.length) return null;
  return node;
};

/** 식에 들어 있는 `[ ]` 위치 표시들의 글 */
export const marksInExpression = (node: SetExprNode): string[] => {
  if (node.type === 'mark') return [node.inner];
  if (node.type === 'name') return [];
  if (node.type === 'not') return marksInExpression(node.of);
  return node.items.flatMap(marksInExpression);
};

/** 식에 연산자(`.` `,` `%` 또는 묶음)가 하나라도 있는가 */
export const hasSetOperator = (node: SetExprNode) => node.type !== 'name' && node.type !== 'mark';

/** `(a,b,c..)` 안쪽 목록의 이름들. 끝의 `..`·`…`는 "이어짐" 표시라 뺀다. */
export const parseMemberList = (inner: string): string[] => inner
  .split(',')
  .map(item => item.replace(/(\.{2,}|…)\s*$/, '').trim())
  .filter(Boolean);
