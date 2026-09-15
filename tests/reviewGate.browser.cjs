const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const url = process.argv[3] || 'http://127.0.0.1:4175/';
const second = 1000;
const hour = 60 * 60 * second;
const now = Date.parse('2026-09-13T04:00:00.000Z');

function fixture(linked, reviewStep = 0, dueOffsetMs = -1000) {
  const main = {
    id: 'gate-main', name: 'GateTest', startPage: 1, totalPages: 100, completedPages: 4,
    targetDate: '2026-10-31', createdAt: '2026-09-13T00:00:00.000Z', tagIds: [],
    reviewSubjectIds: linked ? ['gate-practice'] : [], scheduledWeekdays: [0, 1, 2, 3, 4, 5, 6]
  };
  const subjects = [main];
  if (linked) subjects.push({ ...main, id: 'gate-practice', name: 'PracticeTest', completedPages: 0, reviewSubjectIds: [] });
  const logs = [0, 1].map(index => ({
    id: `gate-note-${index}`, subjectId: main.id, subjectStageId: main.id,
    pagesRead: 2, startPage: index * 2 + 1, endPage: index * 2 + 2,
    timeSpentMinutes: 10, timestamp: '2026-09-13T00:00:00.000Z',
    nextReviewDate: new Date(now + dueOffsetMs).toISOString(), reviewStep, reviewEnabled: true,
    reviewSubjectIdsSnapshot: main.reviewSubjectIds,
    reviewMemo: index === 0 ? '[alpha] label: hidden answer, other: kept answer,' : '[beta] kind: second answer,'
  }));
  return { subjects, logs };
}

async function seed(browser, linked, reviewStep = 0, dueOffsetMs = -1000) {
  return seedData(browser, fixture(linked, reviewStep, dueOffsetMs));
}

async function seedData(browser, data) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(data => {
    if (sessionStorage.getItem('gate-fixture')) return;
    localStorage.setItem('swp_subjects', JSON.stringify(data.subjects));
    localStorage.setItem('swp_logs', JSON.stringify(data.logs));
    localStorage.setItem('swp_tags', '[]');
    if (data.reviewPolicyVersion === null) {
      localStorage.removeItem('swp_review_interval_policy');
    } else {
      localStorage.setItem('swp_review_interval_policy', 'power-of-two-v1');
    }
    sessionStorage.setItem('gate-fixture', 'true');
  }, data);
  await page.goto(url);
  await page.getByRole('heading', { name: '학습 실행', exact: true }).waitFor();
  return { context, page, errors };
}

async function storedLogs(page) {
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('swp_logs') || '[]').length === 2);
  return page.evaluate(() => JSON.parse(localStorage.getItem('swp_logs')));
}
async function openCard(page, label) {
  const card = page.getByRole('button').filter({ hasText: label }).filter({ hasText: 'GateTest' }).first();
  await card.click();
  await card.click();
  await page.getByRole('button', { name: '정답 확인', exact: true }).waitFor();
}
async function answer(page, correct) {
  await page.getByRole('button', { name: '정답 확인', exact: true }).click();
  await page.getByRole('button', { name: correct ? '맞음' : '오답', exact: true }).click();
}

module.exports = { fixture, seedData, openCard, answer, now, hour, second };

if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let activePage;
  try {
    // Isolated storage: no access to the user's preview profile or study data.
    const scheduled = await seed(browser, false, 0, 15 * second);
    activePage = scheduled.page;
    assert.equal(await scheduled.page.getByRole('button').filter({ hasText: '기본 복습' }).count(), 0);
    await scheduled.page.clock.fastForward(16 * second);
    await scheduled.page.getByRole('button').filter({ hasText: '기본 복습' }).first().waitFor();
    assert.equal(await scheduled.page.getByRole('button').filter({ hasText: '기본 복습' }).count() > 0, true);
    await scheduled.context.close();
    console.log('PASS: a scheduled regular review appears without changing weekdays');

    const migrationData = fixture(false, 2, 4 * 24 * hour);
    migrationData.reviewPolicyVersion = null;
    const migration = await seedData(browser, migrationData);
    activePage = migration.page;
    const migratedLogs = await storedLogs(migration.page);
    assert.equal(
      Date.parse(migratedLogs[0].nextReviewDate),
      now + 2 * 24 * hour
    );
    assert.equal(
      await migration.page.evaluate(() => localStorage.getItem('swp_review_interval_policy')),
      'power-of-two-v1'
    );
    await migration.context.close();
    console.log('PASS: existing schedules migrate once from the legacy intervals to powers of two');

    const measurement = await seedData(browser, {
      subjects: [{
        id: 'study-run', name: 'StudyRun', startPage: 1, totalPages: 100, completedPages: 0,
        targetDate: '2026-10-31', createdAt: '2026-09-13T00:00:00.000Z', tagIds: [],
        reviewSubjectIds: [], scheduledWeekdays: [0, 1, 2, 3, 4, 5, 6], initialAverageTimePerPage: 1
      }],
      logs: []
    });
    activePage = measurement.page;
    const studyButton = measurement.page.getByRole('button').filter({ hasText: 'StudyRun' }).filter({ hasText: '권장' }).first();
    await studyButton.click();
    await studyButton.click();
    await measurement.page.getByRole('button', { name: '완료', exact: true }).waitFor();
    await measurement.page.clock.fastForward(5 * second);
    await measurement.page.getByRole('button', { name: '완료', exact: true }).click();
    await measurement.page.getByRole('heading', { name: '학습량 입력', exact: true }).waitFor();
    await measurement.page.getByRole('button', { name: '← 측정으로 돌아가기', exact: true }).click();
    await measurement.page.clock.fastForward(2 * second);
    await measurement.page.getByRole('button', { name: '완료', exact: true }).click();
    await measurement.page.getByRole('heading', { name: '학습량 입력', exact: true }).waitFor();
    assert.match(await measurement.page.locator('body').innerText(), /현재 시간\s+00:0[7-9]/);
    assert.deepEqual(measurement.errors, []);
    await measurement.context.close();
    console.log('PASS: returning from page entry resumes the same measurement time');

    await require('./reviewFlow.audit.cjs').runAudit(browser);

    const nestedData = fixture(true);
    nestedData.subjects.push({
      ...nestedData.subjects[1], id: 'nested-child', name: 'Nested child', reviewSubjectIds: []
    });
    nestedData.subjects[1].reviewSubjectIds = ['nested-child'];
    nestedData.subjects[1].followUpSubjects = [{
      id: 'practice-next', name: 'Next practice', startPage: 1, endPage: 10,
      completedPage: 0, reviewSubjectIds: ['nested-child']
    }];
    const nested = await seedData(browser, nestedData);
    activePage = nested.page;
    await nested.page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('swp_subjects') || '[]');
      return saved.find(subject => subject.id === 'gate-practice')?.reviewSubjectIds.length === 0;
    });
    const savedSubjects = await nested.page.evaluate(() => JSON.parse(localStorage.getItem('swp_subjects')));
    assert.deepEqual(savedSubjects.find(subject => subject.id === 'gate-main').reviewSubjectIds, ['gate-practice']);
    assert.deepEqual(savedSubjects.find(subject => subject.id === 'gate-practice').followUpSubjects[0].reviewSubjectIds, []);
    assert.equal(savedSubjects.length, 3);
    assert.deepEqual((await storedLogs(nested.page)).map(log => log.id), nestedData.logs.map(log => log.id));
    await nested.page.reload();
    await nested.page.getByRole('heading', { name: '학습 실행', exact: true }).waitFor();
    const reloadedSubjects = await nested.page.evaluate(() => JSON.parse(localStorage.getItem('swp_subjects')));
    assert.deepEqual(reloadedSubjects, savedSubjects);
    assert.deepEqual(nested.errors, []);
    console.log('PASS: nested review links are removed without deleting subjects; reload preserves the cleanup');
    await nested.context.close();
  } catch (error) {
    if (activePage && !activePage.isClosed()) console.error(await activePage.locator('body').innerText());
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
