import { parseReviewMemoBlocks } from './reviewMemo';
import { isReviewSequenceSeparator } from './reviewMemoLogic';
import { isReviewSlash } from './reviewSlash';
import { calculateReviewQuestionDifficulty, compareReviewQuestionDifficulty } from './reviewDifficulty';
import type { ReviewQuestionDifficulty } from './reviewDifficulty';
import { getReviewFieldOverrides, readReviewFieldOverride, reviewGroups, stripReviewFieldOverrides } from './reviewFieldOverride';
import { buildNoteSetIndex, evaluateSetExpression, expandNoteSlots, fillNoteTemplate, leadingCriterionOf, normSetName, questionAbilities, readNoteSetLine, readNoteSlots, readNoteTemplate, setLinksOf, slotCellsOf } from './noteSets';
import type { NoteSlot, NoteTemplate } from './noteSets';
import { blankTitleCriteria, looksLikeCriterion, noteCriterionOf, splitTitleCriteria } from './noteDiagram';
import { blankOpenLogic, expandOpenLines, openTailOf } from './noteOpenTail';
import { hasLogicMark, isLogicToggleTitle, memoLineText, stripLogicMarks } from './noteLogicMarks';
import { mergeNoteChains, parseNoteChain, scanNoteStatements } from './noteMerge';
import type { OpenTail } from './noteOpenTail';
import { hasTopLevelUnion, joinSets, MASK, processOf, readConvertCell } from './abilityConvert';
import type { ConvertInfo } from './abilityConvert';
import { isNoteShorthandOn, relationMarks, trailingRelation } from './noteShorthand';
import { quotedMarkCuts, reviewQuotes } from './reviewQuote';
import { normalizeNotePunctuation } from './notePunctuation';
import { cellBlankAnswer, cellBlankStatement, renderCellPieces } from './questionStatement';
import { convertStatement, placeOf, proseOf } from './questionProse';
import type { CellKind, CellPiece } from './questionStatement';

/** generated: `#` 틀이 펼쳐 만든 줄의 글(노트에 쓴 글이 아니다). 글자 범위는 틀 줄을 가리킨다. */
export interface AnswerSpan { nodeId: string; start: number; end: number; generated?: string }
export interface QuestionNoteNode { id: string; parentId: string | null; type: 'text' | 'toggle'; text: string }
type QuestionColumn = number | string;
/** `( )` 안의 칸 번호 시작값: 위쪽 분류기준(칸 이름)이 닿지 않는 번호라서 괄호 안 `:`는 이름 없이 읽힌다. 안에서 직접 쓴 `:{이름}`은 그대로 쓰인다. */
const DETACHED_COLUMN = 1000;
type Expression =
  /** raw: 칸 글 사이의 `( )`를 그 자리의 값으로 바꾸기 전 글(바꾼 칸에만 있다) */
  | { type: 'text'; text: string; raw?: string; span: AnswerSpan }
  | { type: 'and' | 'or' | 'sequence' | 'equal'; items: Expression[] }
  | { type: 'relation'; fields: Expression[]; separators: string[]; classifications: QuestionColumn[]; skips?: number[] };

export interface NoteQuestion extends ReviewQuestionDifficulty {
  key: string;
  prompt: string;
  answer: string;
  direction: 'forward' | 'reverse';
  kind: 'direct' | 'reverse' | 'remaining' | 'reconstruct' | 'blank' | 'far' | 'recall' | 'order-next' | 'order-previous' | 'order-reconstruct' | 'convert';
  level: number;
  /** 능력 변환 문제(`[a] b ; [c] d`): 주어지는 능력 집합과 값, 정답으로 적을 칸, 이 문제가 맡은 단위들 */
  convert?: ConvertInfo;
  /** 줄글로 낸 문제 글(문제집처럼 문장으로 쓴 것). 있으면 카드에서 `prompt` 대신 보인다. */
  statement?: string;
  /** 정답 칸에 보일 글: 정답에 논리어(AND·OR)가 있을 때 풀어 쓴 것. 없으면 `answer` 그대로. */
  solution?: string;
  /** 한 칸 안의 `=`로 이은 이웃 쌍이면 'equal'(문장에서 "대응하는 것"으로 묻는다) */
  form?: 'equal';
  /** 덩어리 칸 빈칸 문제의 재료: 문장에 속성 이름을 넣어 다시 쓸 때 쓴다 */
  cell?: { given: string; kind: CellKind; pieces: readonly CellPiece[] };
  /** 빈칸 문제에서 첫 빈칸의 칸 번호. 같은 빈칸 수라면 빈칸이 오른쪽일수록 어렵다. */
  blankStart?: number;
  /** 빈칸 문제의 난이도 순서(0~1): 빈칸 수가 같으면 단서를 줄일수록, 그다음 빈칸을 늘릴수록 어렵다. */
  blankStage?: number;
  /** 연결 추론: 조건에서 정답까지 몇 걸음인가(2 이상). 걸음이 많을수록 어렵다. */
  distance?: number;
  /** 연결 추론의 풀이 과정(조건 → 중간 값 → 정답). 정답을 펼칠 때 같이 보여 준다. */
  process?: string;
  /**
   * 이 문제가 묻는 관계쌍(이웃한 두 칸) 묶음들. 두 칸 이상 떨어진 문제는 사이의 모든 쌍에 든다(18:36 결정).
   * 복습 때 같은 쌍의 문제들은 하나만 내고 나머지는 그 결과를 함께 받는다(`planPairReview`). 저장하지 않고 읽을 때마다 정한다.
   */
  bundles?: string[];
  /** 연결하려는 두 값의 중요도 묶음: 1 중요+중요, 2 중요+덜 중요(어느 쪽이든), 3 덜 중요+덜 중요. */
  priority: number;
  /** 같은 묶음 안에서 먼저 낼 순서: 두 값 중 덜 중요한 쪽의 중요도 값(작을수록 중요). 왼쪽일수록 작다. */
  importance: number;
  conditions: string[];
  columns: { prompt: QuestionColumn[]; answer: QuestionColumn[]; conditions: QuestionColumn[][] };
  /** 이 문제가 놓인 토글 제목에 쓴 분류기준 `[개념:정의]`(가장 가까운 것). 있으면 칸 이름은 세션 노트 기준 대신 이것을 따른다. */
  criterion?: string;
  answerSpans: AnswerSpan[];
  promptSpans: AnswerSpan[];
  conditionSpans: AnswerSpan[][];
}

interface QuestionCondition { text: string; columns: QuestionColumn[]; spans: AnswerSpan[] }

/**
 * 중요도: 맨 왼쪽 칸이 가장 중요하고, 오른쪽으로 한 칸 갈 때마다 덜 중요해진다(`:`·`;`는 1). 점수가 클수록 덜 중요하다.
 * `=`는 칸을 나누지 않는 논리어다. 한 칸 안에서는 `=`로 이은 값이 `-`·`,`보다 중요도가 높아 먼저 낸다:
 * 그 칸이 놓인 자리의 점수에서 0.5를 뺀 자리에 있는 것으로 센다(왼쪽 끝은 0 아래로 내려가지 않는다).
 */
const EQUAL_BONUS = 0.5;
const IMPORTANT_UNTIL = 1;
const columnScores = (separators: string[], base = 0, skips?: readonly number[]) => {
  const scores = [base];
  // `::`처럼 붙여 쓴 연결어는 칸을 건너뛴다: 건너뛴 칸만큼 덜 중요해진다
  separators.forEach((_, index) => scores.push(scores[scores.length - 1] + 1 + (skips?.[index] ?? 0)));
  return scores;
};
/** 두 값의 중요도로 묶음을 정한다: 둘 다 중요 → 1, 하나만 중요 → 2, 둘 다 덜 중요 → 3. */
const rank = (a: number, b: number) => ({
  priority: 1 + (a > IMPORTANT_UNTIL ? 1 : 0) + (b > IMPORTANT_UNTIL ? 1 : 0),
  importance: Math.max(a, b)
});
/** `:`·`=`는 앞으로도 거꾸로도, `;`는 앞으로만(충분조건), `<`는 거꾸로만(역관계), `>`(괄호 안으로 들어가는 이음)은 앞으로만 갈 수 있다. */
const goesForward = (separator: string) => separator !== '<';
const goesBackward = (separator: string) => separator !== '>' && separator !== ';';

// Only top-level delimiters split a column. Nested groups restart column numbering.
const splitAt = (text: string, from: number, to: number, delimiters: string) => {
  const cuts: number[] = [];
  const groups = reviewGroups(text).skip;
  const { marks: quoted, literal } = reviewQuotes(text);
  for (let i = from; i < to; i += 1) {
    // 따옴표 `'…'` 안의 `:` `;` `<`는 칸을 나누지 않고 한 칸 안의 논리어(`=` `-`)다.
    const role = quoted.get(i);
    if (role) { if (quotedMarkCuts(role, delimiters)) cuts.push(i); continue; }
    // 따옴표 안에는 논리어가 없다: 안에 쓴 `,` `-` `=`는 글자라서 자르지 않는다(`'B-C'`는 한 셀)
    if (literal.has(i)) continue;
    const override = text[i] === ':' || text[i] === ';' || text[i] === '<' ? readReviewFieldOverride(text, i + 1, to) : undefined;
    if (override) {
      if (delimiters.includes(text[i])) cuts.push(i);
      i = override.end - 1;
      continue;
    }
    const jump = groups.get(i);
    if (jump !== undefined) { i = Math.min(jump, to - 1); continue; }
    if (delimiters.includes(text[i]) && (text[i] !== '/' || isReviewSlash(text, i))
      && (text[i] !== '-' || isReviewSequenceSeparator(text, i, from, to))) cuts.push(i);
  }
  return cuts;
};
const combine = (type: 'and' | 'or' | 'sequence' | 'equal', items: Expression[]): Expression => (
  items.length === 1 ? items[0] : { type, items }
);
const nonempty = (expression: Expression): boolean => expression.type === 'text'
  ? !!expression.text.trim()
  : expression.type === 'relation' ? expression.fields.some(nonempty) : expression.items.some(nonempty);

/**
 * `( )`는 토글어라서 안의 값은 그 자리에 들어간 값이다: 칸 글 사이에 낀 `(A:B)`에서는 그 자리의 A만 칸 값이다.
 * `(A:B) 안녕`의 A와 안녕은 같은 칸 같은 위치(교집합)라 값이 `A 안녕`이 되고, B는 위치가 달라 이 칸과 단절된 값이다(A → B는 안쪽 관계로 따로 문제가 된다).
 * 안에 관계 기호가 없는 괄호(`밑변 (cm)`·`(A,B)`)는 그대로 둔다.
 */
const withGroupHeads = (text: string): string => {
  if (!text.includes('(')) return text;
  const closed = reviewGroups(text).closed;
  let result = '';
  let cursor = 0;
  let changed = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '[') { const close = closed.get(i); if (close !== undefined) i = close; continue; }
    if (text[i] !== '(') continue;
    const close = closed.get(i);
    if (close === undefined) continue;
    const head = groupHead(text.slice(i + 1, close));
    if (head !== null) { result += text.slice(cursor, i) + head; cursor = close + 1; changed = true; }
    i = close;
  }
  return changed ? result + text.slice(cursor) : text;
};
const groupHead = (inner: string): string | null => {
  const cuts = splitAt(inner, 0, inner.length, relationMarks());
  if (!cuts.length) return null;
  let first = inner.slice(0, cuts[0]).trim();
  if (!first) return null;
  // 첫 칸이 다시 `( )` 하나 전체면 그 안의 첫 값을 쓴다
  if (first[0] === '(' && reviewGroups(first).closed.get(0) === first.length - 1) first = groupHead(first.slice(1, -1)) ?? first;
  return withGroupHeads(first);
};

/** `base`: 이 줄이 시작하는 칸 번호. 맨 위 줄은 0이고, `> 제목 :` 아래 줄은 제목 칸 수만큼 뒤에서 시작한다(분류기준은 세션·상위 토글의 해당 `:`번째를 따른다). */
function parseExpression(text: string, nodeId: string, from = 0, to = text.length, inherited: ReadonlyMap<number, string> = new Map(), base = 0): Expression {
  const edges = reviewQuotes(text).edges;
  for (let changed = true; changed;) {
    changed = false;
    while (from < to && /\s/.test(text[from])) from += 1;
    while (to > from && /\s/.test(text[to - 1])) to -= 1;
    // 칸 가장자리의 따옴표 글자 `'`는 묶음을 나타내는 표시라 글이 아니다.
    if (from < to && edges.has(from)) { from += 1; changed = true; }
    if (to > from && edges.has(to - 1)) { to -= 1; changed = true; }
  }
  // 칸 전체가 `( )`면 그 안의 `:`는 위쪽 분류기준과 이어지지 않는다(18:16 규칙: 괄호 안은 기본적으로 상위값과 분리). `[ ]` 안은 따로 처음부터 센다.
  if (reviewGroups(text).closed.get(from) === to - 1) return parseExpression(text, nodeId, from + 1, to - 1, text[from] === '(' ? new Map() : inherited, text[from] === '(' ? DETACHED_COLUMN : 0);
  const allCuts = splitAt(text, from, to, relationMarks());
  if (allCuts.length) {
    // 붙여 쓴 같은 연결어(`::` `;;`)는 칸 하나를 건너뛴다: 마지막 기호에서 칸을 자르고, 앞의 기호 수만큼 칸 번호가 더 늘어난다.
    const relationCuts: number[] = [];
    const runStarts: number[] = [];
    const skips: number[] = [];
    let run = 0;
    allCuts.forEach((cut, index) => {
      if (!run) runStarts.push(cut);
      if (index + 1 < allCuts.length && allCuts[index + 1] === cut + 1 && text[cut + 1] === text[cut]) { run += 1; return; }
      relationCuts.push(cut);
      skips.push(run);
      run = 0;
    });
    // 칸은 앞 기호 묶음의 마지막 기호 다음에서 시작해 다음 기호 묶음의 첫 기호에서 끝난다
    const ends = [...runStarts, to];
    let column = base;
    let skipped = 0;
    const classifications: QuestionColumn[] = [];
    const fields = ends.map((end, index) => {
      const start = index === 0 ? from : relationCuts[index - 1] + 1;
      if (index > 0) { column += skips[index - 1]; skipped += skips[index - 1]; }
      const override = index > 0 ? readReviewFieldOverride(text, start, end) : undefined;
      const label = override?.label ?? inherited.get(base + index + skipped);
      classifications.push(label !== undefined ? label : index === 0 ? column : ++column);
      // 칸 전체가 `( )`인 칸(`X : (A:B)`)의 안쪽 `:`는 그 칸 번호부터 이어서 센다
      const placed = classifications[classifications.length - 1];
      return parseExpression(text, nodeId, override?.end ?? start, end, inherited, typeof placed === 'number' ? placed : column);
    });
    return { type: 'relation', separators: relationCuts.map(i => text[i]), fields, classifications, ...(skips.some(Boolean) ? { skips } : {}) };
  }
  // `=`는 칸을 나누지 않는 논리어(분류기준 없음)라서 `A:B=C`는 `A`와 `B=C` 두 칸이다. 가장 안쪽에서 묶는다: `x-y=z`는 `x` 다음에 `y=z`.
  const glues: Array<readonly [string, 'and' | 'sequence' | 'equal']> = [[',', 'and'], ['-', 'sequence'], ...(isNoteShorthandOn() ? [['=', 'equal'] as const] : [])];
  for (const [delimiter, type] of glues) {
    const cuts = splitAt(text, from, to, delimiter);
    if (!cuts.length) continue;
    const boundaries = [from - 1, ...cuts, to];
    // 따옴표 안의 `<`는 거꾸로 가는 순서라서, 그것으로 이어진 항목들은 쓴 글의 반대 순서로 놓는다(`b < a` = `a-b`).
    const entries = boundaries.slice(1).map((end, i) => ({
      item: parseExpression(text, nodeId, boundaries[i] + 1, end, inherited, base),
      backward: type === 'sequence' && i > 0 && text[cuts[i - 1]] === '<'
    })).filter(entry => nonempty(entry.item));
    const blocks: Expression[][] = [];
    entries.forEach(entry => (entry.backward && blocks.length ? blocks[blocks.length - 1].unshift(entry.item) : blocks.push([entry.item])));
    const items = blocks.flat();
    if (items.length) return combine(type, items);
  }
  // 칸 가운데에 낀 따옴표 글자(`[a] 'p ; q'`의 `'`)도 글이 아니라서 보이는 글에서만 뺀다(글자 범위는 그대로).
  const shown = edges.size ? Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset).filter(at => !edges.has(at)).map(at => text[at]).join('') : text.slice(from, to);
  const value = withGroupHeads(shown);
  return value === shown ? { type: 'text', text: shown, span: { nodeId, start: from, end: to } }
    : { type: 'text', text: value, raw: shown, span: { nodeId, start: from, end: to } };
}

const head = (expression: Expression): Expression => {
  if (expression.type === 'relation') return head(expression.fields[0]);
  if (expression.type === 'text') return expression;
  return { ...expression, items: expression.items.map(head) };
};
const spans = (expression: Expression): AnswerSpan[] => expression.type === 'text'
  ? (nonempty(expression) ? [expression.span] : [])
  : expression.type === 'relation' ? expression.fields.flatMap(spans) : expression.items.flatMap(spans);
export const expressionLabel = (expression: Expression): string => {
  if (expression.type === 'text') return expression.text;
  if (expression.type === 'relation') return expression.fields.map(expressionLabel).join(' → ');
  return expression.items.map(item => {
    const label = expressionLabel(item);
    return item.type !== 'text' && item.type !== expression.type ? `(${label})` : label;
  }).join(expression.type === 'and' ? ' AND ' : expression.type === 'or' ? ' OR ' : expression.type === 'equal' ? ' = ' : ' → ');
};

/**
 * 칸 하나의 글. 논리 덩어리(`B,C` · `읽기-정리-확인`)도 한 칸이고, 첫 항목 앞의 `[ ]`가 칸 전체의 집합이다.
 * 덩어리 안의 항목을 따로 칸으로 쪼개지 않는다(`A:B,C`는 `A`와 `B,C` 두 칸).
 */
const cellTextOf = (expression: Expression): string => {
  if (expression.type === 'text') return expression.text;
  if (expression.type === 'relation') return cellTextOf(head(expression));
  const glue = expression.type === 'and' ? ', ' : expression.type === 'sequence' ? '-' : expression.type === 'equal' ? '=' : ' / ';
  return expression.items.map(item => {
    const text = cellTextOf(item);
    return item.type !== 'text' && item.type !== expression.type ? `(${text})` : text;
  }).join(glue);
};
const leavesOf = (expression: Expression): Array<Extract<Expression, { type: 'text' }>> => (
  expression.type === 'text' ? [expression] : expression.type === 'relation' ? expression.fields.flatMap(leavesOf) : expression.items.flatMap(leavesOf)
);
/** 한 칸으로 읽히는가: 글 또는 `,`·`-` 덩어리. 첫 항목 말고는 `[ ]`로 시작하지 않아야 한다. 집합과 값을 읽어 낸다. */
const readCell = (column: Expression) => {
  if (column.type === 'or' || column.type === 'relation') return null;
  if (leavesOf(column).slice(1).some(leaf => leaf.text.trim().startsWith('['))) return null;
  return readConvertCell(cellTextOf(column));
};
/**
 * 모든 칸에 집합이 있는 관계의 칸들. 칸의 집합은 칸 앞에 직접 쓴 `[ ]`와 그 칸 번호의 상위 속성(위쪽 토글 제목이 이어 주는 집합)의 교집합이다.
 * `[A] k`라고만 써도 점 없이 언제나 상위 속성과 교집합이고, 토글 밑 토글도 바깥 것부터 차례로 쌓인다(`implicit`).
 */
const convertFieldsOf = (columns: Expression[], implicit: string[][]) => columns.map((column, position) => {
  const read = readCell(column);
  const sets = read ? [...(implicit[position] ?? []), ...read.sets] : [];
  return read && sets.length ? { set: joinSets(sets), cell: read.cell } : null;
});
const mapFirstLeaf = (expression: Expression, change: (text: string) => string): Expression => {
  if (expression.type === 'text') {
    const text = change(expression.text);
    return text === expression.text ? expression : { ...expression, text };
  }
  if (expression.type === 'relation') return { ...expression, fields: [mapFirstLeaf(expression.fields[0], change), ...expression.fields.slice(1)] };
  return { ...expression, items: [mapFirstLeaf(expression.items[0], change), ...expression.items.slice(1)] };
};
/**
 * 칸 앞의 `[A] k`는 점 없이도 그 칸 번호의 상위 속성과 `A`의 교집합이다: 분류기준 `개념:정의` 아래에서
 * `[A] k : j`는 `[개념.A] k : [정의] j`와 같다. 상위 토글이 여럿이면 바깥 것부터 모두 붙는다
 * (`[개념:정의]` > `[원인:결과]` 아래의 `[A] k`는 `[개념.원인.A] k`). 집합 기호(`.` `,` `%`)는 `[ ]` 안에서만 쓴다.
 * 줄에 집합(`[A]`)이 붙은 칸이 있으면 `[ ]`가 없는 다른 칸도 자기 칸 번호의 상위 속성을 집합으로 갖는다(풀어 쓴 꼴이 모든 칸에 집합을 쓴 줄이라서).
 * 집합이 붙은 칸이 하나도 없는 줄과, 앞에 분류기준(`[개념:정의]`)만 쓴 줄은 줄이지 않는다.
 * 위쪽 토글 제목이 이어 주는 집합(`convertFieldsOf`)은 이 뒤에 더해진다.
 * `criteria`: 노트 맨 위 줄 · 상위 토글 제목들의 분류기준(바깥 → 안쪽).
 */
const spellOutColumnSets = (expression: Expression, criteria: readonly string[]): Expression => {
  if (expression.type !== 'relation' || !criteria.length) return expression;
  const tables = criteria.map(criterion => {
    const boundaries = [-1, ...splitAt(criterion, 0, criterion.length, ':;<'), criterion.length];
    return boundaries.slice(1).map((end, index) => criterion.slice(boundaries[index] + 1, end).trim());
  });
  const namesOf = (index: number): string[] => {
    const placed = expression.classifications[index];
    if (typeof placed === 'string') return placed.trim() ? [placed.trim()] : [];
    return tables.map(table => table[placed] ?? '').filter(Boolean);
  };
  const hasSet = (field: Expression) => (readConvertCell(leavesOf(field)[0]?.text ?? '')?.sets ?? []).some(set => !looksLikeCriterion(set));
  if (!expression.fields.some((field, index) => namesOf(index).length > 0 && hasSet(field))) return expression;
  return { ...expression, fields: expression.fields.map((field, index) => {
    const names = namesOf(index);
    if (!names.length) return field;
    const prefix = names.map(name => `[${name}]`).join('');
    return mapFirstLeaf(field, text => (text.startsWith('[') ? `${prefix}${text}` : `${prefix} ${text}`));
  }) };
};

const leadingSetsOf = (expression: Expression): string[] => readConvertCell(leavesOf(expression)[0]?.text ?? '')?.sets ?? [];
/** 가릴 항목들(번호). 항목이 4개까지는 모든 부분집합, 더 많으면 하나씩과 이어진 구간. 전부 가리는 것은 칸 전체를 묻는 단위 문제라 뺀다. */
const hiddenSetsOf = (count: number): number[][] => {
  const sets: number[][] = [];
  if (count <= 4) {
    for (let bits = 1; bits < (1 << count) - 1; bits += 1) sets.push(Array.from({ length: count }, (_, index) => index).filter(index => bits & (1 << index)));
  } else {
    for (let length = 1; length < count; length += 1) for (let start = 0; start + length <= count; start += 1) sets.push(Array.from({ length }, (_, offset) => start + offset));
  }
  return sets.sort((a, b) => a.length - b.length || a[0] - b[0]).slice(0, 24);
};

/**
 * 논리 덩어리 칸(`p-d-s` · `p, q, r`)의 안쪽을 가린 모양들. 덩어리 안의 세부 칸(논리어로 나뉜 글)이 **한 번씩은 빈칸**에 들도록
 * 가릴 수 있는 모든 경우를 만든다: 빈칸 하나, 빈칸 둘 …(항목이 4개까지는 모든 부분집합, 더 많으면 하나씩과 이어진 구간).
 * 전부 가리는 것은 칸 전체를 묻는 문제와 같아서 뺀다. 덩어리 안의 덩어리(`p-(q,r)-s`)는 안쪽 세부 칸도 따로 가린다.
 * 순서(`-`)는 자리를 그대로 두고 건너뛰어 가릴 수 있고, 그리고(`,`)는 순서가 없어 가린 자리를 뒤로 모은다.
 */
interface CellBlankForm {
  kind: CellKind;
  pieces: CellPiece[];
  hidden: string[];
  hiddenSpans: AnswerSpan[];
  visibleSpans: AnswerSpan[];
  /** 가린 세부 칸 수 · 덩어리 전체의 세부 칸 수 · (순서에서) 건너뛴 횟수 */
  hiddenLeaves: number;
  leaves: number;
  skips: number;
  first: number;
}
/** 논리 덩어리를 쉼표·화살표로 읽는 글(정답 칸에 쓴다): `q AND r` 대신 `q, r` */
const chunkText = (expression: Expression): string => (expression.type === 'and' ? expression.items.filter(nonempty).map(chunkText).join(', ')
  : expression.type === 'sequence' ? expression.items.filter(nonempty).map(chunkText).join(' → ')
    : expression.type === 'equal' ? expression.items.filter(nonempty).map(chunkText).join(' = ') : expressionLabel(expression));
/** 가리지 않은 항목의 조각들: 덩어리 안의 덩어리는 괄호로 묶어 논리어를 종류에 맞게 잇는다 */
const shownPieces = (expression: Expression): CellPiece[] => {
  if (expression.type !== 'and' && expression.type !== 'sequence' && expression.type !== 'equal') return [expressionLabel(expression)];
  const parts = expression.items.filter(nonempty).map(shownPieces);
  return ['(', ...parts.flatMap((part, index) => (index ? [{ glue: expression.type } as CellPiece, ...part] : part)), ')'];
};
/**
 * `skipSuffix`: 맨 뒤 항목들만 가린 모양은 "남은 조건"(앞 항목을 충족하면 남은 것)이 이미 같은 것을 묻는 방향이라 뺀다.
 * 가장 바깥의 그리고(`p, q, r`)도 "남은 조건"이 모든 부분집합을 이미 묻기 때문에 자기 모양은 내지 않고, 그 안의 덩어리만 가린다.
 */
const cellBlankForms = (expression: Expression, skipSuffix = false, top = true): CellBlankForm[] => {
  if (expression.type !== 'and' && expression.type !== 'sequence' && expression.type !== 'equal') return [];
  const kind = expression.type;
  const items = expression.items.filter(nonempty);
  if (items.length < 2) return [];
  const leaves = items.reduce((sum, item) => sum + spans(item).length, 0);
  const join = (parts: CellPiece[][]): CellPiece[] => parts.flatMap((part, index) => (index ? [{ glue: kind } as CellPiece, ...part] : part));
  const forms: CellBlankForm[] = [];
  // 값이 둘뿐인 `=`는 칸 안의 이웃 쌍 문제(앞으로·거꾸로)가 이미 같은 것을 묻는다
  if (!(top && kind === 'and') && !(kind === 'equal' && items.length < 3)) hiddenSetsOf(items.length).forEach(hidden => {
    if (skipSuffix && kind === 'sequence' && hidden[hidden.length - 1] === items.length - 1 && hidden.every((index, position) => index === hidden[0] + position)) return;
    const visible = items.map((_, order) => order).filter(order => !hidden.includes(order));
    const order = kind === 'and' ? [...visible, ...hidden] : items.map((_, index) => index);
    const hiddenSpans = hidden.flatMap(index => spans(items[index]));
    const runs = hidden.filter((index, position) => position === 0 || index !== hidden[position - 1] + 1).length;
    forms.push({ kind, hidden: hidden.map(index => chunkText(items[index])), hiddenSpans, leaves, first: hidden[0],
      pieces: join(order.map(index => (hidden.includes(index) ? [{ blank: chunkText(items[index]) }] : shownPieces(items[index])))),
      visibleSpans: visible.flatMap(index => spans(items[index])), hiddenLeaves: hiddenSpans.length, skips: kind === 'sequence' ? runs - 1 : 0 });
  });
  items.forEach((item, position) => cellBlankForms(item, false, false).forEach(inner => {
    forms.push({ ...inner, kind, leaves, first: position,
      pieces: join(items.map((other, index) => (index === position ? ['(', ...inner.pieces, ')'] : shownPieces(other)))),
      visibleSpans: [...items.filter((_, index) => index !== position).flatMap(spans), ...inner.visibleSpans] });
  }));
  return forms.slice(0, 40);
};

/**
 * `@`: `:` `;` `<` `=` 바로 앞 칸을 다시 가리킨다(위쪽 토글 제목 아래 줄에서는 제목의 마지막 칸).
 *  - 그냥 쓴 `@`는 앞 칸의 값이다: `[A] B : @+1` → 뒤 칸은 `[A] B+1`(칸 앞에 집합을 따로 쓰지 않았으면 앞 칸의 집합을 이어받는다).
 *  - `[ ]` 안의 `@`는 앞 칸의 집합이다: `[A] B : [@] C` → `[A] C`.
 *  - 글자 바로 뒤에 붙은 `@`(메일 주소 `a@b.c`)는 가리킴이 아니다. 앞 칸이 없으면 그대로 둔다.
 *  - 칸 앞에 집합을 쓴 칸의 `@`는 **그 집합에 든 가장 가까운 앞 칸**이다(다른 집합의 칸은 건너뛴다): `[A] b : [C] d : [A] @+1` → `[A] b+1`(d는 A에 없다).
 *    같은 집합에 든 앞 칸이 없으면 바로 앞 칸이다.
 */
interface AtReference { sets: string[]; cell: string }
const lastCellOf = (expression: Expression): AtReference | null => {
  if (expression.type === 'relation') {
    for (let index = expression.fields.length - 1; index >= 0; index -= 1) {
      if (nonempty(expression.fields[index])) return lastCellOf(expression.fields[index]);
    }
    return null;
  }
  const text = cellTextOf(expression).trim();
  if (!text) return null;
  return readConvertCell(text) ?? { sets: [], cell: text };
};
const substituteAt = (text: string, reference: AtReference | null, inheritSets: boolean): string => {
  if (!reference || !text.includes('@')) return text;
  const setText = reference.sets.length ? joinSets(reference.sets) : '';
  const wrapped = setText && hasTopLevelUnion(setText) ? `(${setText})` : setText;
  let depth = 0;
  let result = '';
  let usedCell = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '[') depth += 1;
    else if (character === ']') depth = Math.max(0, depth - 1);
    if (character === '@' && !(index > 0 && /[\p{L}\p{N}_]/u.test(text[index - 1]))) {
      if (depth > 0) result += wrapped || character;
      else { result += reference.cell; usedCell = true; }
      continue;
    }
    result += character;
  }
  if (inheritSets && usedCell && reference.sets.length && !result.trimStart().startsWith('[')) {
    result = `${reference.sets.map(set => `[${set}]`).join('')} ${result.trimStart()}`;
  }
  return result;
};
/** 칸 앞에 쓴 집합이 같은 가장 가까운 앞 칸(없으면 null) */
const sameSetReference = (field: Expression, history: readonly AtReference[]): AtReference | null => {
  const wanted = leadingSetsOf(field).map(set => set.replace(/\s+/g, ''));
  if (!wanted.length) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].sets.some(set => wanted.includes(set.replace(/\s+/g, '')))) return history[index];
  }
  return null;
};
const resolveReferences = (expression: Expression, previous: AtReference | null, first = true): Expression => {
  if (expression.type === 'text') {
    const text = substituteAt(expression.text, previous, first);
    return text === expression.text ? expression : { ...expression, text };
  }
  if (expression.type === 'relation') {
    let reference = previous;
    const history: AtReference[] = previous ? [previous] : [];
    const fields = expression.fields.map(field => {
      const resolved = resolveReferences(field, sameSetReference(field, history) ?? reference, true);
      reference = lastCellOf(resolved) ?? reference;
      if (reference && history[history.length - 1] !== reference) history.push(reference);
      return resolved;
    });
    return { ...expression, fields };
  }
  return { ...expression, items: expression.items.map((item, index) => resolveReferences(item, previous, first && index === 0)) };
};

const remainingExpression = (expression: Expression, known: Set<string>): Expression | null => {
  if (expression.type === 'text') return known.has(expression.text) ? null : expression;
  // `=`로 이은 값은 하나의 사실이다(그리고가 아니라서 일부만 주고 나머지를 묻지 않는다)
  if (expression.type === 'equal') return known.has(expressionLabel(expression)) ? null : expression;
  if (expression.type === 'relation') return remainingExpression(head(expression), known);
  if (expression.type === 'sequence') {
    for (let index = 0; index < expression.items.length; index += 1) {
      const remaining = remainingExpression(expression.items[index], known);
      if (remaining) return combine('sequence', [remaining, ...expression.items.slice(index + 1)]);
    }
    return null;
  }
  const items = expression.items.map(item => remainingExpression(item, known));
  if (expression.type === 'or' && items.some(item => item === null)) return null;
  const remaining = items.filter((item): item is Expression => item !== null);
  return remaining.length ? combine(expression.type, remaining) : null;
};
const availableFacts = (expression: Expression): Expression[] => {
  if (expression.type === 'text' || expression.type === 'equal') return [expression];
  if (expression.type === 'relation') return availableFacts(head(expression));
  return (expression.type === 'sequence' ? expression.items.slice(0, 1) : expression.items).flatMap(availableFacts);
};
const allFacts = (expression: Expression): Expression[] => {
  if (expression.type === 'text' || expression.type === 'equal') return [expression];
  return expression.type === 'relation' ? allFacts(head(expression)) : expression.items.flatMap(allFacts);
};

/**
 * 먼 거리 문제용: `A:(B:C)`처럼 마지막 칸이 또 하나의 관계(괄호)이면 그 관계의 칸들을 이어 한 줄로 본다.
 * 괄호 안으로 들어가는 이음은 앞으로만 갈 수 있다(`>`): A에서 C로는 가도 C에서 A로는 거꾸로 가지 않는다.
 */
const chainOf = (expression: Expression, base = 0): { columns: Expression[]; separators: string[]; classifications: QuestionColumn[]; scores: number[] } => {
  if (expression.type !== 'relation') return { columns: [head(expression)], separators: [], classifications: [0], scores: [base] };
  const own = columnScores(expression.separators, base, expression.skips);
  const columns: Expression[] = [];
  const separators: string[] = [];
  const classifications: QuestionColumn[] = [];
  const scores: number[] = [];
  expression.fields.forEach((field, index) => {
    if (index > 0 && index === expression.fields.length - 1 && field.type === 'relation') {
      const inner = chainOf(field, own[index]);
      separators.push(expression.separators[index - 1] === '<' ? '<' : '>');
      columns.push(...inner.columns);
      separators.push(...inner.separators);
      classifications.push(...inner.classifications);
      scores.push(...inner.scores);
    } else {
      if (index > 0) separators.push(expression.separators[index - 1]);
      columns.push(head(field));
      classifications.push(expression.classifications[index]);
      scores.push(own[index]);
    }
  });
  return { columns, separators, classifications, scores };
};

// Explore satisfied facts breadth-first, retaining each remaining AND/OR/order structure.
const partialConditions = (expression: Expression): Array<{ given: Expression[]; remaining: Expression }> => {
  if (expression.type === 'text' || expression.type === 'equal') return [];
  const facts = [...new Map(allFacts(expression).map(item => [expressionLabel(item), item])).values()];
  const indexByLabel = new Map(facts.map((fact, index) => [expressionLabel(fact), index]));
  const pending: number[][] = [[]];
  const visited = new Set(['']);
  const result: Array<{ given: Expression[]; remaining: Expression }> = [];
  for (let cursor = 0; cursor < pending.length && result.length < 64; cursor += 1) {
    const selected = pending[cursor];
    const known = new Set(selected.map(index => expressionLabel(facts[index])));
    const current = remainingExpression(expression, known);
    if (!current) continue;
    for (const candidate of availableFacts(current)) {
      let next = [...selected, indexByLabel.get(expressionLabel(candidate))!].sort((a, b) => a - b);
      const remaining = remainingExpression(expression, new Set(next.map(index => expressionLabel(facts[index]))));
      if (!remaining) continue;
      // Drop a supplied fact when another supplied branch already makes it unnecessary.
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const shorter = next.filter((_, i) => i !== index);
        const without = remainingExpression(expression, new Set(shorter.map(i => expressionLabel(facts[i]))));
        if (without && expressionLabel(without) === expressionLabel(remaining)) next = shorter;
      }
      const key = next.join(',');
      if (visited.has(key)) continue;
      visited.add(key);
      result.push({ given: next.map(index => facts[index]), remaining });
      pending.push(next);
      if (result.length >= 64) break;
    }
  }
  return result;
};
const hash = (text: string) => {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
};

export const getReviewQuestionClassification = (criterion: string | null | undefined, question: NoteQuestion) => {
  const text = question.criterion || criterion || '';
  const boundaries = [-1, ...splitAt(text, 0, text.length, ':;<'), text.length];
  const columns = boundaries.slice(1).map((end, index) => text.slice(boundaries[index] + 1, end).trim());
  const labels = (indices: QuestionColumn[]) => [...new Set(indices.map(index => typeof index === 'string' ? index : columns[index]).filter(Boolean))];
  return {
    prompt: labels(question.columns.prompt),
    answer: labels(question.columns.answer),
    conditions: question.conditions.map((_, index) => labels(question.columns.conditions[index] || []))
  };
};

/**
 * 줄글 문제 글을 속성 이름까지 넣어 다시 쓴다(세션 노트 분류기준이 있을 때): `개념 ‘자동차’에서 정의 ‘엔진’에 이어지는 예시 값은?`
 * 분류기준이 없거나 줄글이 아닌 문제(노트 회상)면 만들어 둔 글(`statement`)을 그대로 돌려준다(없으면 null).
 */
export const getReviewQuestionSentence = (criterion: string | null | undefined, question: NoteQuestion): { statement: string; solution?: string } | null => {
  const labels = getReviewQuestionClassification(criterion, question);
  if (question.convert) {
    return { statement: convertStatement({ ...question.convert, direction: question.direction }, { given: labels.prompt, required: labels.answer }) };
  }
  if (question.cell) {
    return { statement: cellBlankStatement({ ...question.cell, where: placeOf(question.conditions, labels.conditions), attrs: { prompt: labels.prompt, answer: labels.answer } }) };
  }
  const prose = proseOf(question, { prompt: labels.prompt, answer: labels.answer, conditions: labels.conditions });
  if (prose) return prose;
  return question.statement ? { statement: question.statement, solution: question.solution } : null;
};

/** 끝이 열린 제목(`자동차 :`) 아래 줄이 시작하는 칸 번호. 문제 만들기와 편집기의 `:` 색 번호가 같은 값을 쓴다. */
const childOffsetOf = (parsed: Expression[], offset: number) => {
  const last = parsed.at(-1);
  return last?.type === 'relation' && !nonempty(last.fields.at(-1)!) ? offset + last.fields.length - 1 : offset;
};
/** 제목에서 문제 글이 아닌 부분을 같은 길이의 빈칸으로: 분류 기준 `[개념:정의]`와 맨 끝의 논리관계어(`A :,`의 `,`) */
const blankTitle = (title: string) => blankOpenLogic(blankTitleCriteria(title));
export const getToggleChildOffset = (written: string, offset = 0, inherited: ReadonlyMap<number, string> = new Map()): number => {
  const title = blankTitle(written);
  const cuts = splitAt(title, 0, title.length, '/\n');
  const boundaries = [-1, ...cuts, title.length];
  const parsed = boundaries.slice(1).map((end, i) => parseExpression(title, 'title', boundaries[i] + 1, end, inherited, offset)).filter(nonempty);
  return childOffsetOf(parsed, offset);
};

/**
 * 문제마다 관계쌍 묶음을 붙인다. 한 줄(관계)의 칸 범위를 글자 위치로 알고, 문제의 문제·정답 글자 범위가 닿는 칸들 중
 * 가장 왼쪽~오른쪽 사이의 이웃 쌍이 모두 묶음이다(사이 모든 쌍). 한 칸 안에서만 묻는 문제(순서 · `=` · 칸 안 빈칸)는 그 칸 하나가 묶음,
 * 틀·자리로 펼친 줄은 펼친 줄 하나가 묶음, 여러 줄(토글 제목 + 아래 줄)에 걸친 문제는 양 끝 칸이 한 묶음이다.
 */
const assignPairBundles = (questions: NoteQuestion[], expressions: ReadonlyMap<string, Expression[]>) => {
  interface Layout { nodeId: string; start: number; end: number; columns: Array<{ start: number; end: number; items: Array<{ start: number; end: number }> }> }
  const layouts: Layout[] = [];
  expressions.forEach((list, nodeId) => list.forEach(expression => {
    if (expression.type !== 'relation') return;
    const columns = expression.fields.map(field => {
      const spans = leavesOf(field).map(leaf => leaf.span).filter(span => span && span.nodeId === nodeId && !span.generated);
      const items = [...spans].sort((a, b) => a.start - b.start).map(span => ({ start: span.start, end: span.end }));
      return spans.length ? { start: Math.min(...spans.map(span => span.start)), end: Math.max(...spans.map(span => span.end)), items } : null;
    });
    if (columns.some(column => !column)) return;
    const ranges = columns as Layout['columns'];
    layouts.push({ nodeId, start: ranges[0].start, end: ranges[ranges.length - 1].end, columns: ranges });
  }));
  const locate = (span: AnswerSpan): { layout: Layout; column: number } | null => {
    for (const layout of layouts) {
      if (layout.nodeId !== span.nodeId || span.start < layout.start || span.start >= layout.end) continue;
      const column = layout.columns.findIndex(range => span.start >= range.start && span.start < range.end);
      if (column >= 0) return { layout, column };
    }
    return null;
  };
  questions.forEach(question => {
    if (question.kind === 'recall' || question.convert) return;
    const spans = [...question.promptSpans, ...question.answerSpans];
    const generated = spans.find(span => span.generated);
    if (generated) { question.bundles = [`gen:${generated.nodeId}:${generated.generated}`]; return; }
    const places = spans.map(locate).filter((place): place is { layout: Layout; column: number } => place !== null);
    if (!places.length) return;
    const layoutsTouched = [...new Set(places.map(place => place.layout))];
    if (layoutsTouched.length === 1) {
      const layout = layoutsTouched[0];
      const columns = places.map(place => place.column);
      const low = Math.min(...columns);
      const high = Math.max(...columns);
      const id = `${layout.nodeId}@${layout.start}`;
      if (low === high) {
        // 한 칸 안(순서 `-` · 같음 `=`)에서 묻는 문제는 그 칸의 이웃 항목 쌍이 묶음이다(사이 모든 쌍)
        const items = layout.columns[low].items;
        const touched = spans.map(span => items.findIndex(item => span.start >= item.start && span.start < item.end)).filter(index => index >= 0);
        const first = Math.min(...touched);
        const last = Math.max(...touched);
        question.bundles = touched.length && last > first
          ? Array.from({ length: last - first }, (_, offset) => `${id}:${low}.${first + offset}-${first + offset + 1}`)
          : [`${id}:${low}`];
        return;
      }
      question.bundles = Array.from({ length: high - low }, (_, offset) => `${id}:${low + offset}-${low + offset + 1}`);
      return;
    }
    const ends = [...new Set(places.map(place => `${place.layout.nodeId}@${place.layout.start}:${place.column}`))].sort();
    question.bundles = [ends.join('|')];
  });
};

export function buildReviewQuestions(original: string): { questions: NoteQuestion[]; nodes: QuestionNoteNode[] } {
  // 맨 끝이 덜 끝난 줄은 바로 밑 줄을 토글 아래 줄처럼 품는다(가장 먼저 처리). 전각 기호(`：` `；`)는 노트 기호로 읽는다(글자 수가 같아 글자 범위는 그대로).
  const memo = expandOpenLines(normalizeNotePunctuation(original));
  const tailByNode = new Map<string, OpenTail>();
  const nodes: QuestionNoteNode[] = [];
  const expressions = new Map<string, Expression[]>();
  const inheritedByNode = new Map<string, ReadonlyMap<number, string>>();
  const incomingByNode = new Map<string, AtReference | null>();
  /** 이 줄이 시작하는 칸 번호: 끝이 열린 제목(`자동차 :`) 아래 줄은 제목의 칸 수만큼 뒤에서 시작한다. 닫힌 제목(`A:C`)과 관계 없는 제목은 제목과 같은 자리다. */
  const offsetByNode = new Map<string, number>();
  const criterionByNode = new Map<string, string>();
  /** 노드마다 붙는 상위 속성: 노트 맨 위 줄부터 그 토글까지의 분류기준(바깥 → 안쪽) */
  const criteriaByNode = new Map<string, readonly string[]>();
  /** 노트 맨 위(토글 밖)에 쓴 분류기준 줄. 토글 제목의 분류기준이 없는 곳에서 `[A]`가 이 기준과 교집합이 된다. */
  const noteCriterion = noteCriterionOf(memo) ?? undefined;
  /** 줄(칸) 왼쪽에 쓴 `[개념:정의] 값:값`의 분류기준: 그 칸의 글자 범위 안에서 난 문제에 적용된다 */
  const lineCriteria: Array<{ nodeId: string; start: number; end: number; criterion: string }> = [];
  /** `[A] #-#: #+#`처럼 `#`로 셀을 만드는 틀 줄: 모든 줄을 읽은 뒤(집합의 셀을 알 수 있을 때) 줄들로 펼친다 */
  const templates: Array<{ id: string; start: number; end: number; text: string; template: NoteTemplate; inherited: ReadonlyMap<number, string>; offset: number; previous: AtReference | null }> = [];
  /**
   * 줄 안의 `{A}`: A가 노트에 있는 집합이면 "그 집합의 원소가 들어갈 자리"다(`안녕: {A}아, 그래 안녕` → 원소마다 한 줄).
   * 집합이 아닌 이름은 슬롯이 아니라서 지금처럼 `:{이름}` 칸 이름표로 읽는다. 모든 줄을 읽은 뒤(집합의 원소를 알 수 있을 때) 줄들로 펼친다.
   */
  const slotIndex = memo.includes('{') ? buildNoteSetIndex([memo]) : null;
  const slotLines: Array<{ id: string; start: number; end: number; text: string; slots: NoteSlot[]; inherited: ReadonlyMap<number, string>; offset: number; previous: AtReference | null }> = [];
  const walkBlocks = (text: string, parentId: string | null, inherited: ReadonlyMap<number, string> = new Map(), previous: AtReference | null = null, offset = 0, scopedCriterion?: string, blocked = false, upperCriteria: readonly string[] = noteCriterion ? [noteCriterion] : []) => {
    parseReviewMemoBlocks(text).forEach((block, index) => {
      const id = `${parentId || 'root'}.${index}`;
      const written = block.type === 'toggle' ? block.title : block.text;
      // `[!]` 집합에 걸린 줄(과 `!` 토글 아래)은 문제를 만들지 않는다: 글 자리는 남기되 읽지 않는다
      const blockedHere = blocked || (block.type === 'toggle' && isLogicToggleTitle(written));
      // 토글 제목에 쓴 분류 기준 `[개념:정의]`는 문제의 글이 아니라 그 토글 안의 칸 이름이다(가장 가까운 것을 쓴다).
      const ownCriterion = block.type === 'toggle' ? splitTitleCriteria(written).criteria.at(-1) : undefined;
      const criterion = ownCriterion ?? scopedCriterion;
      if (criterion) criterionByNode.set(id, criterion);
      /** `[A]`에 붙는 상위 속성: 노트 맨 위 줄부터 이 토글까지의 분류기준(바깥 → 안쪽) */
      const criteria = ownCriterion ? [...upperCriteria, ownCriterion] : upperCriteria;
      criteriaByNode.set(id, criteria);
      const value = block.type === 'toggle' ? blankTitle(written) : written;
      if (block.type === 'toggle') { const open = openTailOf(blankTitleCriteria(written)); if (open) tailByNode.set(id, open); }
      nodes.push({ id, parentId, type: block.type, text: written });
      inheritedByNode.set(id, inherited);
      incomingByNode.set(id, previous);
      offsetByNode.set(id, offset);
      const cuts = splitAt(value, 0, value.length, '/\n');
      const boundaries = [-1, ...cuts, value.length];
      // `[X]` 홀로, `[집합식]:[기준]`(능력 정의), `[개념:정의]`(노트 전체 분류 기준)는 문제가 아니라 집합·기준을 적은 줄이다.
      const everySegment = boundaries.slice(1).map((end, i) => ({ start: boundaries[i] + 1, end }));
      const templateOf = (segment: { start: number; end: number }) => (block.type === 'toggle' ? null : readNoteTemplate(value.slice(segment.start, segment.end)));
      const slotsOf = (segment: { start: number; end: number }) => (block.type === 'toggle' || !slotIndex ? [] : readNoteSlots(value.slice(segment.start, segment.end), slotIndex));
      const segments = everySegment
        .filter(segment => block.type === 'toggle' || (!readNoteSetLine(value.slice(segment.start, segment.end)) && !hasLogicMark(value.slice(segment.start, segment.end)) && !templateOf(segment) && slotsOf(segment).length === 0));
      if (!blockedHere) everySegment.forEach(segment => { const template = templateOf(segment); if (template) templates.push({ id, ...segment, text: value.slice(segment.start, segment.end), template, inherited, offset, previous }); });
      if (!blockedHere) everySegment.forEach(segment => {
        const slots = slotsOf(segment);
        const written = value.slice(segment.start, segment.end);
        if (slots.length && !readNoteSetLine(written) && !hasLogicMark(written) && !templateOf(segment)) slotLines.push({ id, ...segment, text: written, slots, inherited, offset, previous });
      });
      const parsed = blockedHere ? [] : segments.map(segment => spellOutColumnSets(resolveReferences(parseExpression(value, id, segment.start, segment.end, inherited, offset), previous), criteria)).filter(nonempty);
      expressions.set(id, parsed);
      if (!blockedHere) segments.forEach(segment => {
        const lineCriterion = leadingCriterionOf(value.slice(segment.start, segment.end));
        if (lineCriterion) lineCriteria.push({ nodeId: id, start: segment.start, end: segment.end, criterion: lineCriterion });
      });
      // 토글 아래 줄의 `@`는 제목의 마지막 칸을 가리킨다
      if (block.type === 'toggle') {
        walkBlocks(block.text, id, getReviewFieldOverrides(value, inherited, offset), (parsed.length ? lastCellOf(parsed[parsed.length - 1]) : null) ?? previous,
          childOffsetOf(parsed, offset), criterion, blockedHere, criteria);
      }
    });
  };
  walkBlocks(memo, null);
  // `#` 틀을 줄들로 펼친다. 순서: ① 틀의 첫 칸 자리가 A 안의 셀로 바뀐다(`#'-'#` → `'B-C'`) → ② 기존 연결·첨가 합치기를 거친다
  // (`A:'B-C'`에 `A:'B-C':'B+C'`를 합치면 연결) → ③ 문제가 나온다. 합칠 수 있는 자리가 여럿이면 모든 자리에 줄을 만든다.
  // `[A]` 안(토글·위치 표시)에 있고 연결어가 없는 셀은 A와 교집합(들어가 있다)이라 `[A] 'B-C':'B+C'` 줄이 된다.
  // 펼친 줄은 노트에 쓴 글이 아니다: 글자 범위는 틀 줄 하나로 모으고, 줄의 글은 `generated`에 남긴다(빼기가 이 줄만 막을 수 있게).
  if (templates.length) {
    const index = buildNoteSetIndex([memo]);
    const withSpan = (expression: Expression, span: AnswerSpan): Expression => (expression.type === 'text' ? { ...expression, span }
      : expression.type === 'relation' ? { ...expression, fields: expression.fields.map(field => withSpan(field, span)) }
        : { ...expression, items: expression.items.map(item => withSpan(item, span)) });
    const cellOf = (expression: Expression | undefined) => (expression?.type === 'text' ? (readConvertCell(expression.text)?.cell ?? expression.text).trim() : null);
    const walkRelations = (expression: Expression, visit: (fields: Expression[]) => void) => {
      if (expression.type === 'relation') { visit(expression.fields); expression.fields.forEach(field => walkRelations(field, visit)); }
      else if (expression.type !== 'text') expression.items.forEach(item => walkRelations(item, visit));
    };
    const written = [...expressions.values()].flat();
    /** 이름 A가 첫 칸인 줄들의 둘째 칸 글(`A:'B-C'`의 `B-C`) */
    const neighboursOf = (name: string): string[] => {
      const found: string[] = [];
      written.forEach(expression => walkRelations(expression, fields => {
        const first = cellOf(fields[0]);
        const next = cellOf(fields[1]);
        if (first && next && normSetName(first) === normSetName(name)) found.push(next);
      }));
      return found;
    };
    const plainName = (mark: string) => !/[.,%()[\]:;']/.test(mark) && !!mark.trim();
    const unquote = (name: string) => name.replace(/^'([\s\S]*)'$/, '$1');
    const splitEqualMembers = (cell: string): string[] => {
      if (!isNoteShorthandOn() || /^'[\s\S]*'$/.test(cell)) return [cell];
      const literal = reviewQuotes(cell).literal;
      const cuts = splitAt(cell, 0, cell.length, '=').filter(cut => !literal.has(cut));
      if (!cuts.length) return [cell];
      const bounds = [-1, ...cuts, cell.length];
      const parts = bounds.slice(1).map((end, at) => cell.slice(bounds[at] + 1, end).trim()).filter(Boolean);
      return parts.length > 1 ? parts : [cell];
    };
    /** 집합 이름이면 그 안의 셀들, `[A]`·`[A:C]` 위치 표시면 그 위치에 쓴 셀들(연결어 없이 들어 있는 셀) */
    const insideOf = (mark: string): string[] => {
      const named = plainName(mark) ? evaluateSetExpression(index, mark) : [];
      // `{A}` 자리와 같은 원소 세기: `=`으로 이은 셀(`F=Cl=Br=I`)은 각각이 원소이고, 틀 줄·자리 줄 자신(`#`·`{ }`가 든 셀)은 원소가 아니다
      return [...named, ...evaluateSetExpression(index, `[${mark}]`)].flatMap(splitEqualMembers).map(unquote).filter(cell => !/[#{}]/.test(cell));
    };
    /** 틀 안의 `{A}` 자리에 들어갈 원소들(`slotCellsOf`: 집합 A의 원소와 `[A] 셀`, `=`으로 이은 셀은 각각). 틀 안은 따옴표를 글자로 쓰므로 벗긴다. */
    const slotOptionsOf = (expression: string): string[] => [...new Set(slotCellsOf(index, expression).map(unquote).filter(option => option && !/['\n]/.test(option)))];
    const flat = (text: string) => text.replace(/\s+/g, '');
    // 이미 `[!]`로 막은 줄(빼기가 펼친 줄 하나를 막은 것도 포함)은 다시 만들지 않는다
    const blockedLines = new Set<string>();
    memo.split('\n').forEach(line => { const text = memoLineText(line); if (hasLogicMark(text)) blockedLines.add(flat(stripLogicMarks(text))); });
    // 합치기 대상: 틀과 같은 속성(토글 경로)의 관계 줄들(합치기 엔진과 같은 범위)
    const statements = scanNoteStatements(memo);
    const templateRuns = new Map<string, number>();
    templates.forEach(item => {
      const { template } = item;
      const run = templateRuns.get(flat(item.text)) ?? 0;
      templateRuns.set(flat(item.text), run + 1);
      const own = statements.filter(statement => flat(statement.text) === flat(item.text))[run];
      const path = own ? own.path.join('\u0001') : '';
      const targets = statements.filter(statement => statement.path.join('\u0001') === path && !readNoteTemplate(statement.text) && !hasLogicMark(statement.text));
      const name = template.marks.length === 1 && plainName(template.marks[0]) ? template.marks[0].trim() : null;
      const insides = template.marks.map(insideOf);
      const keys = (list: string[]) => new Set(list.map(normSetName));
      const members = [...new Set(insides[0])].filter(cell => insides.every(list => keys(list).has(normSetName(cell))));
      const neighbours = name ? [...new Set(neighboursOf(name))] : [];
      const quote = (text: string) => `'${text}'`;
      const made = expressions.get(item.id) ?? [];
      const seen = new Set<string>();
      const push = (line: string) => {
        if (seen.has(flat(line)) || blockedLines.has(flat(line))) return;
        seen.add(flat(line));
        const parsedLine = resolveReferences(parseExpression(line, item.id, 0, line.length, item.inherited, item.offset), item.previous);
        if (nonempty(parsedLine)) made.push(withSpan(parsedLine, { nodeId: item.id, start: item.start, end: item.end, generated: line }));
      };
      // 따옴표로 감싸도 그대로 한 칸으로 읽히는 글만 쓴다: 프라임 `(x^2)'`처럼 낱말 뒤의 `'`는 따옴표가 아니라 글자라 괜찮다
      const quotable = (text: string) => {
        if (text.includes('\n')) return false;
        if (!text.includes("'")) return true;
        const edges = reviewQuotes(quote(text)).edges;
        return edges.size === 2 && edges.has(0) && edges.has(text.length + 1);
      };
      const fromCell = (cell: string, neighbour: boolean) => {
        if (!quotable(cell)) return;
        const filled = fillNoteTemplate(template, cell, slotOptionsOf);
        if (!filled || !filled.every(quotable)) return;
        const tail = filled.map((text, at) => `${template.separators[at]}${quote(text)}`).join('');
        if (name) {
          const chain = `${name}:${quote(cell)}${tail}`;
          // 연결어가 없는 셀은 A 안에 들어 있고, A를 첫 칸으로 쓴 줄 옆의 셀은 그 줄에 이어진다
          push(neighbour ? chain : `[${name}] ${quote(cell)}${tail}`);
          // 연결·첨가: 같은 속성의 줄에 합칠 수 있는 자리마다(A와 이 셀이 이미 있는 줄) 합친 줄이 하나씩 더 생긴다
          targets.forEach(target => {
            // 이 셀이 이미 들어 있는 줄에만 이어 붙는다(A만 겹치는 줄에 첨가되면 엉뚱한 줄이 된다)
            const targetChain = parseNoteChain(target.text);
            const at = targetChain.fields.findIndex(field => flat(field).replace(/^(\[[^\]]*\])+/, '') === flat(quote(cell)));
            if (at < 0) return;
            // 칸 번호가 같아야 이어지므로, 그 줄에서 이 셀이 놓인 칸 번호만큼 건너뛰어 쓴다(A:x:'B-C'의 셀은 3번째 칸이라 `A::'B-C'…`)
            const aligned = `${name}${':'.repeat(Math.max(1, targetChain.cols[at]))}${quote(cell)}${tail}`;
            // 같은 줄의 셀로 만든 글이라 위치는 그 줄 그대로다
            const merged = mergeNoteChains(target.text, aligned, null);
            if (merged) push(merged.text);
          });
        } else push(`${template.marks.map(mark => `[${mark}]`).join('')} ${quote(cell)}${tail}`);
      };
      members.slice(0, 200).forEach(cell => fromCell(cell, false));
      neighbours.slice(0, 200).forEach(cell => { if (!members.some(member => normSetName(member) === normSetName(cell))) fromCell(cell, true); });
      expressions.set(item.id, made);
    });
  }
  // `{A}` 자리를 줄들로 펼친다: 줄마다 자리(`{A}` `{B}`)에 그 집합의 원소를 하나씩 넣은 줄이 문제가 된다(여러 자리면 모든 짝, 합쳐 200줄까지).
  // 펼친 줄은 노트에 쓴 글이 아니다: 글자 범위는 원래 줄 하나로 모으고, 줄의 글은 `generated`에 남긴다.
  if (slotLines.length && slotIndex) {
    const withSpanOf = (expression: Expression, span: AnswerSpan): Expression => (expression.type === 'text' ? { ...expression, span }
      : expression.type === 'relation' ? { ...expression, fields: expression.fields.map(field => withSpanOf(field, span)) }
        : { ...expression, items: expression.items.map(item => withSpanOf(item, span)) });
    slotLines.forEach(item => {
      const made = expressions.get(item.id) ?? [];
      const lines = expandNoteSlots(item.text, item.slots, slotIndex);
      lines.forEach(line => {
        const parsedLine = resolveReferences(parseExpression(line, item.id, 0, line.length, item.inherited, item.offset), item.previous);
        if (nonempty(parsedLine)) made.push(withSpanOf(parsedLine, { nodeId: item.id, start: item.start, end: item.end, generated: line }));
      });
      expressions.set(item.id, made);
    });
  }
  // A trailing relation uses direct child heads; grandchildren retain their own relations.
  [...nodes].reverse().forEach(node => {
    if (node.type !== 'toggle') return;
    const children = nodes.filter(child => child.parentId === node.id)
      .flatMap(child => (expressions.get(child.id) || []).map(head)).filter(nonempty);
    const clauses = expressions.get(node.id) || [];
    const last = clauses.at(-1);
    if (!children.length || !last) return;
    // 끝의 논리관계어가 아래 줄들을 잇는 논리다: `,` 그리고 · `-` 순서 · `=` 같음. 연결어만 있으면 행 단위 "또는"이 기본이다.
    const tail = tailByNode.get(node.id);
    const logic = tail?.logic === ',' ? 'and' : tail?.logic === '-' ? 'sequence' : tail?.logic === '=' ? 'equal' : undefined;
    if (last.type === 'relation' && !nonempty(last.fields.at(-1)!)) {
      last.fields[last.fields.length - 1] = combine(logic ?? 'or', children);
    } else if (logic) {
      // `A,`처럼 논리관계어만으로 끝난 제목: 아래 줄들이 같은 칸 안에서 그 논리로 이어진다
      if (last.type === 'relation') last.fields[last.fields.length - 1] = combine(logic, [last.fields[last.fields.length - 1], ...children]);
      else clauses[clauses.length - 1] = combine(logic, [last, ...children]);
    }
  });

  const questions: NoteQuestion[] = [];
  // 같은 문제(같은 종류·같은 글·같은 조건)는 줄을 두 번 써도 한 번만 낸다. 뒤에 나온 줄의 글자 범위는 가림에 쓰도록 합쳐 둔다.
  const bySignature = new Map<string, NoteQuestion>();
  const duplicateSpans = new Map<NoteQuestion, { answerSpans: AnswerSpan[]; promptSpans: AnswerSpan[] }>();
  const reverseAlternatives = new Map<string, { question: NoteQuestion; answers: string[] }>();
  const add = (question: Omit<NoteQuestion, 'key' | 'level' | keyof ReviewQuestionDifficulty>) => {
    if (!question.prompt.trim() || !question.answer.trim() || question.prompt === question.answer) return;
    const reverseIdentity = JSON.stringify([question.prompt, question.conditions, question.priority, question.columns]);
    const existingReverse = question.kind === 'reverse' ? reverseAlternatives.get(reverseIdentity) : undefined;
    if (existingReverse) {
      if (!existingReverse.answers.includes(question.answer)) existingReverse.answers.push(question.answer);
      existingReverse.question.answer = existingReverse.answers.map(answer => existingReverse.answers.length > 1 && answer.includes(' AND ') ? `(${answer})` : answer).join(' OR ');
      existingReverse.question.answerSpans.push(...question.answerSpans);
      existingReverse.question.promptSpans.push(...question.promptSpans);
      existingReverse.question.key = `q2:${hash(JSON.stringify(['reverse', question.prompt, existingReverse.question.answer, question.conditions]))}:0`;
      return;
    }
    // 능력 변환은 노트의 위치(위쪽 토글)나 관계 기호와 상관없이 같은 집합의 같은 값이면 같은 문제다: 조건을 키에 넣지 않는다
    const signature = hash(JSON.stringify(question.convert?.variation
      ? [question.kind, question.prompt, question.answer, [], question.convert.steps, question.convert.given, question.convert.required, question.convert.partial]
      : question.convert
        ? [question.kind, question.prompt, question.answer, [], question.convert.steps.map(step => step.set)]
        : [question.kind, question.prompt, question.answer, question.conditions]));
    const same = bySignature.get(signature);
    if (same) {
      const extra = duplicateSpans.get(same) ?? { answerSpans: [], promptSpans: [] };
      extra.answerSpans.push(...question.answerSpans);
      extra.promptSpans.push(...question.promptSpans);
      duplicateSpans.set(same, extra);
      // 같은 문제가 여러 곳에 있으면 가장 중요한 쪽을 따른다
      if (question.priority < same.priority || (question.priority === same.priority && question.importance < same.importance)) {
        same.priority = question.priority;
        same.importance = question.importance;
      }
      return;
    }
    const entry: NoteQuestion = { ...question, answerSpans: [...question.answerSpans], promptSpans: [...question.promptSpans],
      level: 1, recallUnits: 0, providedUnits: 0, difficulty: 0, key: `${question.convert?.variation ? 'cvv' : question.kind === 'convert' ? 'cv1' : 'q2'}:${signature}:0` };
    bySignature.set(signature, entry);
    questions.push(entry);
    if (question.kind === 'reverse') reverseAlternatives.set(reverseIdentity, { question: entry, answers: [question.answer] });
  };
  const byId = new Map(nodes.map(node => [node.id, node]));
  const titleSource = (node: QuestionNoteNode) => (node.type === 'toggle' ? blankTitle(node.text) : node.text);
  const ancestorConditions = (node: QuestionNoteNode) => {
    const result: QuestionCondition[] = [];
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId)!;
      const rawTitle = titleSource(parent).replace(trailingRelation(), '');
      const title = stripReviewFieldOverrides(rawTitle).trim().replace(trailingRelation(), '');
      const parsed = parseExpression(rawTitle, parent.id, 0, rawTitle.length, inheritedByNode.get(parent.id), offsetByNode.get(parent.id) ?? 0);
      // 칸 이름은 칸의 위치에서만 온다: 관계 제목(`> A:B`)과 끝이 열린 제목(`> A:`)의 머리는 관계의 칸이라 이름이 붙고,
      // 글자만 있는 제목(`> ② 세 가지 표기`)은 아래 줄들의 위치일 뿐 분류기준 안의 칸이 아니라서 이름을 붙이지 않는다.
      const headsRelation = parsed.type === 'relation' || trailingRelation().test(titleSource(parent));
      result.unshift({ text: title, spans: spans(parsed), columns: parsed.type === 'relation'
        ? parsed.fields.flatMap((field, index) => nonempty(field) ? [parsed.classifications[index]] : []) : headsRelation ? [offsetByNode.get(parent.id) ?? 0] : [] });
      parentId = parent.parentId;
    }
    return result.filter(item => item.text);
  };
  /**
   * 위쪽 토글 제목이 관계(`> [A] B: [C] D`)면 아래 줄의 칸은 칸 번호마다 제목의 분류 집합 `A.B` · `C.D`와 교집합이다.
   * 아래 줄은 그 집합을 쓰지 않아도 되고(앞에서는 생략), 바깥 토글부터 안쪽 토글까지 차례로 쌓인다.
   * 제목 칸의 `[A]`도 점 없이 그 칸 번호의 상위 속성(분류기준)과 교집합이라, 토글 밑 토글도 바깥 기준을 이어서 쌓는다.
   * 끝이 열린 제목(`A:`)과 `[ ]`가 하나도 없는 제목(`A:C`)은 분류 집합을 만들지 않는다.
   */
  const titleParts = new Map<string, string[][] | null>();
  const titlePartsOf = (parent: QuestionNoteNode): string[][] | null => {
    if (titleParts.has(parent.id)) return titleParts.get(parent.id)!;
    let result: string[][] | null = null;
    if (!trailingRelation().test(parent.text)) {
      const parsed = spellOutColumnSets(resolveReferences(parseExpression(titleSource(parent), parent.id, 0, parent.text.length, inheritedByNode.get(parent.id)), incomingByNode.get(parent.id) ?? null), criteriaByNode.get(parent.id) ?? []);
      if (parsed.type === 'relation') {
        const reads = parsed.fields.map(field => (nonempty(field) ? readCell(head(field)) : null));
        if (reads.filter(Boolean).length >= 2 && reads.some(read => read && read.sets.length)) {
          result = reads.map(read => (read ? [...read.sets, read.cell] : []));
        }
      }
    }
    titleParts.set(parent.id, result);
    return result;
  };
  const implicitSetsOf = (node: QuestionNoteNode): string[][] => {
    const chain: QuestionNoteNode[] = [];
    for (let parentId = node.parentId; parentId; parentId = byId.get(parentId)!.parentId) chain.unshift(byId.get(parentId)!);
    const merged: string[][] = [];
    chain.forEach(parent => (titlePartsOf(parent) ?? []).forEach((parts, position) => { merged[position] = [...(merged[position] ?? []), ...parts]; }));
    return merged;
  };
  const implicitByExpression = new Map<Expression, string[][]>();
  const visit = (expression: Expression, context: QuestionCondition[], inheritedColumn: QuestionColumn = 0, baseScore = 0) => {
    if (expression.type === 'text') return;
    const conditions = context.map(item => item.text);
    const conditionColumns = context.map(item => item.columns);
    const conditionSpans = context.map(item => item.spans);
    if (expression.type === 'sequence') {
      // 순서는 한 칸(논리 혼합 셀) 안의 변주라서, 중요도는 그 칸이 놓인 자리를 따른다.
      const inCell = rank(baseScore, baseScore);
      const items = expression.items.map(head);
      items.slice(1).forEach((right, index) => {
        const left = items[index];
        const base = { prompt: expressionLabel(left), answer: expressionLabel(right), direction: 'forward' as const,
          ...inCell, conditions, conditionSpans, answerSpans: spans(right), promptSpans: spans(left),
          columns: { prompt: [inheritedColumn], answer: [inheritedColumn], conditions: conditionColumns } };
        add({ ...base, kind: 'order-next' });
        add({ ...base, prompt: base.answer, answer: base.prompt, direction: 'reverse', kind: 'order-previous',
          answerSpans: base.promptSpans, promptSpans: base.answerSpans });
      });
      if (items.length > 2) add({ prompt: expressionLabel(items[0]), answer: expressionLabel(combine('sequence', expression.items.slice(1))),
        direction: 'forward', kind: 'order-reconstruct', ...inCell, conditions, conditionSpans,
        columns: { prompt: [inheritedColumn], answer: [inheritedColumn], conditions: conditionColumns },
        answerSpans: expression.items.slice(1).flatMap(spans), promptSpans: spans(items[0]) });
      // 연결 추론: 두 걸음 이상 떨어진 항목 하나를 묻는다. 중간 항목은 주지 않고 풀이 과정으로 펼칠 때 보여 준다.
      for (let from = 0; from < items.length; from += 1) {
        for (let to = from + 2; to < items.length; to += 1) {
          const path = items.slice(from, to + 1).map(expressionLabel);
          const common = { ...inCell, conditions, conditionSpans, distance: to - from, kind: 'far' as const,
            columns: { prompt: [inheritedColumn], answer: [inheritedColumn], conditions: conditionColumns } };
          add({ ...common, prompt: path[0], answer: path[path.length - 1], process: path.join(' → '), direction: 'forward',
            answerSpans: spans(items[to]), promptSpans: spans(items[from]) });
          add({ ...common, prompt: path[path.length - 1], answer: path[0], process: [...path].reverse().join(' → '), direction: 'reverse',
            answerSpans: spans(items[from]), promptSpans: spans(items[to]) });
        }
      }
      expression.items.forEach((item, index) => visit(item, index === 0 ? context
        : [...context, { text: `${expressionLabel(combine('sequence', items.slice(0, index)))} 이후`,
          columns: [inheritedColumn], spans: items.slice(0, index).flatMap(spans) }], inheritedColumn, baseScore));
      return;
    }
    if (expression.type === 'equal') {
      // `=`로 이은 값은 한 칸 안의 논리어다: 칸 안의 이웃한 값끼리 앞으로도 거꾸로도 잇는다. `-`·`,`보다 중요도가 높아 먼저 낸다(칸 점수에서 EQUAL_BONUS를 뺀 자리).
      const items = expression.items.map(head);
      const placed = Math.max(0, baseScore - EQUAL_BONUS);
      const inCell = rank(placed, placed);
      items.slice(1).forEach((right, index) => {
        const left = items[index];
        const base = { prompt: expressionLabel(left), answer: expressionLabel(right), direction: 'forward' as const, form: 'equal' as const,
          ...inCell, conditions, conditionSpans, answerSpans: spans(right), promptSpans: spans(left),
          columns: { prompt: [inheritedColumn], answer: [inheritedColumn], conditions: conditionColumns } };
        add({ ...base, kind: 'direct' });
        add({ ...base, prompt: base.answer, answer: base.prompt, direction: 'reverse', kind: 'reverse',
          answerSpans: base.promptSpans, promptSpans: base.answerSpans });
      });
      expression.items.forEach(item => visit(item, context, inheritedColumn, baseScore));
      return;
    }
    if (expression.type !== 'relation') { expression.items.forEach(item => visit(item, context, inheritedColumn, baseScore)); return; }
    const columns = expression.fields.map(head);
    const scores = columnScores(expression.separators, baseScore, expression.skips);
    // 모든 칸 앞에 `[집합]`을 쓴 관계는 능력 변환 문제의 최소 단위들이다(기본 관계·역방향·연결 추론 대신 낸다).
    // 위쪽 토글 제목이 관계(`> [A] B: [C] D`)이면 이 줄의 칸 번호마다 그 분류 집합(`A.B` · `C.D`)을 보이지 않게 이어받는다.
    const implicitSets = implicitByExpression.get(expression) ?? [];
    // `::`로 건너뛴 칸이 있으면 위쪽 토글 제목의 분류 집합도 칸 번호대로 건너뛰어 읽는다
    const implicit = expression.skips
      ? expression.fields.map((_, index) => implicitSets[index + expression.skips!.slice(0, index).reduce((sum, value) => sum + value, 0)] ?? [])
      : implicitSets;
    const convertFields = convertFieldsOf(columns, implicit);
    const convertible = convertFields.length >= 2 && convertFields.every(Boolean);
    // 한 줄 전체를 묻는 변주(빈칸·전체 재구성): 집합(논리어)은 가리지 않고 값 칸만 가린다
    const wholeRow = rank(scores[0], Math.max(...scores));
    const convertRow = (shownIndexes: number[], hiddenIndexes: number[], extra: { blankStart?: number; blankStage?: number } = {}) => {
      const givenIndexes = shownIndexes.filter(index => !hiddenIndexes.includes(index));
      add({ prompt: shownIndexes.map(index => (hiddenIndexes.includes(index) ? MASK : convertFields[index]!.cell)).join(' → '),
        answer: hiddenIndexes.map(index => convertFields[index]!.cell).join(' → '), direction: 'forward', kind: 'convert', ...wholeRow, ...extra,
        conditions, conditionSpans,
        columns: { prompt: givenIndexes.map(index => expression.classifications[index]), answer: hiddenIndexes.map(index => expression.classifications[index]), conditions: conditionColumns },
        answerSpans: hiddenIndexes.flatMap(index => spans(columns[index])), promptSpans: givenIndexes.flatMap(index => spans(columns[index])),
        convert: { steps: shownIndexes.map(index => convertFields[index]!), unitKeys: [], form: 'unit', variation: 'row',
          required: shownIndexes.flatMap((index, order) => (hiddenIndexes.includes(index) ? [order] : [])),
          given: shownIndexes.flatMap((index, order) => (hiddenIndexes.includes(index) ? [] : [order])) } });
    };
    // 논리 덩어리 칸(`B,C` · `읽기-정리-확인`)의 안쪽을 가린 변주: 집합과 짝이 되는 값은 주어지고, 덩어리의 일부(어디든)를 맞힌다.
    const cellVariations = (wantedIndex: number, givenIndex: number) => {
      const wantedColumn = columns[wantedIndex];
      if (wantedColumn.type !== 'and' && wantedColumn.type !== 'sequence' && wantedColumn.type !== 'equal') return;
      const items = wantedColumn.items;
      const glue = wantedColumn.type === 'and' ? ', ' : wantedColumn.type === 'equal' ? '=' : '-';
      const texts = items.map((item, order) => {
        const text = cellTextOf(item);
        return order === 0 ? readConvertCell(text)?.cell ?? text : text;
      });
      const pair = rank(scores[Math.min(wantedIndex, givenIndex)], scores[Math.max(wantedIndex, givenIndex)]);
      const steps = [convertFields[givenIndex]!, convertFields[wantedIndex]!];
      hiddenSetsOf(items.length).forEach(hidden => {
        const visible = items.map((_, order) => order).filter(order => !hidden.includes(order));
        // 순서는 자리를 그대로 두고, 그리고(순서 없음)는 보이는 항목 뒤에 빈칸을 모은다
        const partial = wantedColumn.type === 'and'
          ? [...visible.map(order => texts[order]), ...hidden.map(() => MASK)].join(glue)
          : texts.map((text, order) => (hidden.includes(order) ? MASK : text)).join(glue);
        add({ prompt: steps[0].cell, answer: hidden.map(order => texts[order]).join(glue), kind: 'convert', ...pair,
          direction: wantedIndex > givenIndex ? 'forward' : 'reverse', conditions, conditionSpans,
          columns: { prompt: [expression.classifications[givenIndex]], answer: [expression.classifications[wantedIndex]], conditions: conditionColumns },
          answerSpans: hidden.flatMap(order => spans(items[order])), promptSpans: [...spans(columns[givenIndex]), ...visible.flatMap(order => spans(items[order]))],
          convert: { steps, required: [1], given: [0], unitKeys: [], form: 'unit', variation: 'cell', partial: { 1: partial } } });
      });
    };
    // 능력 집합이 없는 줄의 논리 덩어리 칸: 주어진 칸을 보고 덩어리의 일부(어디든)를 맞히는 줄글 문제. 자유도(빈칸 수 · 건너뜀)가 클수록 어렵다.
    const plainCellBlanks = (wantedIndex: number, givenIndex: number, separator: string) => {
      const given = expressionLabel(columns[givenIndex]);
      const pair = rank(scores[Math.min(wantedIndex, givenIndex)], scores[Math.max(wantedIndex, givenIndex)]);
      cellBlankForms(columns[wantedIndex], wantedIndex > givenIndex && goesForward(separator)).forEach(form => add({
        prompt: `${given} : ${renderCellPieces(form.pieces, { and: ' AND ', sequence: ' → ', equal: ' = ' }, () => MASK)}`,
        answer: cellBlankAnswer(form.hidden), statement: cellBlankStatement({ given, kind: form.kind, pieces: form.pieces, where: placeOf(conditions) }),
        cell: { given, kind: form.kind, pieces: form.pieces },
        direction: wantedIndex > givenIndex ? 'forward' : 'reverse', kind: 'blank', ...pair, conditions, conditionSpans,
        blankStart: form.first, blankStage: (form.hiddenLeaves + 0.5 * form.skips) / (1.5 * form.leaves),
        columns: { prompt: [expression.classifications[givenIndex]], answer: [expression.classifications[wantedIndex]], conditions: conditionColumns },
        answerSpans: form.hiddenSpans, promptSpans: [...spans(columns[givenIndex]), ...form.visibleSpans] }));
    };
    expression.separators.forEach((separator, index) => {
      const left = columns[index];
      const right = columns[index + 1];
      if (!nonempty(left) || !nonempty(right)) return;
      if (convertible) {
        const from = convertFields[index]!;
        const to = convertFields[index + 1]!;
        const unit = (reverse: boolean) => {
          const [given, wanted] = reverse ? [to, from] : [from, to];
          const [givenSpans, wantedSpans] = reverse ? [spans(right), spans(left)] : [spans(left), spans(right)];
          const steps = [given, wanted];
          add({ prompt: given.cell, answer: wanted.cell, direction: reverse ? 'reverse' : 'forward', kind: 'convert', process: processOf(steps),
            ...rank(scores[index], scores[index + 1]), conditions, conditionSpans, answerSpans: wantedSpans, promptSpans: givenSpans,
            columns: { prompt: [expression.classifications[reverse ? index + 1 : index]], answer: [expression.classifications[reverse ? index : index + 1]], conditions: conditionColumns },
            convert: { steps, required: [1], unitKeys: [], form: 'unit' } });
        };
        if (goesForward(separator)) unit(false);
        if (separator !== ';') unit(true);
        if (goesForward(separator)) cellVariations(index + 1, index);
        if (separator !== ';') cellVariations(index, index + 1);
        return;
      }
      // 논리 덩어리 칸이면 그 안쪽 세부 칸마다 한 번씩은 빈칸이 되도록 줄글 문제를 더한다(한 문제에 빈칸이 둘일 때도 포함)
      if (goesForward(separator)) plainCellBlanks(index + 1, index, separator);
      if (goesBackward(separator)) plainCellBlanks(index, index + 1, separator);
      const base = { prompt: expressionLabel(left), answer: expressionLabel(right), direction: 'forward' as const,
        ...rank(scores[index], scores[index + 1]), conditions, conditionSpans, answerSpans: spans(right), promptSpans: spans(left),
        columns: { prompt: [expression.classifications[index]], answer: [expression.classifications[index + 1]], conditions: conditionColumns } };
      // `;`는 충분조건(앞으로만), `<`는 역관계(거꾸로만)다. `:`·`=`는 앞으로도 거꾸로도 낸다.
      if (goesForward(separator)) add({ ...base, kind: 'direct' });
      // 오른쪽이 여러 대안(토글 아래 `<`)이면 대안 하나하나를 보고 왼쪽을 떠올린다.
      if (separator !== ';') for (const source of right.type === 'or' ? right.items : [right]) {
        add({ ...base, prompt: expressionLabel(source), answer: base.prompt, direction: 'reverse',
          kind: 'reverse', answerSpans: base.promptSpans, promptSpans: spans(source),
          columns: { ...base.columns, prompt: base.columns.answer, answer: base.columns.prompt } });
      }
      if (goesForward(separator)) partialConditions(right).forEach(({ given, remaining }) => add({ ...base, kind: 'remaining',
        answer: expressionLabel(remaining), answerSpans: spans(remaining),
        conditions: [...conditions, ...given.map(fact => `${expressionLabel(fact)} 충족`)],
        conditionSpans: [...conditionSpans, ...given.map(spans)],
        columns: { ...base.columns, conditions: [...conditionColumns, ...given.map(() => [expression.classifications[index + 1]])] },
        promptSpans: [...spans(left), ...given.flatMap(spans)] }));
    });
    // 전체 재구성·빈칸은 한 행 전체를 떠올리는 문제의 변주다. 중요도는 행에서 가장 덜 중요한 칸을 따르고, 변주는 난도에만 영향을 준다.
    if (columns.length > 2 && columns.every(nonempty)) {
      const rest = combine('and', expression.fields.slice(1));
      if (expression.separators.every(goesForward)) {
        if (convertible) convertRow(columns.map((_, index) => index), columns.map((_, index) => index).slice(1));
        else add({ prompt: expressionLabel(columns[0]), answer: expression.fields.slice(1).map(expressionLabel).join(' → '),
          direction: 'forward', kind: 'reconstruct', ...wholeRow, conditions, conditionSpans,
          columns: { prompt: [expression.classifications[0]], answer: expression.classifications.slice(1), conditions: conditionColumns },
          answerSpans: spans(rest), promptSpans: spans(columns[0]) });
      }
      // 나머지 칸을 보고 일부를 맞추는 빈칸 문제. 쉬운 것부터: 빈칸이 하나이고 단서가 많은 문제 → (빈칸을 늘리기 전에) 단서를 줄인 문제 →
      // 빈칸을 늘린 문제. 같은 조건이면 빈칸이 오른쪽일수록 어렵다. 단서를 줄일 때는 빈칸에서 먼 칸부터 가린다('…').
      const count = columns.length;
      for (let blanks = 1; blanks <= count - 2; blanks += 1) {
        for (let start = 0; start + blanks <= count; start += 1) {
          const isBlank = (index: number) => index >= start && index < start + blanks;
          const others = columns.map((column, index) => ({ column, index })).filter(item => !isBlank(item.index));
          const nearest = [...others].sort((x, y) => Math.abs(x.index - start) - Math.abs(y.index - start) || x.index - y.index);
          for (let kept = others.length; kept >= 1; kept -= 1) {
            const keep = new Set(nearest.slice(0, kept).map(item => item.index));
            const given = others.filter(item => keep.has(item.index));
            const hidden = columns.map((column, index) => ({ column, index })).filter(item => isBlank(item.index));
            const dropped = others.length - kept;
            // 문제 조건만으로 답이 정해져야 한다: 빈칸은 바로 왼쪽 칸에서 앞으로(`:`·`=`만, `;`는 앞으로 못 감) 이어 가거나,
            // 바로 오른쪽 칸에서 거꾸로(`:`·`;`·`=` 모두) 이어 갈 수 있을 때만 낸다.
            const right = start + blanks;
            const fromLeft = start > 0 && keep.has(start - 1) && expression.separators.slice(start - 1, right - 1).every(goesForward);
            const fromRight = right < count && keep.has(right) && expression.separators.slice(start, right).every(goesBackward);
            if (!fromLeft && !fromRight) continue;
            const blankStage = (blanks + dropped / others.length) / count;
            // 두 칸만 남은 변주는 단위 문제(또는 자유도로 건너뛴 결합)와 같아서 따로 내지 않는다
            if (convertible) {
              const shown = columns.map((_, index) => index).filter(index => isBlank(index) || keep.has(index));
              if (shown.length >= 3) convertRow(shown, hidden.map(item => item.index), { blankStart: start, blankStage });
            } else add({ prompt: columns.map((column, index) => isBlank(index) ? '＿' : keep.has(index) ? expressionLabel(column) : '…').join(' → '),
              answer: hidden.map(item => expressionLabel(item.column)).join(' → '), direction: 'forward', kind: 'blank',
              ...wholeRow, conditions, conditionSpans, blankStart: start, blankStage,
              columns: { prompt: given.map(item => expression.classifications[item.index]),
                answer: hidden.map(item => expression.classifications[item.index]), conditions: conditionColumns },
              answerSpans: hidden.flatMap(item => spans(item.column)), promptSpans: given.flatMap(item => spans(item.column)) });
          }
        }
      }
    } else if (columns.length === 2 && nonempty(columns[0]) && goesForward(expression.separators[0])
      && expressionLabel(expression.fields[1]) !== expressionLabel(columns[1])) {
      add({ prompt: expressionLabel(columns[0]), answer: expressionLabel(expression.fields[1]), direction: 'forward',
        kind: 'reconstruct', ...rank(scores[0], scores[1]), conditions, conditionSpans,
        columns: { prompt: [expression.classifications[0]], answer: [expression.classifications[1]], conditions: conditionColumns },
        answerSpans: spans(expression.fields[1]), promptSpans: spans(columns[0]) });
    }
    // 연결 추론: 두 걸음 이상 떨어진 칸 하나를 묻는다. 조건은 처음 칸 하나뿐이고 중간 값은 풀이 과정으로 정답과 함께 보여 준다.
    // 걸음이 많을수록 어렵고 문제 수는 줄어든다. 앞으로는 `:`·`=`로, 거꾸로는 `:`·`;`·`=`로 이어진 구간만 묻는다(괄호 안으로는 앞으로만).
    // 안쪽 관계에서 시작하는 문제는 그 관계가 따로 낸다.
    const chain = chainOf(expression, baseScore);
    for (let from = 0; from <= (convertible ? -1 : expression.fields.length - 2); from += 1) {
      for (let to = from + 2; to < chain.columns.length; to += 1) {
        const path = chain.columns.slice(from, to + 1);
        if (!path.every(nonempty)) continue;
        const labels = path.map(expressionLabel);
        const common = { ...rank(chain.scores[from], chain.scores[to]), conditions, conditionSpans, distance: to - from, kind: 'far' as const };
        const between = chain.separators.slice(from, to);
        if (between.every(goesForward)) add({ ...common, prompt: labels[0], answer: labels[labels.length - 1], process: labels.join(' → '), direction: 'forward',
          columns: { prompt: [chain.classifications[from]], answer: [chain.classifications[to]], conditions: conditionColumns },
          answerSpans: spans(path[path.length - 1]), promptSpans: spans(path[0]) });
        if (between.every(goesBackward)) {
          add({ ...common, prompt: labels[labels.length - 1], answer: labels[0], process: [...labels].reverse().join(' → '), direction: 'reverse',
            columns: { prompt: [chain.classifications[to]], answer: [chain.classifications[from]], conditions: conditionColumns },
            answerSpans: spans(path[0]), promptSpans: spans(path[path.length - 1]) });
        }
      }
    }
    // 모든 칸이 집합이 있는 칸(능력 변환)이면 칸 안의 덩어리는 위에서 변주로 냈으니 `[ ]` 글이 새는 보통 문제로 다시 내지 않는다
    // (능력 변환 줄에서도 칸 전체가 `( )`인 안쪽 관계는 그 칸을 대표하는 첫 값만 위에서 다뤘으니, 안쪽 관계는 따로 읽는다)
    expression.fields.forEach((field, index) => {
      if (convertible && field.type !== 'relation') return;
      // 칸 전체가 `( )`인 안쪽 관계도 바깥 칸 번호를 이어 간다: n번째 칸의 괄호 안 첫 값은 n번째 칸의 집합을 따른다
      if (field.type === 'relation' && implicit.length > index) implicitByExpression.set(field, implicit.slice(index));
      visit(field, index > 0
        ? [...context, { text: expressionLabel(columns[0]), columns: [expression.classifications[0]], spans: spans(columns[0]) }]
        : context, expression.classifications[index], scores[index]);
    });
  };
  /**
   * 칸 글 사이에 낀 `( )`는 적용 범위다: 안쪽 논리는 바깥과 분리된 채 안쪽 관계로 문제를 따로 만든다(`(A:B) 안녕`의 `A:B`는 `A → B`).
   * 바깥에서는 `(A:B) 안녕` 전체가 한 단어 셀이다. 칸 전체가 `( )`인 것(`X : (A:B)`)은 위에서 이미 풀어 읽으므로 여기서 다시 내지 않는다.
   * 논리는 분리되지만 위치는 분리되지 않는다: `( )` 안은 `( )`가 놓인 자리에 들어간 내용이 기본이다(따로 쓰지 않는다).
   *  - 놓인 자리 = 줄 앞 집합 + 위쪽 토글 제목이 그 칸 번호에 이어 주는 집합 + 칸 앞 `[ ]`.
   *  - 안쪽의 `:`는 바깥 칸 번호를 이어 간다: 괄호가 n번째 칸에 있으면 안쪽 첫 값은 n번째 칸의 집합, `:` 뒤 값은 n+1번째 칸(그다음은 n+2번째 …)의 집합이다.
   *    그 칸이 바깥 줄에 있으면 그 칸 앞 `[ ]`도 함께 따른다.
   * `sets`는 이 글이 놓인 칸부터의 칸별 집합들, `scope`는 줄 전체의 범위 집합이다.
   */
  const columnSetsOf = (fields: Expression[], implicit: string[][]): string[][] => [
    ...fields.map((field, index) => [...(implicit[index] ?? []), ...(readCell(field)?.sets ?? [])]),
    ...implicit.slice(fields.length)
  ];
  /** `column`: 이 글이 놓인 칸 번호. `( )` 안의 첫 값은 그 칸, `:` 뒤는 그다음 칸들이다(분류기준 이름도 이어서 센다). */
  const visitGroups = (expression: Expression, node: QuestionNoteNode, scope: string[], sets: string[][], column = offsetByNode.get(node.id) ?? 0) => {
    if (expression.type === 'relation') {
      const own = columnSetsOf(expression.fields, sets);
      expression.fields.forEach((field, index) => {
        const placed = expression.classifications[index];
        visitGroups(field, node, scope, own.slice(index), typeof placed === 'number' ? placed : column);
      });
      return;
    }
    if (expression.type !== 'text') { expression.items.forEach(item => visitGroups(item, node, scope, sets, column)); return; }
    const { start, end } = expression.span;
    const source = titleSource(node);
    // `@`를 풀어 바꾼 칸은 글자 범위가 원문과 달라서 안쪽을 따로 읽지 않는다
    if (source.slice(start, end) !== (expression.raw ?? expression.text)) return;
    const closed = reviewGroups(source).closed;
    for (let index = start; index < end; index += 1) {
      if (source[index] === '[') { const close = closed.get(index); if (close !== undefined) index = close; continue; }
      if (source[index] !== '(') continue;
      const close = closed.get(index);
      if (close === undefined || close >= end) continue;
      // 괄호 안의 `:`는 위쪽 분류기준과 이어지지 않는다(18:16 규칙)
      const inner = parseExpression(source, node.id, index + 1, close, new Map(), DETACHED_COLUMN);
      if (inner.type !== 'text') {
        const { expression: scopedInner, scope: innerScope } = scopeOf(inner, sets);
        const scoped = labelLoneSets(scopedInner, sets);
        if (scoped.type === 'relation' && sets.some(item => item.length)) implicitByExpression.set(scoped, sets);
        const fields = scoped.type === 'relation' ? convertFieldsOf(scoped.fields.map(head), sets) : [];
        // 모든 안쪽 칸에 집합이 있으면 집합은 칸마다 단위 문제에 들어가고, 아니면 놓인 자리의 집합을 조건으로 준다
        const placed = joinSets(fields.length >= 2 && fields.every(Boolean) ? scope : [...scope, ...(sets[0] ?? [])]);
        visit(scoped, [...ancestorConditions(node), ...(placed ? [{ text: placed, columns: [], spans: [] }] : []),
          ...(innerScope ? [{ text: innerScope, columns: [], spans: [] }] : [])]);
      }
      visitGroups(inner, node, scope, sets, column);
      index = close;
    }
  };
  /**
   * 줄 맨 앞의 `[ ]`는 그 줄 전체가 놓인 집합이다: `[a] X:y` · `[a] X=y` · `[a] X-y`는 a 안에서 X와 y가 이어진다는 뜻이라,
   * 문제 글에는 `[a]`를 적지 않고 a를 조건으로 준다. 모든 칸에 집합이 따로 있으면(`[a] b ; [c] d`) 칸마다 자기 집합이라 그대로 둔다.
   * 모든 칸에 집합이 있는 순서(`[a] b - [c] d`)는 분류기준 없는 `;`처럼 읽는다.
   */
  const scopeOf = (expression: Expression, implicit: string[][]): { expression: Expression; scope?: string } => {
    if ((expression.type === 'sequence' || expression.type === 'equal') && expression.items.length >= 2
      && expression.items.every(item => (readCell(item)?.sets.length ?? 0) > 0)) {
      // 모든 칸에 집합이 있는 `-`는 분류기준 없는 `;`, `=`는 분류기준 없는 `:`다
      return { expression: { type: 'relation', fields: expression.items, separators: expression.items.slice(1).map(() => (expression.type === 'equal' ? ':' : ';')),
        classifications: expression.items.map((_, index) => (index === 0 ? 0 : '')) } };
    }
    if (expression.type !== 'relation' && expression.type !== 'sequence' && expression.type !== 'equal') return { expression };
    const sets = leadingSetsOf(expression);
    if (!sets.length) return { expression };
    if (expression.type === 'relation') {
      const fields = convertFieldsOf(expression.fields.map(head), implicit);
      if (fields.length >= 2 && fields.every(Boolean)) return { expression };
    }
    return { expression: mapFirstLeaf(expression, text => readConvertCell(text)?.cell ?? text), scope: joinSets(sets) };
  };
  /**
   * 위쪽 분류기준도 없고 모든 칸에 집합도 없는 줄에서 뒤 칸 하나에만 `[기능] 보호`처럼 `[ ]`를 쓰면(18:36 결정),
   * 그 `[ ]`는 글자가 아니라 그 칸의 위치(칸 이름)다: `세포 : (막 : [기능] 보호)` → ‘막’에 이어지는 기능 값은? (답 `보호`).
   * 첫 칸만의 `[a]`는 scopeOf가 조건으로 주고, 모든 칸에 집합이 있으면 능력 변환이라 여기 오지 않는다.
   */
  const labelLoneSets = (expression: Expression, implicit: string[][]): Expression => {
    if (expression.type !== 'relation') return expression;
    const fields = convertFieldsOf(expression.fields.map(head), implicit);
    if (fields.length >= 2 && fields.every(Boolean)) return expression;
    let changed = false;
    const classifications = [...expression.classifications];
    const mapped = expression.fields.map((field, index) => {
      // 칸 전체가 `( )`인 안쪽 관계(`세포 : (막 : [기능] 보호)`)도 같은 규칙
      if (field.type === 'relation') { const nested = labelLoneSets(field, []); if (nested !== field) changed = true; return nested; }
      if (index === 0 || !nonempty(field)) return field;
      const read = readCell(head(field));
      const own = read?.sets.filter(set => !looksLikeCriterion(set)) ?? [];
      if (!read || !own.length) return field;
      changed = true;
      classifications[index] = own.join('.');
      return mapFirstLeaf(field, text => readConvertCell(text)?.cell ?? text);
    });
    return changed ? { ...expression, fields: mapped, classifications } : expression;
  };
  // `[집합(1)] : [집합(2)]`: 집합(1)의 하위값과 집합(2)의 하위값이 나란히 이어진 줄은 칸 앞에 `[ ]`를 쓰지 않아도 그 집합 안의 값으로 읽는다.
  const setLinks = setLinksOf(memo);
  const linkedSetsOf = (expression: Expression, implicit: string[][]): string[][] => {
    if (!setLinks.length || expression.type !== 'relation') return implicit;
    const keys = expression.fields.map(field => {
      const read = nonempty(field) ? readCell(head(field)) : null;
      return read && !read.sets.length ? normSetName(read.cell) : null;
    });
    const result = expression.fields.map((_, position) => [...(implicit[position] ?? [])]);
    const put = (position: number, name: string) => { if (!result[position].includes(name)) result[position].push(name); };
    setLinks.forEach(link => keys.slice(1).forEach((right, offset) => {
      const left = keys[offset];
      if (left === null || right === null) return;
      if (link.leftMembers.has(left) && link.rightMembers.has(right)) { put(offset, link.left); put(offset + 1, link.right); }
      else if (link.rightMembers.has(left) && link.leftMembers.has(right)) { put(offset, link.right); put(offset + 1, link.left); }
    }));
    return result.some((sets, position) => sets.length !== (implicit[position] ?? []).length) ? result : implicit;
  };
  nodes.forEach(node => {
    const context = ancestorConditions(node);
    const nodeImplicit = implicitSetsOf(node);
    (expressions.get(node.id) || []).forEach(original => {
      const implicit = linkedSetsOf(original, nodeImplicit);
      const { expression: scopedExpression, scope } = scopeOf(original, implicit);
      const expression = labelLoneSets(scopedExpression, implicit);
      if (implicit.length && expression.type === 'relation') implicitByExpression.set(expression, implicit);
      // 줄 앞 `[할로젠]`이 바로 위 토글 이름과 같으면 조건을 한 번만 준다(`‘할로젠’, ‘할로젠’에서` 방지)
      const repeated = scope && context.length > 0 && normSetName(context[context.length - 1].text) === normSetName(scope);
      visit(expression, scope && !repeated ? [...context, { text: scope, columns: [], spans: [] }] : context, offsetByNode.get(node.id) ?? 0);
      visitGroups(original, node, scope ? [scope] : [], original.type === 'relation' ? implicit : [readCell(original)?.sets ?? []]);
    });
  });
  if (!questions.length && memo.trim()) {
    // `[!]`에 걸린 줄·토글은 노트 회상에서도 뺀다
    const blockedIds = new Set<string>();
    nodes.forEach(node => { if (node.type === 'toggle' ? (isLogicToggleTitle(node.text) || (node.parentId !== null && blockedIds.has(node.parentId))) : (node.parentId !== null && blockedIds.has(node.parentId))) blockedIds.add(node.id); });
    const kept = nodes.filter(node => !blockedIds.has(node.id)).map(node => ({ node, text: node.type === 'toggle' ? node.text : node.text.split('\n').filter(line => !hasLogicMark(line)).join('\n') }));
    const text = kept.map(item => item.text).join('\n');
    if (text.trim()) questions.push({ key: 'note', prompt: '정리노트', answer: text, kind: 'recall', level: 1, priority: 1, importance: 0,
      direction: 'forward', conditions: [], conditionSpans: [], recallUnits: 0, providedUnits: 0, difficulty: 0,
      columns: { prompt: [], answer: [], conditions: [] },
      answerSpans: kept.filter(item => item.text.trim()).map(item => ({ nodeId: item.node.id, start: 0, end: item.node.text.length })), promptSpans: [] });
  }
  questions.forEach(question => {
    const nodeId = question.answerSpans[0]?.nodeId ?? question.promptSpans[0]?.nodeId;
    const scoped = nodeId ? criterionByNode.get(nodeId) : undefined;
    if (scoped) question.criterion = scoped;
    // 칸 왼쪽에 쓴 `[A:B;C]`는 그 오른쪽 값에 적용되는 분류기준이라, 토글·노트 전체 기준보다 가까운 쪽이 우선한다
    const span = question.answerSpans[0] ?? question.promptSpans[0];
    const line = span ? lineCriteria.find(item => item.nodeId === span.nodeId && span.start >= item.start && span.start < item.end) : undefined;
    if (line) question.criterion = line.criterion;
  });
  // 능력 정의 `[동물]:[개념:정의]`의 둘째 칸은 그 집합 안 셀들의 위치(분류기준)다: 칸 이름은 위치에서 오므로, 다른 기준이 없는 문제에 이 기준을 붙인다.
  if (/\]\s*:\s*\[/.test(memo)) {
    const abilityByQuestion = new Map(questions.filter(question => !question.criterion && !question.convert && question.kind !== 'recall')
      .map(question => [question, questionAbilities(question, nodes, [memo])] as const));
    abilityByQuestion.forEach((abilities, question) => {
      const criteria = [...new Set(abilities.map(ability => ability.criterion))];
      if (criteria.length === 1 && looksLikeCriterion(criteria[0])) question.criterion = criteria[0];
    });
  }
  questions.forEach(question => Object.assign(question, calculateReviewQuestionDifficulty(question.answerSpans,
    [...question.promptSpans, ...question.conditionSpans.flat()])));
  // 같은 문제가 또 있던 줄의 글자 범위도 가림에 쓰이도록 합친다(난도는 위에서 한 줄 기준으로 이미 계산했다)
  duplicateSpans.forEach(({ answerSpans, promptSpans }, question) => {
    question.answerSpans.push(...answerSpans);
    question.promptSpans.push(...promptSpans);
  });
  // 능력 변환의 단위 문제는 자기 key가 곧 일정이 붙는 단위다
  questions.forEach(question => { if (question.convert) question.convert.unitKeys = [question.key]; });
  questions.forEach(question => { if (question.blankStage !== undefined) question.difficulty = question.blankStage; });
  // 연결 추론은 중간 값도 머릿속으로 거쳐야 하므로, 정답 하나에 걸음 수만큼을 떠올려야 한다: 걸음이 많을수록 어렵다.
  questions.forEach(question => {
    if (question.kind !== 'far' || !question.distance) return;
    question.recallUnits = question.distance;
    question.difficulty = question.distance / (question.distance + question.providedUnits);
  });
  for (const priority of new Set(questions.map(question => question.priority))) {
    const group = questions.filter(question => question.priority === priority).sort(compareReviewQuestionDifficulty);
    const signature = (question: NoteQuestion) => `${question.difficulty}:${question.recallUnits}:${question.providedUnits}:${question.blankStart ?? 0}`;
    const ranks = [...new Set(group.map(signature))];
    group.forEach(question => { question.level = Math.min(3, Math.floor(ranks.indexOf(signature(question)) * 3 / ranks.length) + 1); });
  }
  // 가장 기본적인 사실(이웃한 두 값을 한 걸음으로 묻고 답이 하나인 문제, 변환 단위)은 언제나 1단계다(19:09 규칙: 기본 사실이 가장 높은 중요도).
  // 상대 3등분만 쓰면 토글 밖 `c:d`처럼 힌트(조건)가 적은 줄이 "더 어렵다"며 2단계로 밀려 1단계 복습에서 빠진다.
  questions.forEach(question => {
    const basic = (['direct', 'reverse', 'order-next', 'order-previous'].includes(question.kind) && question.recallUnits <= 1)
      || (question.kind === 'convert' && question.convert?.form === 'unit' && !question.convert.variation);
    if (basic) question.level = 1;
  });
  assignPairBundles(questions, expressions);
  questions.sort((a, b) => a.priority - b.priority || a.importance - b.importance || compareReviewQuestionDifficulty(a, b));
  // 구조로 낸 문제 글은 문제집처럼 문장으로 바꾼다(이미 줄글인 빈칸 · 노트 회상 · 능력 변환 카드는 그대로)
  questions.forEach(question => {
    if (question.statement) return;
    const prose = proseOf(question);
    if (!prose) return;
    question.statement = prose.statement;
    if (prose.solution) question.solution = prose.solution;
  });
  return { questions, nodes };
}

export const REVIEW_QUESTION_KIND_LABELS: Record<NoteQuestion['kind'], string> = {
  direct: '기본 관계', reverse: '역방향', remaining: '남은 조건', reconstruct: '전체 재구성', recall: '노트 회상', blank: '빈칸 채우기', far: '연결 추론',
  'order-next': '다음 순서', 'order-previous': '이전 순서', 'order-reconstruct': '순서 재구성', convert: '능력 변환'
};

/**
 * `#` 틀 줄과 `{A}` 자리 줄이 펼쳐 만든 줄들(관계도가 쓴 줄 아래에 보여 주기 위해). 쓴 칸 글(앞뒤 공백 없이) → 만든 줄들(만든 순서, 중복 없음).
 * 문제 만들기와 같은 펼침이라 관계도와 문제가 어긋나지 않는다.
 */
export const generatedLinesOf = (memo: string): Map<string, string[]> => {
  const result = new Map<string, string[]>();
  if (!/[#{]/.test(memo)) return result;
  const { questions, nodes } = buildReviewQuestions(memo);
  const byId = new Map(nodes.map(node => [node.id, node]));
  questions.forEach(question => {
    [...question.promptSpans, ...question.answerSpans, ...question.conditionSpans.flat()].forEach(span => {
      if (!span.generated) return;
      const node = byId.get(span.nodeId);
      if (!node) return;
      const key = node.text.slice(span.start, span.end).trim();
      const lines = result.get(key) ?? [];
      if (!lines.includes(span.generated)) lines.push(span.generated);
      result.set(key, lines);
    });
  });
  return result;
};
