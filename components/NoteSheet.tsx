import React, { useEffect, useRef, useState } from 'react';
import type { ReviewMemoDocument, StudyLog, Subject } from '../types';
import { NoteTab } from './NoteTab';

/**
 * 과목 안의 "정리노트" 버튼을 누르면 오른쪽에서 밀려 나오는 서랍. 그 과목의 정리노트만 보여준다.
 * 다른 탭으로 가는 것이 아니라서 뒤의 학습 실행 화면이 어둡게 남아 있고, 바깥을 누르거나 닫기·Esc로 돌아온다.
 * 내용은 NoteTab 그대로(최신순 · 한 쪽씩 · 관계도 · 기호 막대).
 */
export const NoteSheet: React.FC<{
  logs: StudyLog[];
  subjects: Subject[];
  subjectId: string;
  subjectName: string;
  onUpdateReviewMemo: (logId: string, memo: string, document?: ReviewMemoDocument) => void;
  onRestoreReviewQuestion?: (logId: string, questionKey: string) => void;
  onClose: () => void;
}> = ({ logs, subjects, subjectId, subjectName, onUpdateReviewMemo, onRestoreReviewQuestion, onClose }) => {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const [shown, setShown] = useState(false);
  // onClose는 부모가 다시 그려질 때마다 새 함수일 수 있다. 글을 한 자 쓸 때마다 부모가 다시 그려지므로, 이걸 의존값으로 두면
  // 효과가 매번 다시 돌며 닫기 버튼으로 포커스를 가져가 버린다(한 글자 쓰면 다시 눌러야 하는 문제). 그래서 최신 값만 ref에 두고 효과는 열릴 때 한 번만 돈다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={`${subjectName} 정리노트`} data-testid="note-sheet"
      className="fixed inset-0 z-[10000] flex justify-end">
      <button type="button" tabIndex={-1} aria-label="정리노트 닫기" onClick={onClose} data-testid="note-sheet-backdrop"
        className={`absolute inset-0 cursor-default bg-slate-900/40 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`} />
      <aside className={`relative flex h-full w-[min(780px,94vw)] flex-col bg-[#F4F6FD] shadow-2xl transition-transform duration-200 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5">
          <h2 className="flex min-w-0 items-center gap-2.5 text-xl font-black text-slate-900">
            <span aria-hidden="true">📒</span>
            <span className="truncate">{subjectName}</span>
            <span className="shrink-0 text-base font-bold text-slate-600">정리노트</span>
          </h2>
          <button ref={closeButton} type="button" onClick={onClose}
            className="flex h-12 shrink-0 items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-5 text-[15px] font-black text-slate-900 hover:bg-slate-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <NoteTab logs={logs} subjects={subjects} onUpdateReviewMemo={onUpdateReviewMemo} onRestoreReviewQuestion={onRestoreReviewQuestion}
            initialSubjectId={subjectId} lockSubject reservedOffset={-80} />
        </div>
      </aside>
    </div>
  );
};
