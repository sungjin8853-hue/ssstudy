import React, { useState } from 'react';
import { buildReviewQuestions } from '../utils/reviewQuestions';
import type { NoteQuestion, AnswerSpan } from '../utils/reviewQuestions';

export function getMaskedNoteSpans(questions: NoteQuestion[], maskedKeys: Set<string>): AnswerSpan[] {
  const forward = questions.filter(question => question.direction === 'forward');
  const candidates = forward.filter(question => maskedKeys.has(question.key)).flatMap(question => question.answerSpans);
  // A piece of text that is also a question condition/prompt stays visible.
  const protectedSpans = forward.filter(question => question.kind !== 'remaining').flatMap(question => question.promptSpans);
  return candidates.flatMap(candidate => {
    let pieces = [candidate];
    protectedSpans.filter(span => span.nodeId === candidate.nodeId).forEach(protectedSpan => {
      pieces = pieces.flatMap(piece => {
        if (protectedSpan.end <= piece.start || protectedSpan.start >= piece.end) return [piece];
        return [
          ...(protectedSpan.start > piece.start ? [{ ...piece, end: protectedSpan.start }] : []),
          ...(protectedSpan.end < piece.end ? [{ ...piece, start: protectedSpan.end }] : [])
        ];
      });
    });
    return pieces;
  });
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
