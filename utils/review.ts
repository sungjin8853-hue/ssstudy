export const BASIC_REVIEW_DETAIL_PREFIX = 'basic-review:';
export const IS_FAST_REVIEW_TEST_MODE = false;
export const INITIAL_REVIEW_DELAY_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const getNextReviewIntervalMs = (reviewStep: number) => {
  if (reviewStep <= 0) return DAY_MS;
  return DAY_MS * Math.pow(2, reviewStep);
};

export const getReviewDetailKey = (
  reviewType: 'basic' | 'subject',
  parentSubjectId: string,
  subjectId: string
) => reviewType === 'subject'
  ? subjectId
  : `${BASIC_REVIEW_DETAIL_PREFIX}${parentSubjectId}`;
