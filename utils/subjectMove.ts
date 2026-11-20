import type { FollowUpSubject, StudyLog, Subject } from '../types';

/**
 * 19일 "복습과목을 수정 버튼을 누르고 측정 방식 밑에서 위치변경 및 유형 변환이 가능하게 … 후행과목도 똑같이 수정가능하며":
 * 복습과목과 후행과목을 일반 과목으로 돌리거나, 다른 과목의 복습과목 · 후행과목으로 옮긴다.
 * 시작 날짜(비우면 오늘, 다른 과목의 끝 날짜를 가져올 수도 있다)와 끝 날짜를 함께 쓴다.
 *  - "밑에 딸린 복습과목은 같이 이동한다".
 *  - "후행과목이 복습과목이 된다면, 그 후행과목 밑 복습과목은 후행과목이 새롭게 가지게 된 상위과목을 가지게 되어 후행과목 밑에서 벗어난다".
 */
export type SubjectMover =
  /** 과목 하나(복습과목이거나 일반 과목) */
  | { kind: 'subject'; id: string }
  /** 어떤 과목의 후행과목 한 단계 */
  | { kind: 'stage'; ownerId: string; stageId: string };

export type SubjectMoveTarget =
  /** 어디에도 붙지 않은 일반 과목 */
  | { kind: 'standalone' }
  /** ownerId 과목(stageId가 후행과목 id면 그 단계)의 복습과목 */
  | { kind: 'review'; ownerId: string; stageId?: string }
  /** ownerId 과목의 후행과목(과목이면 과목 자체가 그 과목의 한 단계가 된다) */
  | { kind: 'followUp'; ownerId: string };

/** 지금 이 과목 · 단계가 놓인 자리 */
export type SubjectPlace =
  | { kind: 'standalone' }
  | { kind: 'review'; ownerId: string; stageId: string }
  | { kind: 'followUp'; ownerId: string };

export interface SubjectMovePlan {
  /** 바뀐 과목들만(저장할 것) */
  changed: Subject[];
  /** 후행과목이 되어 목록에서 빠지는 과목 */
  removedSubjectId: string | null;
  /** 새로 생기는 과목(후행과목이 홀로 서거나 복습과목이 될 때) */
  addedSubject: Subject | null;
  /** 학습 기록을 옮길 곳 */
  logMove: { fromSubjectId: string; fromStageId?: string; toSubjectId: string; toStageId: string } | null;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 이 과목이 누구의 복습과목인가(어느 단계의 것인지까지) */
export const findSubjectPlace = (subjects: readonly Subject[], subjectId: string): SubjectPlace => {
  for (const owner of subjects) {
    if ((owner.reviewSubjectIds || []).includes(subjectId)) return { kind: 'review', ownerId: owner.id, stageId: owner.id };
    for (const stage of owner.followUpSubjects || []) {
      if ((stage.reviewSubjectIds || []).includes(subjectId)) return { kind: 'review', ownerId: owner.id, stageId: stage.id };
    }
  }
  return { kind: 'standalone' };
};

/** 옮길 수 없는 곳(자기 자신과, 자기 밑에 달린 과목들) */
export const subjectsUnderSubject = (subjects: readonly Subject[], subjectId: string): Set<string> => {
  const under = new Set<string>([subjectId]);
  for (let guard = 0; guard < subjects.length + 1; guard += 1) {
    const before = under.size;
    subjects.forEach(subject => {
      if (!under.has(subject.id)) return;
      (subject.reviewSubjectIds || []).forEach(id => under.add(id));
      (subject.followUpSubjects || []).forEach(stage => (stage.reviewSubjectIds || []).forEach(id => under.add(id)));
    });
    if (under.size === before) break;
  }
  return under;
};

const detach = (owner: Subject, subjectId: string): Subject => {
  const inOwn = (owner.reviewSubjectIds || []).includes(subjectId);
  const inStage = (owner.followUpSubjects || []).some(stage => (stage.reviewSubjectIds || []).includes(subjectId));
  if (!inOwn && !inStage) return owner;
  return {
    ...owner,
    ...(inOwn ? { reviewSubjectIds: (owner.reviewSubjectIds || []).filter(id => id !== subjectId) } : {}),
    ...(inStage ? { followUpSubjects: (owner.followUpSubjects || []).map(stage => ((stage.reviewSubjectIds || []).includes(subjectId)
      ? { ...stage, reviewSubjectIds: (stage.reviewSubjectIds || []).filter(id => id !== subjectId) } : stage)) } : {}),
  };
};

/** 과목을 그 과목의 후행과목 한 단계로 바꾼다(기록이 이어지도록 단계 id는 과목 id를 그대로 쓴다) */
const asFollowUp = (subject: Subject): FollowUpSubject => ({
  id: subject.id,
  sourceSubjectId: subject.id,
  name: subject.name,
  startPage: Math.max(1, Math.round(subject.startPage ?? 1)),
  endPage: Math.max(1, Math.round(subject.totalPages)),
  completedPage: Math.max(0, Math.round(subject.completedPages)),
  reviewSubjectIds: [...(subject.reviewSubjectIds || [])],
  ...(subject.chapters?.length ? { chapters: subject.chapters.map(item => ({ ...item })) } : {}),
  ...(subject.initialAverageTimePerPage ? { initialAverageTimePerPage: subject.initialAverageTimePerPage } : {}),
  ...(subject.isRequired === undefined ? {} : { isRequired: subject.isRequired }),
  ...(subject.pageLabel ? { pageLabel: subject.pageLabel } : {}),
});

/** 후행과목 한 단계를 홀로 선 과목으로 바꾼다(단계 id를 과목 id로 그대로 쓴다) */
const asSubject = (stage: FollowUpSubject, owner: Subject, dates: { startDate: string; targetDate: string }): Subject => ({
  id: stage.id,
  name: stage.name,
  startPage: stage.startPage,
  totalPages: stage.endPage,
  completedPages: stage.completedPage,
  targetDate: dates.targetDate || owner.targetDate,
  planResetDate: dates.startDate,
  createdAt: owner.createdAt,
  materialType: owner.materialType,
  isRequired: stage.isRequired ?? owner.isRequired,
  pageLabel: stage.pageLabel ?? owner.pageLabel,
  growthPageUnit: owner.growthPageUnit,
  tagIds: owner.tagIds,
  scheduledWeekdays: owner.scheduledWeekdays,
  scheduledWeekdayPages: {},
  reviewSubjectIds: [],
  ...(stage.chapters?.length ? { chapters: stage.chapters.map(item => ({ ...item })) } : {}),
  ...(stage.initialAverageTimePerPage ? { initialAverageTimePerPage: stage.initialAverageTimePerPage } : {}),
});

const attachReview = (owner: Subject, stageId: string, ids: string[]): Subject => (stageId === owner.id
  ? { ...owner, reviewSubjectIds: [...(owner.reviewSubjectIds || []).filter(id => !ids.includes(id)), ...ids] }
  : {
    ...owner,
    followUpSubjects: (owner.followUpSubjects || []).map(stage => (stage.id === stageId
      ? { ...stage, reviewSubjectIds: [...(stage.reviewSubjectIds || []).filter(id => !ids.includes(id)), ...ids] } : stage))
  });

/**
 * 옮기기 계획을 세운다(저장은 부르는 쪽에서 한다). startDate가 비면 todayKey를 쓴다.
 * 자기 자신이나 자기 밑에 달린 과목으로는 옮기지 않는다(고리가 생긴다).
 */
export const planSubjectMove = (
  subjects: readonly Subject[],
  mover: SubjectMover,
  target: SubjectMoveTarget,
  dates: { startDate?: string; targetDate?: string },
  todayKey: string
): SubjectMovePlan | null => {
  const startDate = dates.startDate || todayKey;
  const changed = new Map<string, Subject>();
  const put = (subject: Subject) => changed.set(subject.id, subject);
  const ownerOf = (id: string) => changed.get(id) ?? subjects.find(subject => subject.id === id);

  if (mover.kind === 'subject') {
    const moving = subjects.find(subject => subject.id === mover.id);
    if (!moving) return null;
    const blocked = subjectsUnderSubject(subjects, mover.id);
    if (target.kind !== 'standalone' && (blocked.has(target.ownerId) || !subjects.some(item => item.id === target.ownerId))) return null;
    // 1) 지금 붙어 있는 자리에서 뗀다
    subjects.forEach(owner => {
      if (owner.id === mover.id) return;
      const next = detach(owner, mover.id);
      if (!sameJson(next, owner)) put(next);
    });
    const dated: Subject = { ...moving, planResetDate: startDate, ...(dates.targetDate ? { targetDate: dates.targetDate } : {}) };
    if (target.kind === 'followUp') {
      // 20일 버그: 제 후행과목을 가진 과목을 한 단계로 바꾸면 그 단계들이 사라진다 — 먼저 그 단계들을 옮기게 막는다
      if ((moving.followUpSubjects || []).length) return null;
      const owner = ownerOf(target.ownerId);
      if (!owner) return null;
      put({ ...owner, followUpSubjects: [...(owner.followUpSubjects || []), asFollowUp(dated)] });
      changed.delete(mover.id);
      return { changed: [...changed.values()], removedSubjectId: mover.id, addedSubject: null,
        logMove: { fromSubjectId: mover.id, toSubjectId: owner.id, toStageId: mover.id } };
    }
    put(dated);
    if (target.kind === 'review') {
      const owner = ownerOf(target.ownerId);
      if (!owner) return null;
      put(attachReview(owner, target.stageId || owner.id, [mover.id]));
    }
    return { changed: [...changed.values()], removedSubjectId: null, addedSubject: null, logMove: null };
  }

  // 후행과목 한 단계 옮기기
  const owner = subjects.find(subject => subject.id === mover.ownerId);
  const stage = (owner?.followUpSubjects || []).find(item => item.id === mover.stageId);
  if (!owner || !stage) return null;
  const blocked = subjectsUnderSubject(subjects, mover.stageId);
  if (target.kind !== 'standalone' && (blocked.has(target.ownerId) || !subjects.some(item => item.id === target.ownerId))) return null;
  if (target.kind === 'followUp' && target.ownerId === owner.id) return null;
  put({ ...owner, followUpSubjects: (owner.followUpSubjects || []).filter(item => item.id !== mover.stageId) });

  if (target.kind === 'followUp') {
    const next = ownerOf(target.ownerId);
    if (!next) return null;
    // 유형 그대로 옮긴다: 밑에 딸린 복습과목도 단계와 함께 간다
    put({ ...next, followUpSubjects: [...(next.followUpSubjects || []), { ...stage }] });
    return { changed: [...changed.values()], removedSubjectId: null, addedSubject: null,
      logMove: { fromSubjectId: owner.id, fromStageId: mover.stageId, toSubjectId: next.id, toStageId: mover.stageId } };
  }

  const created = asSubject(stage, owner, { startDate, targetDate: dates.targetDate || '' });
  if (target.kind === 'standalone') {
    // 홀로 서면 밑에 딸린 복습과목도 그대로 데려간다
    const added: Subject = { ...created, reviewSubjectIds: [...(stage.reviewSubjectIds || [])] };
    return { changed: [...changed.values()], removedSubjectId: null, addedSubject: added,
      logMove: { fromSubjectId: owner.id, fromStageId: mover.stageId, toSubjectId: added.id, toStageId: added.id } };
  }
  // 복습과목이 되면 밑에 딸린 복습과목은 새로 가지게 된 상위과목으로 올라가 후행과목 밑에서 벗어난다
  const next = ownerOf(target.ownerId);
  if (!next) return null;
  const stageId = target.stageId || next.id;
  put(attachReview(next, stageId, [created.id, ...(stage.reviewSubjectIds || [])]));
  return { changed: [...changed.values()], removedSubjectId: null, addedSubject: created,
    logMove: { fromSubjectId: owner.id, fromStageId: mover.stageId, toSubjectId: created.id, toStageId: created.id } };
};

/** 옮긴 과목 · 단계의 학습 기록을 새 자리로 옮긴다(기록이 사라지지 않게) */
export const applySubjectLogMove = (logs: readonly StudyLog[], move: NonNullable<SubjectMovePlan['logMove']>): StudyLog[] => logs.map(log => {
  const here = move.fromStageId
    ? log.subjectId === move.fromSubjectId && (log.subjectStageId || log.subjectId) === move.fromStageId
    : log.subjectId === move.fromSubjectId;
  return here ? { ...log, subjectId: move.toSubjectId, subjectStageId: move.toStageId } : log;
});
