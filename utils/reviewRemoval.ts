import type { ReviewMemoOldLine, ReviewRemovedQuestion, ReviewRemovedReason, StudyLog } from '../types';
import { buildReviewQuestions } from './reviewQuestions';
import type { NoteQuestion, QuestionNoteNode } from './reviewQuestions';
import { markLogicInLine, memoLineText, stripLogicMarks, hasLogicMark } from './noteLogicMarks';
import { normSetName, questionAbilities } from './noteSets';
import { readNoteSetLine } from './noteDiagram';
import { REVIEW_MEMO_TOGGLE_START } from './reviewMemo';

/** 복습에서 빼기: 노트 글과 문제 자체는 그대로 두고, 복습에 나오지 않게만 한다. */
export const REMOVE_REASON_LABELS: Record<ReviewRemovedReason, string> = {
  logic: '논리적 관계에 안 맞아요',
  low: '중요도가 떨어져요',
  duplicate: '같은 문제가 있어요'
};

export interface RemovalCover { logId: string; questionKey: string }
export interface RemovalMemo { logId: string; memo: string }

export interface RemovalUpdate {
  logId: string;
  /** `[!]`를 붙인 새 노트 글(바뀐 것이 있을 때만) */
  memo?: string;
  removed: Record<string, ReviewRemovedQuestion>;
}

interface Located { memo: string; question: NoteQuestion; nodes: QuestionNoteNode[] }

const locate = (memos: readonly RemovalMemo[], cover: RemovalCover): Located | null => {
  const entry = memos.find(item => item.logId === cover.logId);
  if (!entry) return null;
  const built = buildReviewQuestions(entry.memo);
  const question = built.questions.find(item => item.key === cover.questionKey);
  return question ? { memo: entry.memo, question, nodes: built.nodes } : null;
};

/** 칸 글자 범위(노드 글 안)가 놓인 줄: 줄 글과 그 줄 안의 범위 */
const lineOfSpan = (node: QuestionNoteNode, start: number, end: number) => {
  const lineStart = node.text.lastIndexOf('\n', start - 1) + 1;
  const found = node.text.indexOf('\n', start);
  const lineEnd = found < 0 ? node.text.length : found;
  return { line: node.text.slice(lineStart, lineEnd), start: start - lineStart, end: Math.min(end, lineEnd) - lineStart, isToggle: node.type === 'toggle' };
};

/**
 * 문제의 정답 칸(없으면 주어진 칸)이 놓인 줄들.
 * `#` 틀이 펼친 줄(`generated`)에서만 난 문제는 틀 줄이 아니라 그 펼친 줄 하나가 원본이라 `generated`에 그 줄의 글을 싣는다.
 * 노트에 쓴 줄에서도 난 문제(같은 문제가 겹침)는 쓴 줄을 따른다.
 */
const sourceLines = (located: Located) => {
  const byId = new Map(located.nodes.map(node => [node.id, node]));
  const spans = located.question.answerSpans.length ? located.question.answerSpans : located.question.promptSpans;
  const written = spans.filter(span => span.generated === undefined);
  return (written.length ? written : spans).flatMap(span => {
    const node = byId.get(span.nodeId);
    return node ? [{ ...lineOfSpan(node, span.start, span.end), ...(span.generated !== undefined ? { generated: span.generated } : {}) }] : [];
  });
};

/** 노트 글에서 `line`과 같은 줄(토글 제목이면 제목 줄)을 `replace`로 바꾼다. 같은 줄이 여럿이면 모두 바꾼다. */
const replaceLines = (memo: string, line: string, isToggle: boolean, replace: (text: string) => string): { memo: string; changed: string[] } => {
  const changed: string[] = [];
  const lines = memo.split('\n').map(text => {
    const body = isToggle ? (text.startsWith(REVIEW_MEMO_TOGGLE_START) ? text.slice(REVIEW_MEMO_TOGGLE_START.length) : null) : text;
    if (body === null || body !== line) return text;
    const next = replace(body);
    if (next === body) return text;
    const written = isToggle ? `${REVIEW_MEMO_TOGGLE_START}${next}` : next;
    changed.push(written);
    return written;
  });
  return { memo: lines.join('\n'), changed };
};

/** 노트 글에서 `line`과 같은 첫 줄 바로 밑에 `text` 줄을 넣는다(이미 같은 줄이 있으면 그대로) */
const insertAfterLine = (memo: string, line: string, text: string): { memo: string; added: boolean } => {
  const lines = memo.split('\n');
  if (lines.includes(text)) return { memo, added: false };
  const at = lines.indexOf(line);
  if (at < 0) return { memo, added: false };
  lines.splice(at + 1, 0, text);
  return { memo: lines.join('\n'), added: true };
};

/** 이 문제와 같은 값이 나오는 다른 줄들과, 고치기 전의 이전 값들(충돌했을 수 있는 모든 데이터) */
export const collectRelatedData = (
  memos: readonly RemovalMemo[], oldLines: readonly ReviewMemoOldLine[], values: readonly string[], limit = 12
): { current: Array<{ logId: string; text: string }>; previous: ReviewMemoOldLine[] } => {
  const keys = values.map(value => normSetName(stripLogicMarks(value))).filter(Boolean);
  if (!keys.length) return { current: [], previous: [] };
  const mentions = (text: string) => { const flat = normSetName(stripLogicMarks(memoLineText(text))); return keys.some(key => flat.includes(key)); };
  const current: Array<{ logId: string; text: string }> = [];
  memos.forEach(entry => entry.memo.split('\n').forEach(line => {
    const text = memoLineText(line).trim();
    if (text && mentions(text) && !current.some(item => item.text === text)) current.push({ logId: entry.logId, text });
  }));
  const previous = oldLines.filter(item => mentions(item.text)).slice(0, limit);
  return { current: current.slice(0, limit), previous };
};

/**
 * 계획: 복습에서 뺄 문제들(결합 문제는 맡은 단위마다)과 `[!]`를 붙인 노트 글.
 * `memos`는 지금 복습 화면이 보여 주는 글(문제를 찾는 데 쓴다), `liveMemos`는 지금 저장된 노트 글(`[!]`는 여기에 붙인다, 없으면 `memos`와 같다).
 */
export const planReviewRemoval = (input: {
  reason: ReviewRemovedReason; covers: readonly RemovalCover[]; memos: readonly RemovalMemo[]; liveMemos?: readonly RemovalMemo[];
  /** 같은 값이 나온 다른 줄을 찾을 노트 글들(없으면 `memos`) */
  relatedMemos?: readonly RemovalMemo[];
  oldLines?: readonly ReviewMemoOldLine[]; nowIso: string;
}): RemovalUpdate[] => {
  const working = new Map((input.liveMemos ?? input.memos).map(item => [item.logId, item.memo]));
  const marks = new Map<string, string>();
  const updates = new Map<string, RemovalUpdate>();
  input.covers.forEach(cover => {
    const located = locate(input.memos, cover);
    if (!located) return;
    const update = updates.get(cover.logId) ?? { logId: cover.logId, removed: {} };
    const record: ReviewRemovedQuestion = { reason: input.reason, at: input.nowIso, prompt: located.question.prompt, answer: located.question.answer };
    if (input.reason === 'logic') {
      let memo = working.get(cover.logId) ?? located.memo;
      const marked: string[] = [];
      const added: string[] = [];
      sourceLines(located).forEach(source => {
        // `#` 틀이 펼친 줄은 노트에 없다: 그 줄 하나만 `[!]`를 붙여 새 줄로 넣어 막는다(같은 틀의 다른 줄은 그대로 나온다)
        if (source.generated !== undefined) {
          const blockedLine = markLogicInLine(source.generated, 0, source.generated.length);
          const inserted = insertAfterLine(memo, source.line, blockedLine);
          memo = inserted.memo;
          marked.push(blockedLine);
          if (inserted.added) added.push(blockedLine);
          return;
        }
        const slot = `${cover.logId}\u0000${source.isToggle ? 'T' : 'L'}\u0000${source.line}`;
        const result = replaceLines(memo, source.line, source.isToggle, text => markLogicInLine(text, source.start, source.end));
        memo = result.memo;
        if (result.changed.length) { marks.set(slot, result.changed[0]); marked.push(...result.changed); }
        else if (marks.has(slot)) marked.push(marks.get(slot)!);
      });
      if (marked.length) {
        if (memo !== working.get(cover.logId)) { working.set(cover.logId, memo); update.memo = memo; }
        record.markedLines = Array.from(new Set(marked));
        if (added.length) record.addedLines = Array.from(new Set(added));
      }
      const related = collectRelatedData(input.relatedMemos ?? input.memos, input.oldLines ?? [], [located.question.prompt, located.question.answer], 8);
      // 표시한 줄 자신은 빼고, 같은 값이 나오는 다른 줄만 모은다
      const own = new Set(sourceLines(located).map(source => (source.generated ?? source.line).trim()));
      related.current = related.current.filter(item => !own.has(item.text.trim()));
      const lines = [...related.current.map(item => stripLogicMarks(item.text)), ...related.previous.map(item => `이전 · ${stripLogicMarks(memoLineText(item.text))}`)];
      if (lines.length) record.related = lines;
    }
    update.removed[cover.questionKey] = record;
    updates.set(cover.logId, update);
  });
  return Array.from(updates.values());
};

/** 복습에서 뺀 문제를 되돌린다: `[!]`를 붙였던 줄은 `!`를 빼고, 기록을 지운다. */
export const planRestoreRemoved = (log: Pick<StudyLog, 'reviewMemo' | 'reviewRemoved'>, key: string): { memo?: string; reviewRemoved: StudyLog['reviewRemoved'] } => {
  const record = log.reviewRemoved?.[key];
  const rest = { ...log.reviewRemoved };
  delete rest[key];
  const reviewRemoved = Object.keys(rest).length ? rest : undefined;
  if (!record?.markedLines?.length) return { reviewRemoved };
  const targets = new Set(record.markedLines);
  // 빼면서 새로 넣은 줄(`#` 틀이 펼친 줄 하나)은 `!`만 빼면 노트에 글이 남으므로 줄째 지운다
  const added = new Set(record.addedLines ?? []);
  const memo = (log.reviewMemo || '').split('\n').flatMap(line => {
    if (added.has(line) && hasLogicMark(memoLineText(line))) return [];
    return [targets.has(line) && hasLogicMark(memoLineText(line))
      ? (line.startsWith(REVIEW_MEMO_TOGGLE_START) ? REVIEW_MEMO_TOGGLE_START : '') + stripLogicMarks(memoLineText(line))
      : line];
  }).join('\n');
  return { memo: memo === log.reviewMemo ? undefined : memo, reviewRemoved };
};

export interface QuestionDefinitionLine {
  kind: 'ability' | 'line';
  logId: string;
  /** 노트 글에서 이 줄의 번호(0부터) */
  lineIndex: number;
  /** 줄 글(토글 제목이면 제목 글만) */
  text: string;
  isToggle: boolean;
}

/**
 * 이 문제가 나온 정의: 능력 정의(`[집합]:[기준]` 줄)와 문제가 나온 노트 줄.
 * 둘 다 노트의 실제 줄이라 줄 번호로 바로 고칠 수 있다.
 */
export const questionDefinitions = (input: { covers: readonly RemovalCover[]; memos: readonly RemovalMemo[]; setMemos: readonly RemovalMemo[] }): {
  abilities: QuestionDefinitionLine[]; lines: QuestionDefinitionLine[]; values: string[];
} => {
  const abilities: QuestionDefinitionLine[] = [];
  const lines: QuestionDefinitionLine[] = [];
  const values: string[] = [];
  const pushUnique = (list: QuestionDefinitionLine[], item: QuestionDefinitionLine) => {
    if (!list.some(entry => entry.logId === item.logId && entry.lineIndex === item.lineIndex)) list.push(item);
  };
  const indexOfLine = (memo: string, text: string, isToggle: boolean) => memo.split('\n').findIndex(line => (isToggle
    ? line.startsWith(REVIEW_MEMO_TOGGLE_START) && line.slice(REVIEW_MEMO_TOGGLE_START.length) === text : line === text));
  input.covers.forEach(cover => {
    const located = locate(input.memos, cover);
    if (!located) return;
    values.push(located.question.prompt, located.question.answer);
    sourceLines(located).forEach(source => {
      const lineIndex = indexOfLine(located.memo, source.line, source.isToggle);
      if (lineIndex >= 0) pushUnique(lines, { kind: 'line', logId: cover.logId, lineIndex, text: source.line, isToggle: source.isToggle });
    });
    const found = questionAbilities(located.question, located.nodes, input.setMemos.map(item => item.memo));
    found.forEach(ability => {
      input.setMemos.forEach(entry => entry.memo.split('\n').forEach((line, lineIndex) => {
        const parsed = readNoteSetLine(memoLineText(line));
        if (parsed?.kind !== 'ability') return;
        if (normSetName(parsed.expression) !== normSetName(ability.expression) || normSetName(parsed.criterion) !== normSetName(ability.criterion)) return;
        pushUnique(abilities, { kind: 'ability', logId: entry.logId, lineIndex, text: memoLineText(line), isToggle: line.startsWith(REVIEW_MEMO_TOGGLE_START) });
      }));
    });
  });
  return { abilities, lines, values };
};

/**
 * 노트 글에서 `expected`(고치기 전에 화면에 보여 준 줄 글)인 줄을 새 글로 바꾼다. `hint`번째 줄이 그 글이면 거기를, 아니면 같은 글인 첫 줄을 바꾼다.
 * 토글 제목 줄이면 접두를 지킨다. 그 줄을 찾지 못하면 null(노트가 그 사이 바뀐 것이라, 엉뚱한 줄을 건드리지 않는다).
 */
export const replaceMemoLine = (memo: string, hint: number, expected: string, text: string, isToggle: boolean): string | null => {
  const lines = memo.split('\n');
  const bodyOf = (line: string | undefined) => (line === undefined ? null : isToggle ? (line.startsWith(REVIEW_MEMO_TOGGLE_START) ? line.slice(REVIEW_MEMO_TOGGLE_START.length) : null) : line);
  const at = bodyOf(lines[hint]) === expected ? hint : lines.findIndex(line => bodyOf(line) === expected);
  if (at < 0) return null;
  lines[at] = isToggle ? `${REVIEW_MEMO_TOGGLE_START}${text.replace(/\n/g, ' ')}` : text;
  return lines.join('\n');
};
