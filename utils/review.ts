export const BASIC_REVIEW_DETAIL_PREFIX = 'basic-review:';
export const IS_FAST_REVIEW_TEST_MODE = false;
export const INITIAL_REVIEW_DELAY_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const getNextReviewIntervalMs = (reviewStep: number) => {
  if (reviewStep <= 0) return DAY_MS;
  if (reviewStep === 1) return 4 * DAY_MS;
  if (reviewStep === 2) return 7 * DAY_MS;
  if (reviewStep === 3) return 14 * DAY_MS;
  if (reviewStep === 4) return 28 * DAY_MS;
  return 28 * DAY_MS * Math.pow(2, reviewStep - 4);
};

export const getReviewDetailKey = (
  reviewType: 'basic' | 'subject',
  parentSubjectId: string,
  subjectId: string
) => reviewType === 'subject'
  ? subjectId
  : `${BASIC_REVIEW_DETAIL_PREFIX}${parentSubjectId}`;
