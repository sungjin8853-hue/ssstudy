import React, { useState } from 'react';
import { StudyLog, Subject } from '../types';
import { getSubjectStages } from '../utils/schedule';
import { getStageMinutesPerPage, isStageMeasured } from '../utils/weekPlan';
import { pagePositionLabel, pageWord } from '../utils/pageLabel';

export interface TempStageRow {
  id: string;
  name: string;
  /** 지금 정해 둔 한 장당 시간(임시값, 분). 없으면 0 */
  temp: number;
  /** 지금 쓰는 예상 한 장당 시간(분) */
  estimate: number;
  /** 지금 하고 있는 단계(아직 재지 않음) */
  current?: boolean;
}

/**
 * 한 장당 시간(임시값)을 손으로 정할 수 있는 단계들(1일 요청: 학습 실행에서 고친다).
 *  - 지금 단계: 아직 한 번도 재지 않았을 때만(재면 잰 값이 먼저라 임시값은 쓰이지 않는다)
 *  - 아직 시작하지 않은 후행과목: 늘(재기 전까지 예상 = 지금 단계의 잰 효율 × 후행 임시값 ÷ 지금 단계 임시값)
 */
export const getTempStageRows = (subjects: Subject[], logs: StudyLog[], subject: Subject): TempStageRow[] => {
  const stages = getSubjectStages(subject).filter(stage => stage.status !== 'completed');
  const tempOf = (stageId: string) => (stageId === subject.id
    ? Number(subject.initialAverageTimePerPage) || 0
    : Number((subject.followUpSubjects || []).find(item => item.id === stageId)?.initialAverageTimePerPage) || 0);
  return stages
    .filter(stage => stage.status === 'current' ? !isStageMeasured(subjects, logs, subject, stage.id) : stage.isFollowUp)
    .map(stage => ({ id: stage.id, name: stage.name, temp: tempOf(stage.id), estimate: getStageMinutesPerPage(subjects, logs, subject, stage.id), current: stage.status === 'current' }));
};

/** 임시값을 과목에 적는다: 과목 자신이면 과목의 임시값, 후행과목이면 그 후행과목의 임시값. 비우면(undefined) 지운다 */
export const withStageTemp = (subject: Subject, stageId: string, minutes: number | undefined): Subject => (stageId === subject.id
  ? { ...subject, initialAverageTimePerPage: minutes }
  : { ...subject, followUpSubjects: (subject.followUpSubjects || []).map(item => item.id === stageId ? { ...item, initialAverageTimePerPage: minutes } : item) });

/**
 * 단계별 한 장당 시간(임시값) 칸. 예상은 지금 과목의 효율을 따라 바뀐다. 후행과목을 한 장이라도 재면 잰 값이 먼저다.
 * 비우면 임시값을 지운다(후행과목은 합쳐 만든 원래 과목의 임시값, 없으면 지금 과목의 효율을 쓴다).
 */
export const FollowUpTempEditor: React.FC<{
  stages: TempStageRow[];
  pageLabel: string;
  onSave: (stageId: string, minutes: number | undefined) => void;
}> = ({ stages, pageLabel, onSave }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const commit = (stageId: string) => {
    const raw = drafts[stageId];
    if (raw === undefined) return;
    const value = Number(raw);
    onSave(stageId, raw.trim() === '' ? undefined : Number.isFinite(value) && value > 0 ? value : undefined);
    setDrafts(current => { const next = { ...current }; delete next[stageId]; return next; });
  };
  return (
    <div data-testid="follow-up-temp" className="flex flex-col gap-3">
      <p className="text-sm font-bold leading-relaxed text-slate-600">한 {pageWord(pageLabel)}당 시간 임시값이에요. 아직 재지 않은 과목의 예상 시간에 쓰이고, 후행과목의 예상은 지금 과목의 효율을 따라 바뀌어요.</p>
      <div className="flex flex-col gap-2">
        {stages.map(stage => (
          <div key={stage.id} data-testid="follow-up-temp-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">
              {stage.name}
              {stage.current && <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-black text-indigo-700">지금 · 측정 전</span>}
            </span>
            <span data-testid="follow-up-temp-estimate" className="font-mono text-sm font-bold tabular-nums text-indigo-700">
              {stage.estimate > 0 ? `예상 ${stage.estimate.toFixed(1)}분/${pagePositionLabel(pageLabel)}` : '예상 없음'}
            </span>
            <label className="flex items-center gap-1 text-[13px] font-bold text-slate-600">
              <input data-testid="follow-up-temp-input" type="number" min="0" step="0.1" inputMode="decimal" aria-label={`${stage.name} 한 장당 시간(분)`}
                value={drafts[stage.id] ?? (stage.temp > 0 ? String(stage.temp) : '')} placeholder="임시값"
                onChange={event => setDrafts(current => ({ ...current, [stage.id]: event.target.value }))}
                onBlur={() => commit(stage.id)} onKeyDown={event => { if (event.key === 'Enter') commit(stage.id); }}
                className="h-11 w-24 rounded-xl border border-slate-200 bg-white px-2 text-center font-mono text-base font-black tabular-nums outline-none focus:border-indigo-500" />
              분
            </label>
          </div>
        ))}
      </div>
    </div>
  );
};

/** 학습 실행 화면의 "임시값" 창 */
export const StageTempDialog: React.FC<{
  subject: Subject;
  subjects: Subject[];
  logs: StudyLog[];
  pageLabel: string;
  onUpdateSubjects: (subjects: Subject[]) => void;
  onClose: () => void;
}> = ({ subject, subjects, logs, pageLabel, onUpdateSubjects, onClose }) => {
  const rows = getTempStageRows(subjects, logs, subject);
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="한 장당 시간 임시값" data-testid="stage-temp-dialog"
        className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xl font-black text-slate-900">{subject.name} · 임시값</h4>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-11 w-11 items-center justify-center rounded-full text-xl font-black text-slate-500 hover:bg-slate-100">×</button>
        </div>
        {rows.length
          ? <FollowUpTempEditor pageLabel={pageLabel} stages={rows} onSave={(stageId, minutes) => onUpdateSubjects([withStageTemp(subject, stageId, minutes)])} />
          : <p className="text-sm font-bold text-slate-600">정할 임시값이 없어요. 지금 과목은 이미 재었고 남은 후행과목도 없어요.</p>}
        <button type="button" onClick={onClose} className="h-12 rounded-xl bg-indigo-600 text-sm font-black text-white hover:bg-indigo-700">확인</button>
      </div>
    </div>
  );
};
