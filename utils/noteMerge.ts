import { readReviewFieldOverride, reviewGroups } from './reviewFieldOverride';
import { isReviewSlash } from './reviewSlash';
import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { blankTitleCriteria, noteCriterionOf, parseCriterionLabels, splitTitleCriteria, topLevelCuts } from './noteDiagram';
import { isNoteShorthandOn, relationMarks, trailingRelation, weakLink } from './noteShorthand';
import { reviewQuotes } from './reviewQuote';
import { matchingBracket } from './setExpression';
import { openTailOf } from './noteOpenTail';

/**
 * 연결·첨가 합치기.
 *
 * 나중 페이지에 쓴 줄(S)이 이전 페이지의 같은 속성(토글 경로) 안에 있는 줄(E)과 이름이 겹치면 E에 합친다.
 *  - 겹치는 칸이 둘 이상이면 "연결": S의 새 칸을 겹친 칸 뒤에 이어 붙인다(뒤에 이미 칸이 있으면 같은 자리의 `=`로).
 *  - 겹치는 칸이 S의 맨 앞 하나뿐이면 "첨가": 같은 칸의 `=`로 붙이고(칸이 둘 이상이면 `=(B:C)`), 분류 기준 `[ ]`을 붙여 쓴 칸은 새 `:` 칸으로 붙인다.
 *    겹친 칸이 E의 맨 앞이 아니면 그 칸을 `(D:K)`로 묶는다(앞에서 K로만 갈 수 있다).
 *  - `,` 목록은 합집합, `-` 순서는 겹친 앞부분 뒤로 이어 붙인다.
 *  - 한 칸 안의 논리어(`,` `-` `=`)로 이은 낱말도 그 칸과 똑같이 겹침으로 본다: S의 맨 앞 칸이 E의 한 칸 안 낱말과 같으면 그 낱말을 `(C:D)`로 묶어 잇는다.
 *    칸 전체와 겹치는 합치기가 있으면 그쪽이 먼저다.
 * 겹치는 칸은 칸 번호(분류기준 위치)가 같아야 한다: 칸 번호는 줄 안에서 `:` `;` `<`를 센 번호이고, 같은 기호를 붙여 쓴 `::` `;;` `<<`는 칸 하나를 건너뛴다.
 *  - 쓴 칸마다 번호가 같으면 줄 전체를 다 쓰지 않아도 된다: E `[A] B:[D] C`에 S `[A] B:[D] C:[K] L`도, S `[A:D] B :: [K] L`도 `[A] B:[D] C:[K] L`이 된다.
 *  - 이름은 같은데 칸 번호가 다르면(E `a:b:c`의 c는 3번째, S `a:c:d`의 c는 2번째) 합치지 않는다. 줄의 맨 앞 칸만 어느 칸이든 겹칠 수 있다(아래 묶기).
 * 이미 들어 있는 글(S의 모든 칸이 E에 있음)은 바꾸지 않는다: 같은 글을 다시 합쳐도 결과가 같다.
 * 위치가 같아야 합친다(21:09 "위치가 같아야 합치는 건데 분류기준도 위치에 해당되는 값이야"):
 *  - 토글 경로가 같아야 하고, 겹치는 칸은 칸의 위치(그 칸 번호의 분류기준 칸 이름 · 칸에 붙인 `[ ]` · `:{이름}`)도 같아야 한다.
 *    분류기준은 가까운 것부터 줄 앞 `[개념:정의]` → 토글 제목의 기준 → 노트 맨 위 기준이다. 한쪽에만 기준이 있어도 위치가 다르다.
 *  - `=`로 같은 칸에 붙일 때도 그 칸의 위치가 같아야 한다(`[인물:업적] 세종:한글`에 `[인물:출생] 세종:1397년`은 합치지 않는다).
 *  - 새로 붙는 칸이 E에서 다른 칸 이름을 받게 되거나 `( )` 안으로 들어가 이름을 잃으면 원래 이름을 `:{이름}`으로 적어 위치를 그대로 둔다.
 */
export type NoteMergeKind = 'link' | 'add' | 'group';

/**
 * labels: 줄 앞에 기준이 없을 때 이 줄의 칸 번호마다 이어받은 칸 이름(토글 제목 · 노트 맨 위 분류기준, 열린 제목의 칸 수만큼 당긴 것).
 */
export interface NoteStatement { line: number; start: number; end: number; text: string; path: string[]; labels?: string[] }

/** 합칠 때 칸의 위치를 비교하는 바깥 정보. null이면 위치를 보지 않는다(같은 줄에서 만든 글을 다시 합칠 때). */
export interface MergePositions {
  existing?: readonly string[];
  incoming?: readonly string[];
  /** 가장 안쪽 토글 이름: 줄 앞 `[이름]`이 이것과 같으면 따로 쓴 위치가 아니다 */
  existingScope?: string;
  incomingScope?: string;
}
export interface MergeSource { id: string; memo: string }
export interface MergeUpdate {
  logId: string;
  before: string;
  after: string;
  steps: { statement: string; kind: NoteMergeKind }[];
}

/** 비교용 글: 공백을 뺀다. 영문 대소문자는 구별한다(`Co` 코발트와 `CO` 일산화탄소가 다르다 — 대소문자를 같게 볼지는 결정이 필요). */
const norm = (text: string) => text.replace(/\s+/g, '');
const CRITERION_PREFIX = /^(\[[^\]\n]*\]\s*)+/;
const stripCriterion = (text: string) => text.trim().replace(CRITERION_PREFIX, '');
const hasCriterion = (text: string) => CRITERION_PREFIX.test(text.trim());
const nameOf = (field: string) => norm(stripCriterion(field));

/** 칸 글 맨 앞의 `[ ]`들(안쪽에 `[ ]`가 겹쳐도 짝이 맞는 것 하나씩) */
const leadingMarks = (field: string): string[] => {
  let rest = field.trim();
  const marks: string[] = [];
  for (let end = matchingBracket(rest, 0); end > 0; end = matchingBracket(rest, 0)) {
    marks.push(rest.slice(1, end).trim());
    rest = rest.slice(end + 1).trimStart();
  }
  return marks.filter(Boolean);
};
/** 분류기준 `[개념:정의]`인 `[ ]` 안 글인가(칸이 둘 이상이고 집합식이 아니다) */
const isCriterionMark = (mark: string) => topLevelCuts(mark, ':;<').length > 0 && !/[\[\]().,%]/.test(mark);
/** 줄 앞 칸의 분류기준(안쪽 글) */
const headCriterionOf = (chain: Chain) => leadingMarks(chain.fields[0]).filter(isCriterionMark).at(-1);
/** 칸 j가 스스로 적은 위치: 붙인 `[ ]`(기준이 아닌 것), 그다음 연결어 뒤 `{이름}`. 없으면 undefined. */
const ownPositionOf = (chain: Chain, j: number, scope?: string): string | undefined => {
  const own = leadingMarks(chain.fields[j]).filter(mark => !isCriterionMark(mark) && !(j === 0 && scope && norm(mark) === norm(scope)));
  if (own.length) return own.join('.');
  const override = j > 0 ? /\{([^{}\n]*)\}/.exec(chain.seps[j - 1] ?? '')?.[1]?.trim() : undefined;
  return override || undefined;
};
/** 칸 번호 col의 기준 칸 이름: 줄 앞 기준(또는 늘어난 기준)이 있으면 그것, 없으면 이어받은 이름 */
const columnLabelsOf = (chain: Chain, inherited: readonly string[] | undefined, criterion = headCriterionOf(chain)) => {
  const labels = criterion ? parseCriterionLabels(criterion) : inherited ?? [];
  return (col: number) => (labels[col] ?? '').trim();
};
const samePosition = (a: string, b: string) => norm(a) === norm(b);
/** 연결어에 칸 이름 `{이름}`을 붙인다(이미 이름이 있으면 그대로) */
const namedSeparator = (sep: string, label: string) => (label && !/\{[^{}\n]*\}/.test(sep) ? `${sep}{${label}}` : sep);

/** cols: 칸 번호(맨 앞 칸 0). 같은 기호를 붙여 쓴 `::`는 칸 하나를 건너뛰어 다음 칸의 번호가 둘 늘어난다. */
interface Chain { fields: string[]; seps: string[]; cols: number[] }

/** 붙여 쓴 같은 연결어의 길이(`::` → 2). 뒤에 붙은 `{이름}`은 세지 않는다. */
const runLength = (sep: string) => {
  let count = 0;
  while (count < sep.length && sep[count] === sep[0]) count += 1;
  return count;
};
/** 연결어를 `columns`칸 건너가는 길이로 다시 쓴다(같은 기호, 최소 1). */
const retimeSeparator = (sep: string, columns: number) => `${sep[0].repeat(Math.max(1, columns))}${sep.slice(runLength(sep))}`;

/** 관계 기호(`: ; <`)로 자른다(`=`는 칸 안의 논리어라 자르지 않는다). `:`/`;` 바로 뒤 `{이름}`은 기호의 일부로 둔다. */
export const parseNoteChain = (text: string): Chain => {
  const cuts = topLevelCuts(text, relationMarks());
  if (!cuts.length) return { fields: [text.trim()], seps: [], cols: [0] };
  const fields: string[] = [text.slice(0, cuts[0]).trim()];
  const seps: string[] = [];
  const cols: number[] = [0];
  let run = 1;
  cuts.forEach((cut, index) => {
    // 붙여 쓴 같은 기호(`::`)는 마지막 기호에서 칸을 자르고, 앞의 기호만큼 칸을 건너뛴다
    if (index + 1 < cuts.length && cuts[index + 1] === cut + 1 && text[cut + 1] === text[cut]) { run += 1; return; }
    const end = index + 1 < cuts.length ? cuts[index + 1] : text.length;
    const override = readReviewFieldOverride(text, cut + 1, end);
    seps.push(`${text[cut].repeat(run)}${override ? text.slice(override.start, override.end) : ''}`);
    fields.push(text.slice(override ? override.end : cut + 1, end).trim());
    cols.push(cols[cols.length - 1] + run);
    run = 1;
  });
  while (fields.length > 1 && !fields[fields.length - 1]) { fields.pop(); seps.pop(); cols.pop(); }
  return { fields, seps, cols };
};

const chainText = (chain: Pick<Chain, 'fields' | 'seps'>) => chain.fields.reduce((text, field, index) => (index === 0 ? field : `${text}${chain.seps[index - 1]}${field}`), '');

const splitTop = (text: string, delimiter: string): string[] => {
  // 단축어를 끄면 `-`와 `=`는 논리어가 아니라 글자라서 자르지 않는다
  if ((delimiter === '-' || delimiter === '=') && !isNoteShorthandOn()) return [text.trim()];
  const cuts = topLevelCuts(text, delimiter);
  const bounds = [-1, ...cuts, text.length];
  return bounds.slice(1).map((end, index) => text.slice(bounds[index] + 1, end).trim());
};

/** 칸 안의 낱말들(괄호로 묶은 칸은 안쪽까지, `,`·`-`로 나뉜 칸은 낱낱이) */
const atomsOf = (field: string): string[] => {
  const text = stripCriterion(field);
  if (/^\(.*\)$/.test(text) && text.length > 2) {
    const inner = text.slice(1, -1);
    return parseNoteChain(inner).fields.flatMap(atomsOf);
  }
  // `,`·`-`·`=`로 나뉜 낱말이 괄호 묶음이면 그 안쪽 낱말까지 푼다(`R=(B:C)`의 B·C)
  return splitTop(text, ',').flatMap(part => splitTop(part, '-')).flatMap(part => splitTop(part, '='))
    .flatMap(part => (/^\(.*\)$/.test(part) && part.length > 2 ? atomsOf(part) : groupedAtoms(part) ?? [norm(part)])).filter(Boolean);
};
/** 글 사이에 낀 `( )`(`(A:B) 안녕`)가 있는 낱말: 괄호 안의 낱말들과 괄호를 뺀 나머지 글이 모두 이 칸의 낱말이다. 괄호가 없으면 null. */
const groupedAtoms = (part: string): string[] | null => {
  const closed = reviewGroups(part).closed;
  const atoms: string[] = [];
  let rest = '';
  let cursor = 0;
  for (let at = 0; at < part.length; at += 1) {
    if (part[at] === '[') { const bracket = closed.get(at); if (bracket !== undefined) at = bracket; continue; }
    const close = part[at] === '(' ? closed.get(at) : undefined;
    if (close === undefined) continue;
    atoms.push(...atomsOf(part.slice(at, close + 1)));
    rest += part.slice(cursor, at);
    cursor = close + 1;
    at = close;
  }
  if (!cursor) return null;
  rest += part.slice(cursor);
  return [...atoms, ...(norm(rest) ? [norm(rest)] : [])];
};
const chainAtoms = (chain: Chain) => chain.fields.flatMap(atomsOf);

const joinList = (items: string[], like: string, delimiter: string) => (
  items.join(delimiter === ',' && /,\s/.test(like) ? ', ' : delimiter)
);

/** 같은 자리의 두 칸을 한 칸으로: `,` 목록과 `=`로 이은 값은 합집합, `-` 순서는 겹친 앞부분 뒤로 이어 붙인다. 합칠 수 없으면 null, 이미 들어 있으면 같은 글. */
const mergeField = (existing: string, incoming: string): string | null => {
  const eItems = splitTop(existing, ',');
  const sItems = splitTop(incoming, ',');
  if (eItems.length > 1 || sItems.length > 1) {
    if (!sItems.some(item => eItems.some(other => norm(other) === norm(item)))) return null;
    const added = sItems.filter(item => !eItems.some(other => norm(other) === norm(item)));
    return added.length ? joinList([...eItems, ...added], existing, ',') : existing;
  }
  const eSeq = splitTop(existing, '-');
  const sSeq = splitTop(incoming, '-');
  if (eSeq.length < 2 && sSeq.length < 2) {
    // `=`로 이은 값(칸 안의 같음)도 같은 자리면 하나로 합친다
    const eEq = splitTop(existing, '=');
    const sEq = splitTop(incoming, '=');
    if (eEq.length < 2 && sEq.length < 2) return null;
    if (!sEq.some(item => eEq.some(other => norm(other) === norm(item)))) return null;
    const addedEq = sEq.filter(item => !eEq.some(other => norm(other) === norm(item)));
    return addedEq.length ? joinList([...eEq, ...addedEq], existing, '=') : existing;
  }
  let prefix = 0;
  while (prefix < eSeq.length && prefix < sSeq.length && norm(eSeq[prefix]) === norm(sSeq[prefix])) prefix += 1;
  if (prefix < 1) return null;
  const rest = sSeq.slice(prefix).filter(item => !eSeq.some(other => norm(other) === norm(item)));
  return rest.length ? joinList([...eSeq, ...rest], existing, '-') : existing;
};

/**
 * from번째 칸부터 끝까지를 한 덩어리로(`(B:C)`). `( )` 안의 `:`는 위의 기준과 이어지지 않으므로(18:16),
 * 위치 이름이 있던 안쪽 칸은 연결어에 `{이름}`을 붙여 그 이름을 그대로 둔다(positions[j]: 칸 j의 위치, 스스로 적은 것은 이미 글에 있다).
 */
const wrapTail = (chain: Chain, from: number, carry?: (j: number) => string): string => {
  const seps = chain.seps.slice(from).map((sep, offset) => (carry ? namedSeparator(sep, carry(from + offset + 1)) : sep));
  const tail = { fields: chain.fields.slice(from), seps };
  return tail.fields.length > 1 ? `(${chainText(tail)})` : tail.fields[0];
};

export interface ChainMerge { text: string; kind: NoteMergeKind; overlap: number }

/** 한 칸 안의 논리어: 단축어를 끄면 `-`·`=`는 글자라서 `,`만 남는다 */
const cellDelimiters = () => (isNoteShorthandOn() ? ',-=' : ',');

/**
 * S의 맨 앞 칸이 E의 어느 칸 안 낱말(`B,C`의 C · `p-q`의 q · `F=G`의 G)과 같고 칸 전체와는 겹치지 않을 때:
 * 그 낱말 하나만 `(C:D)`로 묶어 S의 나머지를 잇는다. 같은 낱말이 둘 이상이면 어디인지 알 수 없어 합치지 않는다.
 */
const mergeIntoCell = (e: Chain, s: Chain, existingText: string, fieldFits: (field: number) => boolean = () => true,
  carry?: (j: number) => string): ChainMerge | null => {
  const head = nameOf(s.fields[0]);
  if (!head || hasCriterion(s.fields[0])) return null;
  const hits: { field: number; start: number; end: number }[] = [];
  /**
   * 한 칸(또는 `( )` 안쪽)에서 head와 같은 낱말의 글자 범위를 모은다. `( )` 묶음 안은 `:` `;` `<`로 나뉜 값도 낱말이다(`A:(B,C)`의 B).
   * 묶음 안 전체가 그 낱말이면 괄호까지 한 덩어리로 본다(`(B)` → `(B:D)`).
   */
  const collect = (field: string, offset: number, group?: { start: number; end: number }) => {
    const delimiters = group ? `${cellDelimiters()}${relationMarks()}` : cellDelimiters();
    const cuts = topLevelCuts(field, delimiters);
    const bounds = [-1, ...cuts, field.length];
    const edges = reviewQuotes(field).edges;
    const closed = reviewGroups(field).closed;
    bounds.slice(1).forEach((end, order) => {
      // 따옴표 `'…'` 칸 가장자리의 따옴표 글자는 낱말이 아니다.
      let start = bounds[order] + 1;
      let stop = end;
      while (start < stop && (/\s/.test(field[start]) || edges.has(start))) start += 1;
      while (stop > start && (/\s/.test(field[stop - 1]) || edges.has(stop - 1))) stop -= 1;
      if (start >= stop) return;
      if (field[start] === '(' && closed.get(start) === stop - 1) {
        collect(field.slice(start + 1, stop - 1), offset + start + 1, { start: offset + start, end: offset + stop });
        return;
      }
      // 글 사이에 낀 `( )`(`(A:B) 안녕`)도 같은 칸 같은 위치의 값이라서 안쪽 낱말을 그 칸의 낱말과 똑같이 본다
      for (let at = start; at < stop; at += 1) {
        if (field[at] === '[') { const bracket = closed.get(at); if (bracket !== undefined) at = bracket; continue; }
        const close = field[at] === '(' ? closed.get(at) : undefined;
        if (close === undefined || close >= stop) continue;
        collect(field.slice(at + 1, close), offset + at + 1, { start: offset + at, end: offset + close + 1 });
        at = close;
      }
      // 맨 위 칸이 낱말 하나뿐이면 칸 전체와 겹치는 합치기가 먼저 읽는다
      if (!group && !cuts.length) return;
      if (norm(field.slice(start, stop)) !== head) return;
      const whole = group && cuts.length === 0;
      hits.push({ field: fieldIndexNow, start: whole ? group.start : offset + start, end: whole ? group.end : offset + stop });
    });
  };
  let fieldIndexNow = 0;
  e.fields.forEach((field, fieldIndex) => {
    fieldIndexNow = fieldIndex;
    // 그 낱말이 든 칸의 위치가 S 맨 앞 칸의 위치와 같아야 한다
    if (fieldFits(fieldIndex)) collect(field, 0);
  });
  if (hits.length !== 1) return null;
  const hit = hits[0];
  const sepAt = (j: number) => (carry ? namedSeparator(s.seps[j - 1], carry(j)) : s.seps[j - 1]);
  const tail = s.fields.slice(1).reduce((text, field, offset) => (offset === 0 ? field : `${text}${sepAt(offset + 1)}${field}`), '');
  const group = `(${s.fields[0].trim()}${sepAt(1)}${tail})`;
  const fields = [...e.fields];
  fields[hit.field] = `${fields[hit.field].slice(0, hit.start)}${group}${fields[hit.field].slice(hit.end)}`;
  const text = chainText({ fields, seps: e.seps });
  // 칸 전체와 겹치는 합치기(1 이상)보다 뒤에 오도록 겹침을 0.5로 둔다
  return text === existingText.trim() ? null : { text, kind: 'group', overlap: 0.5 };
};

/** S의 모든 낱말이 E에 이미 있고 맨 앞 칸 이름도 같은가(같은 글을 다시 쓴 것). 이 경우 S는 다른 줄에 합치지 않는다. */
export const noteChainContains = (existingText: string, incomingText: string, positions: MergePositions | null = {}): boolean => {
  const e = parseNoteChain(existingText);
  const s = parseNoteChain(incomingText);
  if (e.fields.length < 2 || s.fields.length < 2) return false;
  if (!nameOf(s.fields[0]) || nameOf(e.fields[0]) !== nameOf(s.fields[0])) return false;
  // 맨 앞 칸의 위치가 다르면 같은 글이 아니다(다른 자리에 쓴 같은 낱말)
  if (positions && !samePosition(ownPositionOf(e, 0, positions.existingScope) ?? columnLabelsOf(e, positions.existing)(0),
    ownPositionOf(s, 0, positions.incomingScope) ?? columnLabelsOf(s, positions.incoming)(0))) return false;
  const eAtoms = new Set(chainAtoms(e));
  return chainAtoms(s).every(atom => eAtoms.has(atom));
};

/**
 * E에 S를 합친 결과. 합칠 수 없거나 바꿀 것이 없으면 null.
 * positions: 칸의 위치를 비교할 바깥 정보(이어받은 칸 이름 · 토글 이름). 생략하면 줄에 쓴 것(줄 앞 기준 · 칸의 `[ ]` · `:{이름}`)만 본다. null이면 위치를 보지 않는다.
 */
export const mergeNoteChains = (existingText: string, incomingText: string, positions: MergePositions | null = {}): ChainMerge | null => {
  const e = parseNoteChain(existingText);
  const s = parseNoteChain(incomingText);
  if (e.fields.length < 2 || s.fields.length < 2) return null;
  const eAtoms = new Set(chainAtoms(e));
  if (chainAtoms(s).every(atom => eAtoms.has(atom))) return null;

  // E의 칸들: field(글) · before(앞 칸과 이은 기호) · col(칸 번호). 새 칸은 칸 번호에 맞는 자리에 끼운다.
  interface Cell { field: string; before: string; col: number }
  const cells: Cell[] = e.fields.map((field, i) => ({ field, before: i ? e.seps[i - 1] : '', col: e.cols[i] }));
  const original = [...cells];
  const textOf = () => cells.reduce((text, cell, i) => (i === 0 ? cell.field : `${text}${cell.before}${cell.field}`), '');
  const insertAfter = (cell: Cell, field: string, before: string) => { cells.splice(cells.indexOf(cell) + 1, 0, { field, before, col: cell.col }); };
  /** 칸 번호 col에 새 칸을 끼운다: 맨 뒤면 그만큼 건너뛰어 잇고, E가 건너뛴 자리(E의 `::`)면 그 자리를 채운다. */
  const place = (field: string, col: number, mark: string, label = '') => {
    const last = cells[cells.length - 1];
    if (col > last.col) { cells.push({ field, before: namedSeparator(retimeSeparator(mark, col - last.col), label), col }); return; }
    const at = cells.findIndex(cell => cell.col > col);
    const previous = cells[at - 1];
    cells.splice(at, 0, { field, before: namedSeparator(retimeSeparator(cells[at].before, col - previous.col), label), col });
    cells[at + 1].before = retimeSeparator(cells[at + 1].before, cells[at + 1].col - col);
  };
  const hasGap = (col: number) => !cells.some(cell => cell.col === col) && col < cells[cells.length - 1].col;

  // 칸의 위치: 칸이 스스로 적은 위치(`[ ]` · `:{이름}`) → 그 칸 번호의 기준 칸 이름(줄 앞 기준 → 이어받은 기준).
  // E의 줄 앞 기준이 S의 것으로 늘어나면(`[개념:정의]` → `[개념:정의;예시]`) 합친 줄은 늘어난 기준을 쓴다.
  const check = positions !== null;
  const grown = grownCriterion(e.fields[0], s.fields[0]);
  const eColumn = columnLabelsOf(e, positions?.existing, grown ? grown.slice(1, -1) : undefined);
  const sColumn = columnLabelsOf(s, positions?.incoming);
  const ePosition = new Map<Cell, string>(original.map((cell, i) => [cell, ownPositionOf(e, i, positions?.existingScope) ?? eColumn(cell.col)]));
  const sOwn = s.fields.map((_, j) => ownPositionOf(s, j, positions?.incomingScope));
  const sPosition = s.fields.map((_, j) => sOwn[j] ?? sColumn(s.cols[j]));
  const fits = (cell: Cell | undefined, j: number) => !check || (!!cell && samePosition(ePosition.get(cell) ?? '', sPosition[j]));
  /** S의 칸 j를 E의 칸 번호 col에 새 칸으로 둘 때 연결어에 붙일 이름: 그 번호의 칸 이름이 S의 위치와 같으면 ''(붙일 것 없음), 다르면 S의 이름. 이름이 없어 위치를 지킬 수 없으면 null. */
  const labelFor = (j: number, col: number): string | null => {
    if (!check || sOwn[j] !== undefined || samePosition(eColumn(col), sPosition[j])) return '';
    return sPosition[j] || null;
  };
  /** `( )` 안으로 들어가는 S의 칸 j(맨 앞 다음 칸부터)는 위 기준과 이어지지 않으므로 위치 이름을 `{이름}`으로 남긴다 */
  const carry = (j: number) => (check && sOwn[j] === undefined ? sPosition[j] : '');

  // S의 각 칸이 E의 몇 번째 칸과 같은지: 칸 번호가 같아야 한다(맨 앞 칸만 어느 칸이든 겹칠 수 있다). 같은 자리의 목록·순서 칸은 합쳐서 같은 칸으로 본다.
  // 이름이 같아도 위치(분류기준 칸 이름 · `[ ]`)가 다르면 다른 칸이다.
  const index: number[] = [];
  let previous = -1;
  let conflict = false;
  s.fields.forEach((field, j) => {
    const column = s.cols[j];
    let found = cells.findIndex((other, i) => i > previous && (j === 0 || other.col === column) && nameOf(other.field) === nameOf(field) && nameOf(field) !== '' && fits(other, j));
    if (found < 0 && j > 0 && previous >= 0 && !hasCriterion(field)) {
      const target = cells.findIndex(other => other.col === column);
      if (target > previous && fits(cells[target], j)) {
        const merged = mergeField(cells[target].field, field);
        if (merged !== null) { cells[target].field = merged; found = target; }
      }
    }
    if (found < 0 && nameOf(field) !== '' && cells.some(other => nameOf(other.field) === nameOf(field))) conflict = true;
    if (j === 0 && found < 0) { index.push(-1); return; }
    index.push(found);
    if (found >= 0) previous = found;
  });
  if (index[0] < 0) {
    return conflict || index.some(item => item >= 0) ? null
      : mergeIntoCell(e, s, existingText, field => fits(original[field], 0), carry);
  }
  if (conflict) return null;
  const matched = index.map((i, j) => ({ i, j })).filter(item => item.i >= 0);
  if (matched.some((item, order) => order > 0 && item.i <= matched[order - 1].i)) return null;
  // 맨 앞 칸이 E의 뒤쪽 칸과 겹치면 그 칸에 묶는 합치기뿐이다(다른 칸까지 겹치면 칸 번호가 어긋난 것)
  if (index[0] > 0 && matched.length >= 2) return null;

  const anchor = matched[matched.length - 1];
  const tailStart = anchor.j + 1;
  const hasTail = tailStart < s.fields.length;
  const innerNew = s.fields.map((field, j) => ({ field, j })).filter(item => item.j < anchor.j && index[item.j] < 0);
  let kind: NoteMergeKind = matched.length >= 2 ? 'link' : 'add';
  const mark = s.seps[anchor.j] ?? ':';
  const lastCell = cells[cells.length - 1];
  const tailCol = hasTail ? s.cols[tailStart] : 0;
  /** 꼬리 칸들을 S가 쓴 기호 그대로 맨 뒤에 잇는다(첫 칸은 E의 마지막 칸 번호에서 건너뛴 만큼). 위치를 지킬 수 없으면 false. */
  const appendTail = (): boolean => s.fields.slice(tailStart).every((field, offset) => {
    const last = cells[cells.length - 1];
    const written = offset === 0 ? retimeSeparator(mark, s.cols[tailStart] - last.col) : s.seps[anchor.j + offset];
    const col = last.col + runLength(written);
    const label = labelFor(tailStart + offset, col);
    if (label === null) return false;
    cells.push({ field, before: namedSeparator(written, label), col });
    return true;
  });
  /** 꼬리를 한 덩어리로 칸 번호 자리에 붙인다: 그 번호의 칸이 있으면 같은 칸에 `=`로(위치가 같을 때만), 없으면 번호에 맞게 끼운다 */
  const joinTail = (): boolean => {
    const text = wrapTail(s, tailStart, carry);
    const target = original.find(cell => cell.col === tailCol && cells.includes(cell));
    if (target) {
      if (!fits(target, tailStart)) return false;
      insertAfter(target, text, weakLink());
      return true;
    }
    if (tailCol > lastCell.col || hasGap(tailCol)) {
      const label = labelFor(tailStart, tailCol);
      if (label === null) return false;
      place(text, tailCol, mark, label);
      return true;
    }
    return false;
  };

  if (matched.length >= 2) {
    if (hasTail) {
      if (anchor.i === original.length - 1) { if (!appendTail()) return null; }
      else if (!joinTail()) return null;
    }
    // 사이에 낀 새 칸은 같은 번호의 칸에 `=`로 붙이고, 그 번호의 칸이 없으면(E가 건너뛴 자리) 그 자리에 끼운다
    for (const item of innerNew) {
      const target = original.find(cell => cell.col === s.cols[item.j]);
      if (target) {
        if (!fits(target, item.j)) return null;
        insertAfter(target, item.field, weakLink());
      } else if (hasGap(s.cols[item.j])) {
        const label = labelFor(item.j, s.cols[item.j]);
        if (label === null) return null;
        place(item.field, s.cols[item.j], mark, label);
      } else return null;
    }
  } else if (anchor.i === 0) {
    if (!hasTail) return null;
    const labelled = s.fields.slice(tailStart).some(hasCriterion);
    if (labelled) {
      // `[ ]`를 붙여 쓴 칸은 새 `:` 칸이다: E에 그 번호의 칸이 이미 있으면 맨 뒤에 새 칸으로 잇고, 없으면(E가 건너뛴 자리) 그 번호에 끼운다
      if (hasGap(tailCol) && s.fields.length - tailStart === 1) place(s.fields[tailStart], tailCol, mark);
      else if (!appendTail()) return null;
    } else if (cells.length > 1) { if (!joinTail()) return null; } else if (!appendTail()) return null;
  } else {
    if (!hasTail) return null;
    kind = 'group';
    const hit = original[anchor.i];
    const sepAt = (j: number) => namedSeparator(s.seps[j - 1], carry(j));
    hit.field = `(${hit.field}${sepAt(tailStart)}${s.fields.slice(tailStart).reduce((text, field, offset) => (offset === 0 ? field : `${text}${sepAt(tailStart + offset)}${field}`), '')})`;
  }
  // 새 줄의 줄 앞 분류기준이 기존 것을 늘린 것(`[개념:정의]` → `[개념:정의;예시]`)이면 합친 줄도 늘어난 기준을 쓴다: 이어 붙은 셋째 칸에 이름이 있어야 한다
  if (grown) cells[0].field = `${grown} ${stripCriterion(cells[0].field)}`;
  const text = textOf();
  return text === existingText.trim() ? null : { text, kind, overlap: matched.length };
};

/** 줄 앞 `[ ]` 기준 글(`[개념:정의]`). 없으면 ''. */
const criterionPrefixOf = (field: string) => (CRITERION_PREFIX.exec(field.trim()) ?? [''])[0].trim();
/** 새 칸의 기준이 기존 칸의 기준으로 시작하면서 더 길면(칸 이름이 더 많으면) 그 새 기준, 아니면 null */
const grownCriterion = (existingField: string, incomingField: string): string | null => {
  const before = criterionPrefixOf(existingField);
  const after = criterionPrefixOf(incomingField);
  // 둘 다 칸 이름이 둘 이상인 분류기준(`[개념:정의]`)일 때만: `[A]`(집합)와 `[A:D]`(위치 표시)는 기준이 아니다
  const labelsOf = (text: string) => (text ? text.slice(1, -1).split(/[:;<]/).length : 0);
  if (!after || !before || labelsOf(before) < 2 || labelsOf(after) <= labelsOf(before)) return null;
  if (!norm(after).startsWith(norm(before).replace(/\]$/, ''))) return null;
  return after;
};

const toggleName = (title: string) => norm(splitTitleCriteria(title).head.replace(/\{[^{}\n]*\}/g, '').replace(trailingRelation(), ''));

/** 노트 글의 줄(`//`로 나눈 칸 포함)을 속성(토글 경로)과 함께 찾는다. 관계 기호가 없는 줄은 건너뛴다. */
export const scanNoteStatements = (memo: string): NoteStatement[] => {
  const statements: NoteStatement[] = [];
  const path: string[] = [];
  // 칸 이름의 바탕: 노트 맨 위 분류기준. 토글 제목에 기준이 있으면 그 안은 그 기준, 끝이 열린 제목(`자동차 :`)은 아래 줄의 칸 번호를 그만큼 민다.
  const top = noteCriterionOf(memo);
  const scopes: { labels: string[]; offset: number }[] = [{ labels: top ? parseCriterionLabels(top) : [], offset: 0 }];
  memo.split('\n').forEach((line, lineIndex) => {
    if (line.startsWith(REVIEW_MEMO_TOGGLE_START)) {
      const title = line.slice(REVIEW_MEMO_TOGGLE_START.length);
      path.push(toggleName(title));
      const parent = scopes[scopes.length - 1];
      const own = splitTitleCriteria(title).criteria.at(-1);
      const blank = blankTitleCriteria(title);
      const open = openTailOf(blank);
      const before = open?.connector ? parseNoteChain(blank.slice(0, open.start)) : null;
      scopes.push({ labels: own ? parseCriterionLabels(own) : parent.labels, offset: parent.offset + (before && before.fields[0] ? before.cols[before.cols.length - 1] + 1 : 0) });
      return;
    }
    if (line === REVIEW_MEMO_TOGGLE_END) { path.pop(); if (scopes.length > 1) scopes.pop(); return; }
    if (!line.trim()) return;
    const cuts = topLevelCuts(line, '/').filter(cut => isReviewSlash(line, cut));
    const bounds = [-1, ...cuts, line.length];
    bounds.slice(1).forEach((end, index) => {
      const raw = line.slice(bounds[index] + 1, end);
      const text = raw.trim();
      if (!text || topLevelCuts(text, relationMarks()).length === 0) return;
      const lead = raw.length - raw.trimStart().length;
      const start = bounds[index] + 1 + lead;
      const scope = scopes[scopes.length - 1];
      statements.push({ line: lineIndex, start, end: start + text.length, text, path: [...path], labels: scope.labels.slice(scope.offset) });
    });
  });
  return statements;
};

const replaceStatement = (memo: string, statement: NoteStatement, text: string) => {
  const lines = memo.split('\n');
  lines[statement.line] = lines[statement.line].slice(0, statement.start) + text + lines[statement.line].slice(statement.end);
  return lines.join('\n');
};

/**
 * 새로 쓴 노트를 이전 노트들(오래된 것부터)에 합친다. 새 노트의 글은 그대로 두고, 바뀐 이전 노트만 돌려준다.
 * 같은 속성 경로에서 맨 앞 칸 이름이 같은 줄을 찾고, 겹침이 가장 많은 줄(같으면 가장 오래된 줄)에 합친다.
 */
export const mergeNoteIntoEarlier = (newMemo: string, earlier: MergeSource[]): MergeUpdate[] => {
  const current = new Map(earlier.map(source => [source.id, source.memo]));
  const steps = new Map<string, MergeUpdate['steps']>();
  scanNoteStatements(newMemo).forEach(incoming => {
    const incomingKey = incoming.path.join('\u0001');
    let best: { id: string; statement: NoteStatement; merge: ChainMerge } | null = null;
    // 같은 속성 안에 같은 글(맨 앞 칸이 같고 낱말이 모두 들어 있는 줄)이 이미 있으면 다른 줄에 합치지 않는다: 같은 글을 다시 써도 결과가 같다.
    const positionsWith = (existing: NoteStatement): MergePositions => ({
      existing: existing.labels, incoming: incoming.labels, existingScope: existing.path.at(-1), incomingScope: incoming.path.at(-1)
    });
    const alreadyThere = earlier.some(source => scanNoteStatements(current.get(source.id) ?? '')
      .some(existing => existing.path.join('\u0001') === incomingKey && noteChainContains(existing.text, incoming.text, positionsWith(existing))));
    if (alreadyThere) return;
    earlier.forEach(source => {
      scanNoteStatements(current.get(source.id) ?? '').forEach(existing => {
        if (existing.path.join('\u0001') !== incomingKey) return;
        const merge = mergeNoteChains(existing.text, incoming.text, positionsWith(existing));
        if (merge && (!best || merge.overlap > best.merge.overlap)) best = { id: source.id, statement: existing, merge };
      });
    });
    if (!best) return;
    const target = best as { id: string; statement: NoteStatement; merge: ChainMerge };
    current.set(target.id, replaceStatement(current.get(target.id) ?? '', target.statement, target.merge.text));
    steps.set(target.id, [...(steps.get(target.id) ?? []), { statement: incoming.text, kind: target.merge.kind }]);
  });
  return earlier.flatMap(source => {
    const after = current.get(source.id) ?? source.memo;
    return after === source.memo ? [] : [{ logId: source.id, before: source.memo, after, steps: steps.get(source.id) ?? [] }];
  });
};
