import { Subject } from '../types';
import { getLocalDateKey } from './schedule';

export type SequenceSubject = Subject & {
  sequenceRootId?: string;
  sequenceActiveSubjectId?: string;
  sequenceActiveSubjectName?: string;
  sequenceActiveTotalPages?: number;
  sequenceActiveCompletedPages?: number;
  sequenceActiveTargetDate?: string;
  sequenceSubjectIds?: string[];
  sequenceSubjects?: Subject[];
  sequenceStageIndex?: number;
  sequenceStageCount?: number;
  sequenceFinalTargetDate?: string;
};

const byId = (subjects: Subject[]) => new Map(subjects.map(subject => [subject.id, subject]));

export const isSequenceChild = (subject: Subject) => Boolean(subject.linkedParentId);

export const getSubjectSequence = (root: Subject, subjects: Subject[]) => {
  const subjectMap = byId(subjects);
  const visited = new Set<string>();
  const sequence: Subject[] = [];

  const addSubject = (subject?: Subject) => {
    if (!subject || visited.has(subject.id)) return;
    visited.add(subject.id);
    sequence.push(subject);
    (subject.linkedSubjectIds || []).forEach(nextId => addSubject(subjectMap.get(nextId)));
  };

  addSubject(root);
  return sequence;
};

export const getSequenceRootSubject = (subject: Subject, subjects: Subject[]) => {
  const subjectMap = byId(subjects);
  const visited = new Set<string>();
  let current = subject;

  while (current.linkedParentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = subjectMap.get(current.linkedParentId) || current;
    if (!current.linkedParentId) break;
  }

  return current;
};

export const getActiveSequenceSubject = (root: Subject, subjects: Subject[], from = new Date()) => {
  const sequence = getSubjectSequence(root, subjects);
  const todayKey = getLocalDateKey(from);
  const unfinished = sequence.filter(subject => subject.completedPages < subject.totalPages);

  if (unfinished.length === 0) {
    return sequence[sequence.length - 1] || root;
  }

  return unfinished.find(subject => subject.targetDate >= todayKey) || unfinished[0];
};

export const getSequenceDisplaySubject = (root: Subject, subjects: Subject[], from = new Date()): SequenceSubject => {
  const sequence = getSubjectSequence(root, subjects);
  const activeSubject = getActiveSequenceSubject(root, subjects, from);
  const totalPages = sequence.reduce((sum, subject) => sum + subject.totalPages, 0);
  const completedPages = sequence.reduce((sum, subject) => sum + Math.min(subject.completedPages, subject.totalPages), 0);
  const stageIndex = Math.max(0, sequence.findIndex(subject => subject.id === activeSubject.id));
  const finalTargetDate = sequence
    .map(subject => subject.targetDate)
    .filter(Boolean)
    .sort()
    .at(-1) || root.targetDate;

  return {
    ...root,
    totalPages,
    completedPages,
    targetDate: finalTargetDate,
    sequenceRootId: root.id,
    sequenceActiveSubjectId: activeSubject.id,
    sequenceActiveSubjectName: activeSubject.name,
    sequenceActiveTotalPages: activeSubject.totalPages,
    sequenceActiveCompletedPages: activeSubject.completedPages,
    sequenceActiveTargetDate: activeSubject.targetDate,
    sequenceSubjectIds: sequence.map(subject => subject.id),
    sequenceSubjects: sequence,
    sequenceStageIndex: stageIndex + 1,
    sequenceStageCount: sequence.length,
    sequenceFinalTargetDate: finalTargetDate
  };
};

export const buildSequenceDisplaySubjects = (subjects: Subject[], from = new Date()) => (
  subjects
    .filter(subject => !isSequenceChild(subject))
    .map(subject => getSequenceDisplaySubject(subject, subjects, from))
);

export const resolveActiveStudySubject = (subject: Subject, subjects: Subject[], from = new Date()) => {
  const root = getSequenceRootSubject(subject, subjects);
  return getActiveSequenceSubject(root, subjects, from);
};
