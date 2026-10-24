import { Subject } from '../types';
import { getAllSubjectReviewIds, getSubjectStages } from './schedule';

/**
 * 과목 셀 제목에 쓰는 "이어진 과목" 한 칸. 과목 자신(처음)과 그 뒤의 후행과목이 차례로 놓이고,
 * 각 칸에는 그 과목에 붙은 복습과목 이름이 따라온다.
 */
export interface SubjectChainSegment {
  id: string;
  name: string;
  isFollowUp: boolean;
  /** 지금 공부하고 있는 칸 */
  isCurrent: boolean;
  /** 이미 끝낸 칸 */
  isCompleted: boolean;
  reviewNames: string[];
}

export const getSubjectChain = (subject: Subject, subjects: Subject[]): SubjectChainSegment[] => {
  const nameById = new Map(subjects.map(item => [item.id, item.name]));
  return getSubjectStages(subject).map(stage => ({
    id: stage.id,
    name: stage.name,
    isFollowUp: stage.isFollowUp,
    isCurrent: stage.status === 'current',
    isCompleted: stage.status === 'completed',
    reviewNames: stage.reviewSubjectIds.map(id => nameById.get(id)).filter((name): name is string => Boolean(name))
  }));
};

/** 이름만 이은 글자: 후행과목은 "-"로 잇고, 복습과목은 대괄호 안에 둔다. 예: "A-B[C]-D", "A[C, E]" */
export const formatSubjectChain = (segments: SubjectChainSegment[]) => segments
  .map(segment => `${segment.name}${segment.reviewNames.length > 0 ? `[${segment.reviewNames.join(', ')}]` : ''}`)
  .join('-');

/** 후행과목이나 복습과목이 하나라도 붙어 있어서 제목에 이어서 보여줄 것이 있는가 */
export const hasSubjectChain = (segments: SubjectChainSegment[]) => (
  segments.length > 1 || segments.some(segment => segment.reviewNames.length > 0)
);

/**
 * 하루 평균 공부 시간을 셀 때 한 묶음으로 보는 것: 지금 공부 중인 단계(과목 자신 또는 후행과목 한 칸)와
 * 그 단계에 붙은 복습과목. 후행과목은 앞 단계를 모두 끝낸 다음날부터 시작하므로 같이 세지 않는다.
 * 복습과목이나 후행과목 원본의 id를 주면 그것을 거느린 과목의 해당 단계 묶음을 돌려준다.
 */
export interface SubjectFamily {
  ownerId: string;
  /** 이 묶음의 단계. 과목 자신이면 과목 id, 후행과목이면 그 후행과목 id */
  stageId: string;
  /** 단계가 후행과목이고 다른 과목을 합쳐 만든 것이면 합쳐지기 전 원래 과목 id (그 기록도 이 단계의 공부다) */
  sourceSubjectId?: string;
  reviewIds: Set<string>;
}

export const getSubjectFamily = (subjects: Subject[], subjectId: string, stageIdHint?: string): SubjectFamily => {
  const owner = subjects.find(subject => getAllSubjectReviewIds(subject).includes(subjectId))
    || subjects.find(subject => (subject.followUpSubjects || []).some(stage => stage.sourceSubjectId === subjectId))
    || subjects.find(subject => subject.id === subjectId);
  if (!owner) return { ownerId: subjectId, stageId: subjectId, reviewIds: new Set([subjectId]) };
  const stages = getSubjectStages(owner);
  const holdingReview = owner.id === subjectId ? [] : stages.filter(item => item.reviewSubjectIds.includes(subjectId));
  const sourceStageId = (owner.followUpSubjects || []).find(item => item.sourceSubjectId === subjectId)?.id;
  const stage = holdingReview.find(item => item.id === stageIdHint)
    || holdingReview.find(item => item.status === 'current')
    || holdingReview[0]
    || stages.find(item => item.id === sourceStageId)
    || stages.find(item => item.id === stageIdHint)
    || stages.find(item => item.status === 'current')
    || stages[stages.length - 1];
  const followUp = (owner.followUpSubjects || []).find(item => item.id === stage.id);
  return {
    ownerId: owner.id,
    stageId: stage.id,
    sourceSubjectId: followUp?.sourceSubjectId,
    reviewIds: new Set(stage.reviewSubjectIds)
  };
};

/** 이 묶음의 "공부" 기록인가: 단계가 같은 과목 자신의 기록, 또는 이 단계가 합쳐 만든 원래 과목의 기록. 복습 세션은 세지 않는다. */
export const isFamilyStudyLog = (family: SubjectFamily, log: { subjectId: string; subjectStageId?: string; reviewParentSubjectId?: string }) => {
  if (log.reviewParentSubjectId) return false;
  if (family.sourceSubjectId && log.subjectId === family.sourceSubjectId) return true;
  return log.subjectId === family.ownerId && (log.subjectStageId || family.ownerId) === family.stageId;
};
