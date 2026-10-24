import React, { useEffect, useState } from 'react';

/**
 * "풀이 과정" 버튼. 정답을 확인한 뒤에만 보이고, 누르면 그 문제를 푼 길(건너뛴 칸까지)이 펼쳐진다.
 * 문제가 바뀌거나 정답 확인 상태가 바뀌면 다시 접힌다.
 */
export const ProcessToggle: React.FC<{ process?: string; resetKey: string; revealed: boolean; defaultOpen?: boolean }> = ({ process, resetKey, revealed, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [resetKey, revealed, defaultOpen]);
  if (!revealed || !process) return null;
  return <div data-process-toggle="true" className="flex flex-col items-center gap-2">
    <button type="button" data-process-button="true" aria-expanded={open} onClick={() => setOpen(value => !value)}
      className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-100">
      {open ? '풀이 과정 닫기' : '풀이 과정 보기'}
    </button>
    {open && <p data-question-process="true" className="rounded-xl bg-slate-100 px-4 py-2.5 text-base font-semibold text-slate-800">
      <span className="mr-2 text-sm font-black text-slate-600">풀이 과정</span>{process}
    </p>}
  </div>;
};
