export const BASIC_REVIEW_DETAIL_PREFIX = 'basic-review:';

export const getReviewDetailKey = (
  reviewType: 'basic' | 'subject',
  parentSubjectId: string,
  subjectId: string
) => reviewType === 'subject'
  ? subjectId
  : `${BASIC_REVIEW_DETAIL_PREFIX}${parentSubjectId}`;
