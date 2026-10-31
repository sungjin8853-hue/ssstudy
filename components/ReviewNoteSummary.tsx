import React, { useState } from 'react';
import { buildReviewQuestions } from '../utils/reviewQuestions';
import type { NoteQuestion, AnswerSpan } from '../utils/reviewQuestions';

const VALUE_KINDS: NoteQuestion['kind'][] = ['direct', 'order-next', 'reconstruct', 'order-reconstruct', 'remaining'];
const overlaps = (a: AnswerSpan, b: AnswerSpan) => a.nodeId === b.nodeId && a.start < b.end && b.start < a.end;

/**
 * 가릴 칸: 가릴 문제마다 그 관계의 값 쪽(앞으로 묻는 문제는 답, 거꾸로 묻는 문제는 주어진 값)을 가린다(31일 요청: 이번에 낸 문제는 모두 가린다).
 * 값 = 노트에서 어떤 앞 칸 "다음"에 오는 칸. 줄 맨 앞 칸처럼 값이 아닌 곳은 빈칸 문제로 물었어도 보인 채로 남아 무엇을 떠올릴지 알려 준다.
 * 사슬(a:b:c)의 가운데 값도 물었으면 가린다.
 */
export function getMaskedNoteSpans(questions: NoteQuestion[], maskedKeys: Set<string>): AnswerSpan[] {
  const values = questions.filter(question => question.direction === 'forward' && VALUE_KINDS.includes(question.kind)).flatMap(question => question.answerSpans);
  const masks: AnswerSpan[] = [];
  questions
    .filter(question => maskedKeys.has(question.key) && question.kind !== 'recall' && !question.convert)
    .flatMap(question => (question.direction === 'forward' ? question.answerSpans : question.promptSpans) ?? [])
    .filter(span => values.some(value => overlaps(span, value)))
    .forEach(span => { if (!masks.some(mask => mask.nodeId === span.nodeId && mask.start === span.start && mask.end === span.end)) masks.push(span); });
  return masks;
}

const RecallAnswer: React.FC<{ answer: string }> = ({ answer }) => {
  const [revealed, setRevealed] = useState(false);
  return <button
    type="button"
    aria-label={revealed ? '답 다시 가리기' : '숨긴 답 보기'}
    aria-pressed={revealed}
    data-answer-blank={revealed ? undefined : 'true'}
    data-revealed-answer={revealed ? 'true' : undefined}
    onClick={() => setRevealed(previous => !previous)}
    className={revealed
      ? 'inline max-w-full cursor-pointer whitespace-pre-wrap break-words rounded-sm text-left align-baseline hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'
      : 'mx-1 inline-block h-7 w-24 cursor-pointer rounded-md border-b-2 border-slate-400 bg-slate-100 align-middle transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'}
  >{revealed ? answer : null}</button>;
};

export const ReviewNoteSummary: React.FC<{ memo: string; maskedKeys?: string[] }> = ({ memo, maskedKeys = [] }) => {
  const { questions, nodes } = buildReviewQuestions(memo);
  const masks = getMaskedNoteSpans(questions, new Set(maskedKeys));
  const renderText = (nodeId: string, text: string) => {
    const ranges = masks.filter(mask => mask.nodeId === nodeId).sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    ranges.forEach(range => {
      const previous = merged.at(-1);
      if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
      else merged.push({ start: range.start, end: range.end });
    });
    const result: React.ReactNode[] = [];
    let cursor = 0;
    merged.forEach(range => {
      result.push(text.slice(cursor, range.start));
      const answer = text.slice(range.start, range.end);
      result.push(<RecallAnswer key={`${nodeId}:${range.start}:${range.end}:${answer}`} answer={answer} />);
      cursor = range.end;
    });
    result.push(text.slice(cursor));
    return result;
  };
  const renderChildren = (parentId: string | null): React.ReactNode => nodes.filter(node => node.parentId === parentId).map(node => (
    <div key={node.id} className={parentId ? 'ml-4 mt-2' : 'mt-3'}>
      <div className={`whitespace-pre-wrap break-words ${node.type === 'toggle' ? 'font-bold' : ''}`}>
        {node.type === 'toggle' && <span aria-hidden="true" className="mr-2 text-slate-400">▾</span>}
        {renderText(node.id, node.text)}
      </div>
      {renderChildren(node.id)}
    </div>
  ));
  return <div data-review-note-summary="true" className="max-h-[55vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-lg leading-relaxed text-slate-800">{renderChildren(null)}</div>;
};
