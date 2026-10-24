import React, { useMemo, useState } from 'react';
import type { ReviewMemoOldLine, ReviewRemovedReason } from '../types';
import { collectRelatedData, questionDefinitions } from '../utils/reviewRemoval';
import type { QuestionDefinitionLine, RemovalCover, RemovalMemo } from '../utils/reviewRemoval';
import { stripLogicMarks } from '../utils/noteLogicMarks';
import { NoteSetSourceContext, ReviewMemoEditor } from './ReviewMemoEditor';

export interface QuestionLineEdit {
  logId: string;
  lineIndex: number;
  /** 고치기 전에 화면에 보여 준 줄 글 */
  expected: string;
  text: string;
  isToggle: boolean;
}

interface Props {
  covers: RemovalCover[];
  /** 복습 화면이 보여 주는 노트 글(문제가 나온 줄을 찾는 데 쓴다) */
  memos: RemovalMemo[];
  /** 같은 과목의 저장된 노트 글(능력 정의 줄을 찾고, 집합 추천에 쓴다) */
  setMemos: RemovalMemo[];
  oldLines: ReviewMemoOldLine[];
  onRemove: (reason: ReviewRemovedReason) => void;
  /** 고친 줄을 노트에 저장한다. 못 고쳤으면 이유 글을 돌려준다. */
  onEdit: (edits: QuestionLineEdit[]) => string | null;
}

const REASONS: { reason: ReviewRemovedReason; title: string; hint: string }[] = [
  { reason: 'logic', title: '논리적 관계에 안 맞아요', hint: '그 줄에 [!]가 붙어요 · 고치면 다시 나와요' },
  { reason: 'low', title: '중요도가 떨어져요', hint: '이 문제만 복습에서 빠져요' }
];

const lineKey = (line: QuestionDefinitionLine) => `${line.logId}:${line.lineIndex}`;

/**
 * 복습 문제 한 장에서 문제를 복습에서 빼는 도구.
 *  - 이유 두 가지 중 하나를 고른다: 논리적 관계에 안 맞아서 / 중요도가 떨어져서. 노트 글과 문제는 지우지 않고 복습에서만 빠진다.
 *  - 이 문제가 어떤 능력 정의(`[집합식]:[기준]`)와 노트 줄에서 나왔는지 보여 주고, 그 자리에서 바로 고칠 수 있다(정리노트처럼 집합 추천이 뜬다).
 *  - 같은 값이 나온 다른 줄과 고치기 전의 이전 값을 함께 보여 준다.
 */
export const ReviewQuestionTools: React.FC<Props> = ({ covers, memos, setMemos, oldLines, onRemove, onEdit }) => {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const coverSignature = covers.map(cover => `${cover.logId}:${cover.questionKey}`).join('|');
  const definitions = useMemo(
    () => questionDefinitions({ covers, memos, setMemos }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverSignature, memos, setMemos]
  );
  const related = useMemo(
    () => collectRelatedData(setMemos.length ? setMemos : memos, oldLines, definitions.values),
    [setMemos, memos, oldLines, definitions.values]
  );
  const rows = [...definitions.abilities, ...definitions.lines];
  const changed = rows.filter(row => (drafts[lineKey(row)] ?? row.text) !== row.text);
  const sources = useMemo(() => setMemos.map(item => item.memo), [setMemos]);

  const apply = () => {
    const message = onEdit(changed.map(row => ({ logId: row.logId, lineIndex: row.lineIndex, expected: row.text, text: drafts[lineKey(row)] ?? row.text, isToggle: row.isToggle })));
    setError(message ?? '');
  };

  return (
    <div data-testid="question-tools" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
          className="h-10 rounded-xl border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50">
          복습에서 빼기
        </button>
      </div>
      {open && (
        <section aria-label="복습에서 빼기" className="flex flex-col gap-4 rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-4 text-left md:px-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {REASONS.map(item => (
              <button key={item.reason} type="button" data-remove-reason={item.reason} onClick={() => onRemove(item.reason)}
                className="flex min-h-[4.5rem] flex-col items-start justify-center gap-1 rounded-2xl border-2 border-rose-300 bg-white px-4 py-3 text-left hover:bg-rose-50">
                <span className="text-lg font-black text-rose-900">{item.title}</span>
                <span className="text-sm font-semibold text-slate-700">{item.hint}</span>
              </button>
            ))}
          </div>

          {rows.length > 0 && (
            <div data-testid="question-definitions" className="flex flex-col gap-2.5">
              <h3 className="text-sm font-black text-slate-900">나온 정의</h3>
              <NoteSetSourceContext.Provider value={sources}>
                {rows.map(row => {
                  const key = lineKey(row);
                  return (
                    <div key={`${row.kind}:${key}`} data-definition-kind={row.kind} className="flex flex-col gap-1">
                      <span className={`w-fit rounded-md px-2 py-0.5 text-xs font-black ${row.kind === 'ability' ? 'bg-indigo-100 text-indigo-900' : 'bg-amber-100 text-amber-900'}`}>
                        {row.kind === 'ability' ? '능력 정의' : '나온 줄'}
                      </span>
                      <div className="rounded-xl border-2 border-slate-300 bg-white px-1">
                        <ReviewMemoEditor flat colorColons theme="light" minHeight={40}
                          value={drafts[key] ?? row.text} onChange={value => setDrafts(previous => ({ ...previous, [key]: value }))} />
                      </div>
                    </div>
                  );
                })}
              </NoteSetSourceContext.Provider>
              <div className="flex items-center gap-3">
                <button type="button" disabled={changed.length === 0} onClick={apply} data-testid="question-definitions-apply"
                  className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white enabled:hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-600">
                  고쳐서 적용
                </button>
                {error && <span role="alert" className="text-sm font-bold text-rose-700">{error}</span>}
              </div>
            </div>
          )}

          {(related.current.length > 0 || related.previous.length > 0) && (
            <div data-testid="question-related" className="flex flex-col gap-2">
              <h3 className="text-sm font-black text-slate-900">같은 값이 나온 줄</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {related.current.map((item, index) => (
                  <li key={`c${index}`} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">{stripLogicMarks(item.text)}</li>
                ))}
                {related.previous.map((item, index) => (
                  <li key={`p${index}`} data-previous="true" className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                    <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-black text-slate-800">이전</span>
                    <span className="min-w-0 break-words">{stripLogicMarks(item.text)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
