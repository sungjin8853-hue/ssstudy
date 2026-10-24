import React, { useState } from 'react';
import type { StudyLog } from '../types';
import { REMOVE_REASON_LABELS } from '../utils/reviewRemoval';
import { stripLogicMarks } from '../utils/noteLogicMarks';
import { useEditIntake } from '../utils/reviewEditIntake';
import { editIntakeCount } from '../utils/reviewGate';
import { COMBINE_LENGTH_MAX, COMBINE_LENGTH_MIN, useCombineLength } from '../utils/combineLength';

/**
 * 노트 화면의 복습 설정(고친 부분을 복습에 넣기는 노트 위의 EditIntakeBar).
 *  - 한 문제로 묶는 최대 길이(2~10, 기본 4): 능력 변환을 이어 묻는 단위 수와 관계쌍을 이어 묻는 쌍 수의 상한.
 *  - 복습에서 뺀 문제: 이유(논리적 관계 / 중요도)와 `[!]`가 붙은 줄, 충돌한 데이터. 되돌리면 다시 복습에 나온다.
 */
export const ReviewRemovedList: React.FC<{ logs: StudyLog[]; onRestore?: (logId: string, questionKey: string) => void }> = ({ logs, onRestore }) => {
  const [combine, setCombine] = useCombineLength();
  const [open, setOpen] = useState(false);
  const removed = logs.flatMap(log => Object.entries(log.reviewRemoved ?? {}).map(([key, record]) => ({ logId: log.id, key, record })))
    .sort((a, b) => b.record.at.localeCompare(a.record.at));

  return (
    <section data-testid="review-removed" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span id="combine-length-label" className="text-[15px] font-black text-slate-800">한 문제로 묶는 최대 길이</span>
        <div role="group" aria-labelledby="combine-length-label" className="flex shrink-0 items-center gap-1.5">
          <button type="button" aria-label="최대 길이 줄이기" disabled={combine <= COMBINE_LENGTH_MIN} onClick={() => setCombine(combine - 1)}
            className="h-9 w-9 rounded-lg border-2 border-slate-300 bg-white text-lg font-black text-slate-800 disabled:opacity-40">−</button>
          <span data-testid="combine-length" className="w-8 text-center font-mono text-lg font-black text-slate-900">{combine}</span>
          <button type="button" aria-label="최대 길이 늘리기" disabled={combine >= COMBINE_LENGTH_MAX} onClick={() => setCombine(combine + 1)}
            className="h-9 w-9 rounded-lg border-2 border-slate-300 bg-white text-lg font-black text-slate-800 disabled:opacity-40">＋</button>
        </div>
      </div>
      <p className="-mt-1 text-[13px] font-semibold leading-snug text-slate-500">이어지는 문제를 이 길이까지 한 문제로 묶어요 ({COMBINE_LENGTH_MIN}~{COMBINE_LENGTH_MAX})</p>
      {removed.length > 0 && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
            className="flex w-full items-center justify-between gap-3 border-t border-slate-100 pt-2 text-left text-[15px] font-black text-slate-800">
            <span>복습에서 뺀 문제 <span className="ml-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs text-rose-900">{removed.length}</span></span>
            <span aria-hidden="true" className="text-slate-500">{open ? '접기' : '보기'}</span>
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-2">
              {removed.map(({ logId, key, record }) => (
                <li key={`${logId}:${key}`} data-removed-question={key} data-removed-reason={record.reason} className="flex flex-col gap-1.5 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-black ${record.reason === 'logic' ? 'bg-rose-100 text-rose-900' : 'bg-slate-200 text-slate-800'}`}>{REMOVE_REASON_LABELS[record.reason]}</span>
                    <span className="min-w-0 flex-1 break-words text-sm font-bold text-slate-900">{record.prompt} → {record.answer}</span>
                    {onRestore && record.reason !== 'duplicate' && <button type="button" onClick={() => onRestore(logId, key)}
                      className="h-9 shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:bg-slate-100">되돌리기</button>}
                  </div>
                  {record.markedLines?.map((line, index) => (
                    <p key={`m${index}`} data-marked-line="true" className="m-0 break-words rounded bg-white px-2 py-1 font-mono text-[13px] font-semibold text-rose-900 ring-1 ring-rose-200">{line}</p>
                  ))}
                  {record.related && record.related.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {record.related.map((line, index) => (
                        <li key={`r${index}`} data-related-line="true" className="break-words text-xs font-semibold text-slate-700">{stripLogicMarks(line)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

/**
 * 노트 위의 띠: ‘고친 부분을 복습에 넣기’ 스위치(기본 켜짐)와, 고쳐서 복습에 들어간 문제가 있으면 "복습에 넣지 않기" 버튼.
 *  - 켜짐: 노트를 고치면 새로 생긴 문제가 바로 복습에 든다(새로 안 것으로 봄).
 *  - 꺼짐: 오류를 고친 것으로 보고 바뀐 문제가 이전 복습 일정을 이어받는다.
 *  - "복습에 넣지 않기": 켜진 채 고쳐 들어간 문제를 빼고, 꺼진 채 고친 것처럼 다시 계산한다(그 기록을 복습하기 전까지).
 */
export const EditIntakeBar: React.FC<{ logs: StudyLog[]; onSkip?: (logIds: string[]) => void }> = ({ logs, onSkip }) => {
  const [intake, setIntake] = useEditIntake();
  const pending = logs.map(log => ({ id: log.id, count: editIntakeCount(log) })).filter(item => item.count > 0);
  const total = pending.reduce((sum, item) => sum + item.count, 0);
  return (
    <section data-testid="edit-intake-bar" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-[15px] font-black text-slate-800">
        <span>고친 부분을 복습에 넣기</span>
        <button type="button" role="switch" aria-checked={intake} aria-label="고친 부분을 복습에 넣기" data-testid="edit-intake-switch"
          onClick={() => setIntake(!intake)}
          className={`relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors ${intake ? 'border-indigo-700 bg-indigo-600' : 'border-slate-400 bg-slate-300'}`}>
          <span aria-hidden="true" className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${intake ? 'left-[26px]' : 'left-0.5'}`} />
        </button>
      </label>
      <p data-testid="edit-intake-note" className="-mt-1 text-[13px] font-semibold leading-snug text-slate-500">
        {intake ? '켜짐: 새로 안 것으로 보고 고친 문제를 바로 복습에 넣어요' : '꺼짐: 오류를 고친 것으로 보고 바뀐 문제가 이전 복습 일정을 이어받아요'}
      </p>
      {total > 0 && onSkip && (
        <div role="status" data-testid="edit-intake-pending" className="flex flex-wrap items-center gap-3 rounded-lg bg-indigo-50 px-3 py-2">
          <span className="min-w-0 flex-1 text-sm font-bold text-indigo-950">고친 부분 {total}문제가 복습에 들어갔어요</span>
          <button type="button" data-testid="edit-intake-skip" onClick={() => onSkip(pending.map(item => item.id))}
            className="h-10 shrink-0 rounded-lg border-2 border-indigo-300 bg-white px-3 text-sm font-black text-indigo-900 hover:bg-indigo-100">복습에 넣지 않기</button>
        </div>
      )}
    </section>
  );
};
