import React, { useState } from 'react';
import type { StudyLog } from '../types';
import { NoteMergeRecord, readNoteMergeRecords, undoNoteMerge } from '../utils/noteMergeLog';
import type { NoteMergeKind } from '../utils/noteMerge';

const KIND_LABEL: Record<NoteMergeKind, string> = { link: '연결', add: '첨가', group: '묶음' };

/** 노트에 합쳐진 기록. 합치기 전 글로 되돌릴 수 있다(그 뒤에 그 글을 또 고쳤으면 덮어쓰지 않는다). */
export const NoteMergeHistory: React.FC<{ logs: StudyLog[]; onRestore: (logId: string, memo: string) => void }> = ({ logs, onRestore }) => {
  const ids = new Set(logs.map(log => log.id));
  const [records, setRecords] = useState<NoteMergeRecord[]>(() => readNoteMergeRecords());
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const mine = records.filter(record => !record.undone && ids.has(record.targetLogId));
  if (!mine.length) return null;

  const restore = (record: NoteMergeRecord) => {
    const target = logs.find(log => log.id === record.targetLogId);
    const before = undoNoteMerge(record.id, target?.reviewMemo ?? '');
    if (before === null) { setMessage('그 뒤에 글을 고쳐서 되돌릴 수 없어요.'); return; }
    onRestore(record.targetLogId, before);
    setRecords(readNoteMergeRecords());
    setMessage('');
  };

  return (
    <section data-testid="note-merge-history" className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 text-left text-[15px] font-black text-slate-800">
        <span>합친 기록 <span className="ml-1 rounded-md bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">{mine.length}</span></span>
        <span aria-hidden="true" className="text-slate-500">{open ? '접기' : '보기'}</span>
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-2">
          {[...mine].reverse().map(record => (
            <li key={record.id} data-merge-record={record.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  {record.steps.map((step, index) => (
                    <span key={index} className="inline-flex items-center gap-1 text-sm font-bold text-slate-900">
                      <span className="rounded bg-indigo-700 px-1.5 py-0.5 text-[11px] font-black text-white">{KIND_LABEL[step.kind]}</span>{step.statement}
                    </span>
                  ))}
                </span>
                <span className="text-xs font-medium text-slate-600">{new Date(record.at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}에 쓴 글이 이전 쪽에 합쳐졌어요</span>
              </span>
              <button type="button" onClick={() => restore(record)} className="h-9 shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:bg-slate-100">되돌리기</button>
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status" className="mt-2 text-sm font-bold text-amber-700">{message}</p>}
    </section>
  );
};
