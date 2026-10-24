import type { ReviewMemoChildrenRelation, ReviewMemoLogicalExpression, ReviewMemoLogicalOperator } from '../types';
import { readReviewFieldOverride, reviewGroups } from './reviewFieldOverride';
import { isReviewSlash } from './reviewSlash';
import { isNoteShorthandOn, isRelationMark } from './noteShorthand';
import { reviewQuotes } from './reviewQuote';
import { openTailOf } from './noteOpenTail';

type Operator = ReviewMemoLogicalOperator['operator'];

export const isReviewSequenceSeparator = (text: string, index: number, start = 0, end = text.length): boolean => {
  if (text[index] !== '-' || !isNoteShorthandOn()) return false;
  let left = index - 1;
  let right = index + 1;
  while (left >= start && /\s/.test(text[left])) left -= 1;
  while (right < end && /\s/.test(text[right])) right += 1;
  if (left < start || right >= end || /[\[(=:;<,/\-]/.test(text[left]) || /[\])=:;<,/]/.test(text[right])) return false;
  if (/[eE]/.test(text[left]) && left > start && /\d/.test(text[left - 1]) && /\d/.test(text[right])) return false;
  return text[right] !== '-' || /^-\s*\d/.test(text.slice(right, end));
};

export const parseReviewMemoSyntax = (text: string, newlineOperator: Operator | boolean = false) => {
  const inheritedOperator = newlineOperator === true ? 'and' : newlineOperator || undefined;
  const operators: ReviewMemoLogicalOperator[] = [];
  const logicalExpressions: ReviewMemoLogicalExpression[] = [];
  const relationSeparators: number[] = [];
  let childrenRelation: ReviewMemoChildrenRelation | undefined;
  const groups = reviewGroups(text);
  const bracketEnds = groups.closed;
  // 따옴표 `'…'` 안의 `;` `<`는 한 칸 안의 순서(`-`)고, `:`는 같음(`=`)이라 칸을 나누지 않는다.
  const quoted = reviewQuotes(text).marks;

  const combine = (operator: Operator, operands: ReviewMemoLogicalExpression[]): ReviewMemoLogicalExpression => (
    operands.length === 1 ? operands[0] : { type: operator, operands }
  );
  const parseExpression = (start: number, end: number, spacedPeriods: boolean): {
    expression?: ReviewMemoLogicalExpression;
    operators: ReviewMemoLogicalOperator[];
  } => {
    const found: ReviewMemoLogicalOperator[] = [];
    let firstContent = start;
    let lastContent = end - 1;
    while (firstContent < end && /[.,\s]/.test(text[firstContent])) firstContent += 1;
    while (lastContent >= start && /[.,\s]/.test(text[lastContent])) lastContent -= 1;
    for (let index = start; index < end; index += 1) {
      const character = text[index];
      const quotedRole = quoted.get(index);
      const override = !quotedRole && (character === ':' || character === ';' || character === '<') ? readReviewFieldOverride(text, index + 1, end) : undefined;
      if (quotedRole) { if (quotedRole !== 'equal' && isNoteShorthandOn()) found.push({ index, operator: 'sequence' }); }
      else if (override) index = override.end - 1;
      else if (groups.skip.has(index)) index = Math.min(groups.skip.get(index)!, end - 1);
      else if (character === ',') found.push({ index, operator: 'and' });
      else if (character === '-' && isReviewSequenceSeparator(text, index, start, end)) found.push({ index, operator: 'sequence' });
    }
    const readOperand = (from: number, to: number): ReviewMemoLogicalExpression | undefined => {
      while (from < to && /\s/.test(text[from])) from += 1;
      while (to > from && /\s/.test(text[to - 1])) to -= 1;
      if (from === to) return undefined;
      if (bracketEnds.get(from) === to - 1) {
        const nested = parseExpression(from + 1, to - 1, true).expression;
        if (nested) return { type: 'group', startIndex: from, endIndex: to, expression: nested };
      }
      return { type: 'text', startIndex: from, endIndex: to };
    };
    const terms: ReviewMemoLogicalExpression[] = [];
    const connectors: Operator[] = [];
    let from = start;
    let pending: Operator | undefined;
    for (let index = 0; index <= found.length; index += 1) {
      const separator = found[index];
      const term = readOperand(from, separator?.index ?? end);
      if (term) {
        if (terms.length && pending) connectors.push(pending);
        terms.push(term);
      }
      if (separator) {
        pending = separator.operator;
        from = separator.index + 1;
      }
    }
    if (!terms.length) return { operators: found };
    // Brackets bind first, followed by sequence, AND, and OR.
    const build = (from: number, to: number, precedence = 0): ReviewMemoLogicalExpression => {
      if (to - from === 1) return terms[from];
      const operator = (['or', 'and', 'sequence'] as const)[precedence];
      const operands: ReviewMemoLogicalExpression[] = [];
      let part = from;
      for (let index = from; index < to - 1; index += 1) {
        if (connectors[index] !== operator) continue;
        operands.push(build(part, index + 1, precedence + 1));
        part = index + 1;
      }
      if (!operands.length) return build(from, to, precedence + 1);
      operands.push(build(part, to, precedence + 1));
      return combine(operator, operands);
    };
    return { expression: build(0, terms.length), operators: found };
  };

  let fieldStart = 0;
  let groupStart = 0;
  let spacedPeriods = inheritedOperator === 'or';
  const finishField = (end: number) => {
    const override = text[fieldStart - 1] === ':' || text[fieldStart - 1] === ';' || text[fieldStart - 1] === '<' ? readReviewFieldOverride(text, fieldStart, end) : undefined;
    const parsed = parseExpression(override?.end ?? fieldStart, end, spacedPeriods);
    operators.push(...parsed.operators);
    if (parsed.expression && parsed.expression.type !== 'text') logicalExpressions.push(parsed.expression);
  };
  const tail = openTailOf(text);
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (groups.skip.has(index)) {
      index = groups.skip.get(index)!;
    } else if (character === '/' && text[index - 1] === '/' && isReviewSlash(text, index)) {
      // 두 번째 슬래시는 앞 슬래시와 한 쌍이라 구분 위치를 따로 만들지 않는다.
      fieldStart = index + 1;
      groupStart = index + 1;
    } else if ((isRelationMark(character) && !quoted.has(index)) || isReviewSlash(text, index) || character === '\n') {
      // 칸을 나누는 기호는 `:` `;` `<`뿐이다. `=`는 한 칸 안의 논리어(`-` `,`와 같은 무리)라 여기서 나누지 않는다.
      const override = character === ':' || character === ';' || character === '<' ? readReviewFieldOverride(text, index + 1) : undefined;
      finishField(index);
      if (character === '/') relationSeparators.push(index);
      if (character === '\n' && inheritedOperator) operators.push({ index, operator: inheritedOperator });
      if (isRelationMark(character) && tail?.connector && tail.start === index && text.slice(groupStart, index).trim()) {
        // 토글 제목 끝 연결어(`:` `;` `<`)는 아래 줄이 행 단위로 이어지는 "또는"이 기본이고, 맨 끝에 `,`를 더 붙이면(`A :,`) 각 행이 "그리고"다.
        childrenRelation = tail.logic === ','
          ? { separatorIndex: index, operator: 'and', type: 'part' }
          : { separatorIndex: index, operator: 'or', type: 'alternative' };
      }
      fieldStart = index + 1;
      spacedPeriods = character === ';' || character === '<' || inheritedOperator === 'or';
      if (character === '/' || character === '\n') groupStart = index + 1;
      if (override) index = override.end - 1;
    }
  }
  finishField(text.length);
  return { logicalOperators: operators, logicalExpressions, relationSeparators, childrenRelation };
};

export const parseReviewMemoLogicalOperators = (text: string): ReviewMemoLogicalOperator[] => (
  parseReviewMemoSyntax(text).logicalOperators
);
