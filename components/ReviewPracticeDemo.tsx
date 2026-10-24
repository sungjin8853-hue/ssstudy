import React, { useMemo, useState } from 'react';
import type { StudyLog, Subject } from '../types';
import { SessionLogger } from './SessionLogger';
import { buildReviewQuestions, getReviewQuestionClassification, REVIEW_QUESTION_KIND_LABELS } from '../utils/reviewQuestions';
import { createSessionMemoRecord } from '../utils/sessionMemo';
import { applyReviewGateOutcomes, clearReviewGateRetries, completeRegularReviewSchedule, updateReviewGateMemo } from '../utils/reviewGate';
import { recordReviewMeasurement } from '../utils/review';
import { calculateQuestionPerformance } from '../utils/reviewPractice';
import { getLocalDateKey } from '../utils/schedule';

const examples = [
  { name: '세션 메모 분류 · 중첩', memo: 'a:b:c / x:(y:z):(p:q)' },
  { name: '순서 관계 · 학습 과정', memo: '학습 과정:읽기-정리-확인' },
  { name: '깊은 논리 중첩 · 여러 조건', memo: '성립:(a,b),(c,(d,e))' },
  { name: '순서와 논리 중첩', memo: '학습 완료:(읽기-정리-확인),(문제,(예제-점검))' },
  { name: '다층 AND', memo: '성립:((a,b),(c,d)),(e,(f,g))' },
  { name: '오답 순환 · 4문제', memo: '1:첫 번째 답 / 2:두 번째 답 / 3:세 번째 답 / 4:네 번째 답' },
  { name: '중첩 관계', memo: 'a:(b:c):(d:c)' },
  { name: '일부 조건', memo: '성립:(a,b),(c,d)' },
  { name: '연속 관점', memo: 'a:b:c:d' },
  { name: '거꾸로만 (<)', memo: '공차<이웃한 두 항의 차 / 합<더한 값' },
  { name: '앞으로만 (;)', memo: '공차;이웃한 두 항의 차 / 합;더한 값' },
  { name: '한 칸 안의 등호 (=)', memo: 'A:B=C:D / E=F:G' },
  { name: '상하위 토글', memo: ':::toggle 자동차:\n:::toggle 엔진:\n전기:모터\n가솔린:내연기관\n:::end\n타이어:접지\n:::end' },
  { name: '기본 관계 · 역방향', memo: '엔진:동력을 만드는 장치' },
  { name: '노트 회상', memo: '자동차는 동력을 바퀴에 전달하여 움직인다.' }
];
const formatInterval = (milliseconds: number) => milliseconds < 86400000
  ? `${Number((milliseconds / 3600000).toFixed(2))}시간`
  : `${Number((milliseconds / 86400000).toFixed(2))}일`;
const parentId = 'note-logic-demo-parent';
const materialId = 'note-logic-demo-material';
const seedLog = (memo: string, priorReviews: number): StudyLog => ({
  id: 'note-logic-demo-log', subjectId: parentId, pagesRead: 4, startPage: 1, endPage: 4,
  timeSpentMinutes: 12, timestamp: new Date(Date.now() - 86400000).toISOString(), reviewEnabled: true,
  reviewStep: priorReviews, reviewMemo: memo, reviewQuestionFormat: 2,
  nextReviewDate: new Date(Date.now() - 1000).toISOString(),
  reviewQuestionSchedules: Object.fromEntries(buildReviewQuestions(memo).questions.map(question => [question.key, {
    reviewStep: priorReviews, nextReviewDate: new Date(Date.now() - 1000).toISOString(), wrongCount: 0, attempts: priorReviews
  }]))
});

export default function ReviewPracticeDemo() {
  const [memo, setMemo] = useState(examples[0].memo);
  const [sessionMemo, setSessionMemo] = useState('[대상:설명:예시]');
  const [priorReviews, setPriorReviews] = useState(3);
  const [linked, setLinked] = useState(false);
  const [run, setRun] = useState(0);
  const [logs, setLogs] = useState<StudyLog[]>(() => [seedLog(examples[0].memo, 3)]);
  const [detailId, setDetailId] = useState(parentId);
  const subjects = useMemo<Subject[]>(() => [
    { id: parentId, name: '문제화 테스트', startPage: 1, totalPages: 4, completedPages: 4,
      targetDate: getLocalDateKey(), reviewSubjectIds: linked ? [materialId] : [] },
    ...(linked ? [{ id: materialId, name: '연결된 복습과목', startPage: 1, totalPages: 100, completedPages: 0, targetDate: getLocalDateKey() }] : [])
  ], [linked]);
  const catalog = useMemo(() => buildReviewQuestions(memo).questions, [memo]);
  const sessionMemoOverrides = useMemo(() => ({ [parentId]: sessionMemo }), [sessionMemo]);
  const criterion = createSessionMemoRecord(sessionMemo).classificationCriterion;
  const start = () => { setLogs([seedLog(memo, priorReviews)]); setRun(value => value + 1); };
  const complete = (ids: string[]) => setLogs(previous => previous.map(log => ids.includes(log.id)
    ? { ...log, ...completeRegularReviewSchedule(log, Date.now()) } : log));
  return <main className="mx-auto max-w-5xl space-y-5 p-4 text-slate-800 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-black">노트 문제화 테스트</h1>
      <a className="text-sm font-bold text-slate-500" href="/">학습 화면</a>
    </header>
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-bold">예제 <select aria-label="예제" className="ml-2 rounded-lg bg-slate-100 p-2" onChange={event => setMemo(examples[Number(event.target.value)].memo)}>
          {examples.map((example, index) => <option key={example.name} value={index}>{example.name}</option>)}
        </select></label>
        <label className="text-sm font-bold">가상 이전 복습 횟수 <input aria-label="가상 이전 복습 횟수" type="number" min={0} max={10} value={priorReviews}
          onChange={event => setPriorReviews(Math.min(10, Math.max(0, Number(event.target.value) || 0)))} className="ml-2 w-16 rounded-lg bg-slate-100 p-2" /></label>
        <label className="text-sm font-bold"><input type="checkbox" checked={linked} onChange={event => setLinked(event.target.checked)} /> 복습과목 연결</label>
      </div>
      <label className="block text-sm font-bold">세션 메모
        <input aria-label="테스트 세션 메모" value={sessionMemo} onChange={event => setSessionMemo(event.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-base font-normal" spellCheck={false} />
      </label>
      <textarea aria-label="테스트 정리노트" value={memo} onChange={event => setMemo(event.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-base" spellCheck={false} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">가상 데이터 · 실제 기록에 저장되지 않음</span>
        <button type="button" onClick={start} className="rounded-xl bg-slate-900 px-5 py-3 font-bold text-white">이 노트로 다시 시작</button>
      </div>
    </section>
    <SessionLogger key={run} subjects={subjects} logs={logs} activeWeekday={new Date().getDay()} activeStudyDate={getLocalDateKey()}
      sessionMemoOverrides={sessionMemoOverrides}
      detailSubjectId={detailId} onDetailSubjectChange={setDetailId} renderSummary={selector => <section className="rounded-2xl bg-white p-4">{selector}</section>}
      onLogSession={log => setLogs(previous => [...previous, log])}
      onReviewAction={(ids, action) => action === 'complete' ? complete(ids) : setLogs(previous => previous.map(log => ids.includes(log.id) ? { ...log, isCondensed: true } : log))}
      onFinishReviewGate={(outcomes, retry) => setLogs(previous => applyReviewGateOutcomes(previous, outcomes, retry, Date.now()))}
      onClearReviewGateRetries={ids => setLogs(previous => clearReviewGateRetries(previous, ids))}
      onUpdateReviewMemo={(id, value, doc) => setLogs(previous => previous.map(log => log.id === id ? updateReviewGateMemo(log, value, doc) : log))}
      onRecordReviewSubjectTime={(ids, subjectId, minutes, measurement) => setLogs(previous => recordReviewMeasurement(previous, ids, subjectId, minutes, false, new Date().toISOString(), measurement))}
      onAdvanceReviewSubject={(ids, subjectId, nextId, minutes, measurement) => setLogs(previous => recordReviewMeasurement(previous, ids, subjectId, minutes, true, new Date().toISOString(), measurement).map(log => !ids.includes(log.id) ? log
        : nextId ? { ...log, reviewSubjectId: nextId } : { ...log, ...completeRegularReviewSchedule(log, Date.now()) }))}
    />
    <details className="rounded-2xl border border-slate-200 bg-white p-4" open>
      <summary className="cursor-pointer font-bold">생성된 문제 {catalog.length}개 · 출제 순서</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b text-slate-500"><th className="p-2">중요도 / 난도</th><th className="p-2">회상 / 제공</th><th className="p-2">유형 · 조건</th><th className="p-2">문제</th><th className="p-2">답</th><th className="p-2">복습 간격</th></tr></thead>
        <tbody>{catalog.map(question => {
          const recorded = logs[0]?.reviewQuestionSchedules?.[question.key];
          const labels = getReviewQuestionClassification(criterion, question);
          return <tr key={question.key} className="border-b border-slate-100">
            <td className="p-2">{question.priority} / {question.level}</td>
            <td className="p-2 whitespace-nowrap">{question.recallUnits} / {question.providedUnits}</td>
            <td className="p-2">{REVIEW_QUESTION_KIND_LABELS[question.kind]}<div className="text-xs text-slate-500">{question.conditions.map((condition, index) =>
              `${labels.conditions[index].length ? labels.conditions[index].join(' · ') + ': ' : ''}${condition}`).join(' · ')}</div></td>
            <td className="p-2 font-bold"><div className="text-xs font-normal text-slate-500">{labels.prompt.join(' · ')}</div>{question.prompt}</td>
            <td className="p-2"><div className="text-xs text-slate-500">{labels.answer.join(' · ')}</div>{question.answer}</td>
            <td className="p-2">{recorded?.intervalMs ? `${formatInterval(recorded.intervalMs)} · 오답 ${recorded.wrongCount || 0}` : '미측정'}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </details>
    <section className="rounded-2xl bg-slate-100 p-4 text-sm">
      {[0, 1, 2, 3].map(count => `오답 ${count}회 → ${formatInterval(calculateQuestionPerformance({ reviewStep: priorReviews }, count, count + 1).intervalMs)}`).join(' · ')}
    </section>
  </main>;
}
