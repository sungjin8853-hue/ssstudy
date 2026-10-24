import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { isReviewSlash } from './reviewSlash';
import { matchingBracket, parseSetExpression } from './setExpression';
import type { SetExprNode } from './setExpression';
import { markKeyOf, normSetName, readNoteSetLine, readNoteTemplate, setContents, splitHeadMarks, toggleName } from './noteSets';
import type { NoteSetIndex } from './noteSets';
import { topLevelCuts } from './noteDiagram';
import { relationMarks } from './noteShorthand';
import { expandOpenLines } from './noteOpenTail';

/**
 * `[집합]()` 창에서 값을 고치거나 지울 때 노트 글에 적용하는 규칙.
 *  - 고친 값은 "같은 위치"에 쓰인 줄만 바뀐다: 그 값이 그 집합 안에 있게 만드는 줄(그 집합의 토글 아래 · `[집합] 값`처럼 위치 표시)이다.
 *    같은 이름이 다른 집합에 쓰인 줄은 그대로다. 다른 노트(같은 과목)에 있는 같은 위치의 줄도 같이 바뀐다(노트마다 이 함수를 부른다).
 *  - 줄 맨 앞 셀의 글자만 바뀌고 줄의 나머지(위치 표시 · 연결어 · 뒤의 값들)는 그대로다.
 *  - 완전히 지우면 그 셀 글자만 없어지고 다른 값은 남는다. 셀 글자 말고 아무것도 없던 줄은 줄째 없어진다.
 */

interface Segment { start: number; text: string }

/** 줄을 `//`로 나눈 칸들(줄 안에서의 시작 자리와 함께, 앞뒤 공백은 그대로) */
const segmentsOf = (line: string): Segment[] => {
  const cuts = topLevelCuts(line, '/').filter(cut => isReviewSlash(line, cut));
  const bounds = [-1, ...cuts, line.length];
  return bounds.slice(1).map((end, index) => ({ start: bounds[index] + 1, text: line.slice(bounds[index] + 1, end) })).filter(segment => segment.text.trim());
};

/** `splitHeadMarks`와 같은 규칙으로 칸 맨 앞 셀이 있는 자리(칸 안에서의 시작·끝)와 붙은 위치 표시들, 연결어가 쓰였는지 */
const headCellSpan = (segment: string): { start: number; end: number; marks: string[]; connected: boolean } | null => {
  const cuts = topLevelCuts(segment, relationMarks());
  const headEnd = cuts.length ? cuts[0] : segment.length;
  let start = 0;
  let end = headEnd;
  while (start < end && /\s/.test(segment[start])) start += 1;
  while (end > start && /\s/.test(segment[end - 1])) end -= 1;
  const marks: string[] = [];
  const rest = () => segment.slice(start, end);
  for (let close = matchingBracket(rest(), 0); close > 0; close = matchingBracket(rest(), 0)) {
    marks.push(rest().slice(1, close).trim());
    start += close + 1;
    start += /^\s*/.exec(segment.slice(start, end))![0].length;
  }
  while (end > start && /\s/.test(segment[end - 1])) end -= 1;
  if (/^\(\s*\)$/.test(segment.slice(start, end))) return null;
  if (end <= start) return null;
  return { start, end, marks: marks.filter(Boolean), connected: cuts.length > 0 };
};

/** 이 줄의 셀이 어떤 위치에 있는가: 바로 위 집합들(토글 · 위치 표시 안의 집합 이름)과 위치 표시 열쇠들 */
interface Occurrence { parents: string[]; markKeys: string[]; connected: boolean }

const reaches = (index: NoteSetIndex, from: string, target: string, seen = new Set<string>()): boolean => {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (index.parents.get(from) ?? []).some(parent => reaches(index, parent, target, seen));
};

const within = (index: NoteSetIndex, node: SetExprNode, occurrence: Occurrence): boolean => {
  if (node.type === 'name') {
    const name = normSetName(node.name);
    if (name === '?') return !occurrence.connected && (occurrence.parents.length > 0 || occurrence.markKeys.length > 0);
    return occurrence.markKeys.includes(markKeyOf(node.name)) || occurrence.parents.some(parent => reaches(index, parent, name));
  }
  if (node.type === 'mark') {
    if (normSetName(node.inner) === '?') return !occurrence.connected && (occurrence.parents.length > 0 || occurrence.markKeys.length > 0);
    const key = markKeyOf(node.inner);
    return occurrence.markKeys.includes(key) || occurrence.parents.some(parent => reaches(index, parent, normSetName(node.inner)));
  }
  if (node.type === 'or') return node.items.some(item => within(index, item, occurrence));
  if (node.type === 'and') return node.items.every(item => within(index, item, occurrence));
  return !within(index, node.of, occurrence);
};

/** `[집합식]` 안쪽 글을 이 줄의 위치로 읽는다(읽을 수 없는 글은 위치 표시 하나로 본다) */
const locationTest = (index: NoteSetIndex, set: string): ((occurrence: Occurrence) => boolean) => {
  const node = parseSetExpression(set) ?? { type: 'mark', inner: set } as SetExprNode;
  return occurrence => within(index, node, occurrence);
};

/** 확장된 줄(열린 꼬리 줄이 토글로 감싸진 것)과 원래 줄을 맞춰, 확장된 줄마다 원래 줄 번호를(끼워 넣은 줄이면 -1) */
const alignExpanded = (original: readonly string[], expanded: readonly string[]): number[] => {
  const result: number[] = [];
  let at = 0;
  expanded.forEach(line => {
    if (at < original.length && (line === original[at] || line === `${REVIEW_MEMO_TOGGLE_START}${original[at]}`)) { result.push(at); at += 1; }
    else result.push(-1);
  });
  return result;
};

/**
 * 노트 글 하나에서 `set` 안에 있는 값 `from`을 `to`로 고친다(`to`가 비면 지운다). 바뀐 글을 돌려준다(바뀐 것이 없으면 같은 글).
 * `index`는 같은 과목의 모든 노트로 만든 색인이다(집합 관계를 알아야 "같은 위치"를 판단한다).
 */
export const rewriteSetMember = (memo: string, index: NoteSetIndex, set: string, from: string, to: string): string => {
  const fromKey = normSetName(from);
  if (!fromKey || !normSetName(memo).includes(fromKey)) return memo;
  // 그 집합의 창에 값으로 보이는 것만 고친다(집합 이름 자체나 집합 밖의 값은 건드리지 않는다)
  if (!setContents(index, set).some(row => !row.isSet && normSetName(row.name) === fromKey)) return memo;
  const inside = locationTest(index, set);
  const replacement = to.replace(/\s*\n\s*/g, ' ').trim();
  const original = memo.split('\n');
  const expanded = expandOpenLines(memo).split('\n');
  const origin = alignExpanded(original, expanded);
  const out = [...original];
  const drop = new Set<number>();
  const stack: string[] = [];
  expanded.forEach((line, position) => {
    if (line.startsWith(REVIEW_MEMO_TOGGLE_START)) { stack.push(normSetName(toggleName(line.slice(REVIEW_MEMO_TOGGLE_START.length)))); return; }
    if (line === REVIEW_MEMO_TOGGLE_END) { stack.pop(); return; }
    const lineNumber = origin[position];
    if (lineNumber < 0) return;
    const raw = original[lineNumber];
    const edits: Array<{ start: number; end: number }> = [];
    segmentsOf(raw).forEach(segment => {
      const text = segment.text.trim();
      if (readNoteSetLine(text) || readNoteTemplate(text)) return;
      const head = headCellSpan(segment.text);
      if (!head) return;
      const cell = segment.text.slice(head.start, head.end);
      // 색인이 읽는 맨 앞 셀과 같은 글일 때만 건드린다
      if (splitHeadMarks(text).cell !== cell.trim() || normSetName(cell) !== fromKey) return;
      const parents = [...(stack.length ? [stack[stack.length - 1]] : []), ...head.marks.flatMap(mark => mark.split(/[.,%()]+/).map(normSetName).filter(name => name && (index.sets.has(name) || index.display.has(name))))];
      const occurrence: Occurrence = { parents, markKeys: head.marks.map(markKeyOf), connected: head.connected };
      if (!inside(occurrence)) return;
      edits.push({ start: segment.start + head.start, end: segment.start + head.end });
    });
    if (!edits.length) return;
    let next = raw;
    [...edits].reverse().forEach(edit => { next = `${next.slice(0, edit.start)}${replacement}${next.slice(edit.end)}`; });
    if (!replacement) next = next.replace(/[ \t]+$/, '');
    if (!replacement && !next.trim()) drop.add(lineNumber);
    out[lineNumber] = next;
  });
  return out.filter((_, at) => !drop.has(at)).join('\n');
};
