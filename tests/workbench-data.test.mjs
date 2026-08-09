import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_DEVICE_LOCAL_ACCESS,
  MOBILE_READ_ONLY_ACCESS,
  WORKBENCH_STORAGE_KEY,
  applyWorkbenchUpdate,
  checkWorkbenchWriteAccess,
  createMobileReadOnlySnapshot,
  createSeedWorkbenchData,
  deleteAssessmentRecord,
  getAssessmentChange,
  loadDeviceLocalWorkbench,
  migrateWorkbenchData,
  reviewAssessmentRecord,
  saveDeviceLocalWorkbench,
  summarizeWorkbench,
} from "../app/workbench-data.ts";

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.get(key) ?? null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }
}

function latestConfirmedAssessments(students) {
  return students.flatMap((student) => {
    const confirmed = student.assessments
      .filter((assessment) => assessment.status === "已核对")
      .toSorted((left, right) =>
        left.occurredOn === right.occurredOn
          ? left.id.localeCompare(right.id)
          : left.occurredOn.localeCompare(right.occurredOn),
      );
    return confirmed.length === 0 ? [] : [confirmed.at(-1)];
  });
}

test("default workbench summary is calculated from the seed records", () => {
  const data = createSeedWorkbenchData();
  const summary = summarizeWorkbench(data, "2026-09-16");
  const latestAssessments = latestConfirmedAssessments(data.students);

  assert.equal(summary.totalStudents, data.students.length);
  assert.equal(summary.totalStudents, 8, "the dashboard must not reuse the old hard-coded 129");
  assert.equal(summary.studentsWithConfirmedAssessments, latestAssessments.length);
  assert.equal(
    summary.issuesPending,
    data.students.filter((student) => student.recentIssue?.status === "待处理").length,
  );
  assert.equal(
    summary.issuesWatching,
    data.students.filter((student) => student.recentIssue?.status === "观察中").length,
  );
  assert.equal(
    summary.homeSchoolFollowUps,
    data.students.filter(
      (student) =>
        student.homeSchool.communicationDifficulty >= 4 ||
        student.homeSchool.supportWillingness <= 2,
    ).length,
  );
  assert.equal(
    summary.openTasks,
    data.tasks.filter((task) => task.status !== "已完成").length,
  );
  assert.equal(
    summary.openTaskMinutes,
    data.tasks
      .filter((task) => task.status !== "已完成")
      .reduce((total, task) => total + task.estimatedMinutes, 0),
  );
  assert.equal(
    summary.lessonsOnDate,
    data.lessons.filter(
      (lesson) => lesson.startsAt.startsWith("2026-09-16") && lesson.status !== "已取消",
    ).length,
  );

  const expectedAverage =
    Math.round(
      (latestAssessments.reduce(
        (total, assessment) => total + (assessment.score / assessment.maxScore) * 100,
        0,
      ) /
        latestAssessments.length) *
        10,
    ) / 10;
  assert.equal(summary.averageLatestScoreRate, expectedAverage);
});

test("task, assessment, and home-school changes survive a device-local save and reload", () => {
  const storage = new MemoryStorage();
  const original = createSeedWorkbenchData();
  const updatedAt = "2026-09-18T09:30:00+08:00";

  const updated = applyWorkbenchUpdate(
    original,
    DESKTOP_DEVICE_LOCAL_ACCESS,
    (draft) => {
      const task = draft.tasks.find((candidate) => candidate.id === "T001");
      assert.ok(task);
      task.status = "已完成";
      task.completedAt = updatedAt;

      const student = draft.students.find((candidate) => candidate.id === "S08403");
      assert.ok(student);
      student.assessments.push({
        id: "S08403-A5",
        title: "单元三",
        subject: "语文",
        occurredOn: "2026-09-18",
        maxScore: 100,
        score: 91,
        rank: 4,
        cohortSize: 43,
        classAverage: 80,
        status: "已核对",
        verifiedAt: updatedAt,
      });
      student.homeSchool.communicationDifficulty = 4;
      student.homeSchool.supportWillingness = 2;
      student.homeSchool.communicationNote = "需要预约后再沟通";
      student.homeSchool.supportNote = "目前只能偶尔协助";
      student.homeSchool.updatedAt = updatedAt;
    },
    updatedAt,
  );

  assert.equal(original.tasks.find((task) => task.id === "T001")?.status, "进行中");
  assert.equal(original.students.find((student) => student.id === "S08403")?.assessments.length, 8);
  assert.equal(updated.meta.revision, original.meta.revision + 1);

  const saveResult = saveDeviceLocalWorkbench(updated, {
    access: DESKTOP_DEVICE_LOCAL_ACCESS,
    storage,
    savedAt: updatedAt,
  });
  assert.deepEqual(saveResult, {
    ok: true,
    storageKey: WORKBENCH_STORAGE_KEY,
    savedAt: updatedAt,
  });

  const reloaded = loadDeviceLocalWorkbench({ storage, now: updatedAt });
  assert.equal(reloaded.source, "stored");
  assert.equal(reloaded.data.meta.revision, original.meta.revision + 1);
  assert.equal(reloaded.data.tasks.find((task) => task.id === "T001")?.status, "已完成");

  const student = reloaded.data.students.find((candidate) => candidate.id === "S08403");
  assert.ok(student);
  assert.equal(student.assessments.at(-1)?.score, 91);
  assert.equal(student.assessments.at(-1)?.rank, 4);
  assert.equal(student.homeSchool.communicationDifficulty, 4);
  assert.equal(student.homeSchool.supportWillingness, 2);
  assert.equal(student.homeSchool.communicationNote, "需要预约后再沟通");
  assert.equal(student.homeSchool.supportNote, "目前只能偶尔协助");
});

test("mobile and snapshot access reject mutations before an updater or storage write runs", () => {
  const data = createSeedWorkbenchData();
  const storage = new MemoryStorage();
  let updaterRan = false;

  assert.deepEqual(checkWorkbenchWriteAccess(MOBILE_READ_ONLY_ACCESS), {
    allowed: false,
    code: "SNAPSHOT_READ_ONLY",
    message: "手机看板仅供查看，请在电脑工作台更新。",
  });

  assert.throws(
    () =>
      applyWorkbenchUpdate(
        data,
        MOBILE_READ_ONLY_ACCESS,
        () => {
          updaterRan = true;
        },
        "2026-09-18T10:00:00+08:00",
      ),
    /SNAPSHOT_READ_ONLY/,
  );
  assert.equal(updaterRan, false);

  const saveResult = saveDeviceLocalWorkbench(data, {
    access: MOBILE_READ_ONLY_ACCESS,
    storage,
    savedAt: "2026-09-18T10:00:00+08:00",
  });
  assert.equal(saveResult.ok, false);
  assert.equal(saveResult.reason, "read-only");
  assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), null);
});

test("a published mobile snapshot stays isolated from later workspace changes", () => {
  const data = createSeedWorkbenchData({ includeMobileSnapshot: false });
  const publishedAt = "2026-09-16T15:40:00+08:00";
  const snapshot = createMobileReadOnlySnapshot(data, publishedAt, {
    localDate: "2026-09-16",
    priorityLimit: data.students.length,
    lessonLimit: data.lessons.length,
    taskLimit: data.tasks.length,
  });
  data.mobileSnapshot = snapshot;
  const publishedCopy = structuredClone(snapshot);
  const visibleTaskId = snapshot.openTasks[0].id;
  const visibleStudentId = snapshot.priorityStudents[0].id;

  const changed = applyWorkbenchUpdate(
    data,
    DESKTOP_DEVICE_LOCAL_ACCESS,
    (draft) => {
      const task = draft.tasks.find((candidate) => candidate.id === visibleTaskId);
      assert.ok(task);
      task.title = "电脑端后续修改的事项";

      const student = draft.students.find((candidate) => candidate.id === visibleStudentId);
      assert.ok(student);
      const latest = student.assessments.at(-1);
      assert.ok(latest);
      latest.score = latest.score - 7;
    },
    "2026-09-16T16:10:00+08:00",
  );

  assert.deepEqual(snapshot, publishedCopy);
  assert.deepEqual(changed.mobileSnapshot, publishedCopy);
  assert.equal(changed.mobileSnapshot?.readOnly, true);
  assert.equal(changed.mobileSnapshot?.sourceRevision, data.meta.revision);
  assert.notEqual(
    changed.tasks.find((task) => task.id === visibleTaskId)?.title,
    changed.mobileSnapshot?.openTasks.find((task) => task.id === visibleTaskId)?.title,
  );

  const refreshedSnapshot = createMobileReadOnlySnapshot(
    changed,
    "2026-09-16T16:11:00+08:00",
    { priorityLimit: changed.students.length, taskLimit: changed.tasks.length },
  );
  assert.equal(refreshedSnapshot.sourceRevision, changed.meta.revision);
  assert.equal(
    refreshedSnapshot.openTasks.find((task) => task.id === visibleTaskId)?.title,
    "电脑端后续修改的事项",
  );
});

test("seed schedule contains distinct, complete lesson records instead of one repeated detail", () => {
  const lessons = createSeedWorkbenchData().lessons;

  assert.ok(lessons.length >= 3);
  assert.equal(new Set(lessons.map((lesson) => lesson.id)).size, lessons.length);
  for (const lesson of lessons) {
    assert.ok(lesson.title);
    assert.ok(lesson.subject);
    assert.ok(lesson.className);
    assert.match(lesson.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.match(lesson.endsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.ok(lesson.room);
    assert.ok(lesson.preparation);
  }

  assert.ok(new Set(lessons.map((lesson) => lesson.title)).size > 1);
  assert.ok(new Set(lessons.map((lesson) => lesson.className)).size > 1);
  assert.ok(new Set(lessons.map((lesson) => lesson.startsAt)).size > 1);
  assert.ok(new Set(lessons.map((lesson) => lesson.room)).size > 1);
  assert.ok(lessons.some((lesson) => lesson.subject === "班会"));
  assert.notDeepEqual(lessons[0], lessons[1]);
});

test("assessment changes compare only the latest subject and ignore pending records", () => {
  const student = {
    assessments: [
      { id: "CN-1", title: "语文一", subject: "语文", occurredOn: "2026-09-01", maxScore: 100, score: 70, rank: 20, cohortSize: 40, classAverage: 75, status: "已核对", source: "手工录入" },
      { id: "EN-1", title: "英语一", subject: "英语", occurredOn: "2026-09-02", maxScore: 100, score: 90, rank: 3, cohortSize: 40, classAverage: 76, status: "已核对", source: "手工录入" },
      { id: "CN-2", title: "语文二", subject: "语文", occurredOn: "2026-09-03", maxScore: 100, score: 80, rank: 10, cohortSize: 40, classAverage: 76, status: "已核对", source: "手工录入" },
      { id: "CN-3", title: "语文待核对", subject: "语文", occurredOn: "2026-09-04", maxScore: 100, score: 99, rank: 1, cohortSize: 40, classAverage: 77, status: "待核对", source: "表格导入" },
    ],
  };
  const change = getAssessmentChange(student);
  assert.equal(change.subject, "语文");
  assert.equal(change.latest.id, "CN-2");
  assert.equal(change.previous.id, "CN-1");
  assert.equal(change.scoreDelta, 10);
  assert.equal(change.rankDelta, 10);
  const english = getAssessmentChange(student, { subject: "英语" });
  assert.equal(english.latest.id, "EN-1");
  assert.equal(english.previous, null);

  const differentMax = structuredClone(student);
  differentMax.assessments[2].maxScore = 120;
  differentMax.assessments[2].score = 96;
  assert.equal(getAssessmentChange(differentMax).scoreDelta, null, "raw score deltas must not compare different full scores");
  assert.equal(getAssessmentChange(differentMax).scoreRateDelta, 10);
});

test("assessment review commands confirm, keep pending, validate and delete exactly one record", () => {
  const data = createSeedWorkbenchData();
  const student = data.students[0];
  student.assessments.push({ id: "PENDING-1", title: "待核对", subject: "语文", occurredOn: "2026-10-01", maxScore: 100, score: 88, rank: 5, cohortSize: 43, classAverage: 80, status: "待核对", source: "表格导入" });
  const fields = { title: "单元三", subject: "语文", occurredOn: "2026-10-01", maxScore: 100, score: 88, rank: 5, cohortSize: 43, classAverage: 80 };
  const confirmed = reviewAssessmentRecord(data, { studentId: student.id, assessmentId: "PENDING-1", fields, decision: "confirm", reviewedAt: "2026-10-01T20:00:00+08:00" });
  assert.equal(confirmed.ok, true);
  assert.equal(student.assessments.at(-1).status, "已核对");
  assert.equal(student.assessments.at(-1).verifiedAt, "2026-10-01T20:00:00+08:00");

  const invalid = reviewAssessmentRecord(data, { studentId: student.id, assessmentId: "PENDING-1", fields: { ...fields, score: 120 }, decision: "confirm", reviewedAt: "2026-10-01T20:00:00+08:00" });
  assert.equal(invalid.ok, false);
  assert.equal(student.assessments.at(-1).score, 88, "invalid edits must not mutate the record");

  const pending = reviewAssessmentRecord(data, { studentId: student.id, assessmentId: "PENDING-1", fields: { ...fields, score: 89 }, decision: "keep-pending", reviewedAt: "2026-10-01T20:00:00+08:00" });
  assert.equal(pending.ok, true);
  assert.equal(student.assessments.at(-1).status, "待核对");
  assert.equal(student.assessments.at(-1).verifiedAt, undefined);
  const before = student.assessments.length;
  assert.equal(deleteAssessmentRecord(data, student.id, "PENDING-1").ok, true);
  assert.equal(student.assessments.length, before - 1);
  assert.ok(!student.assessments.some((assessment) => assessment.id === "PENDING-1"));
});

test("strict migration rejects unrelated objects and preserves real legacy students", () => {
  assert.throws(() => migrateWorkbenchData({}, "2026-10-01T10:00:00+08:00"), /不是可识别/);
  assert.throws(() => migrateWorkbenchData({ schemaVersion: 99 }, "2026-10-01T10:00:00+08:00"), /UNSUPPORTED/);
  const malformedCurrent = createSeedWorkbenchData();
  malformedCurrent.lessonTemplates = [{ id: "BROKEN-TEMPLATE" }];
  assert.throws(
    () => migrateWorkbenchData(malformedCurrent, "2026-10-01T10:00:00+08:00"),
    /结构.*不完整|无法读取/,
    "current files with malformed nested schedule data must fail closed",
  );
  const migrated = migrateWorkbenchData({
    schemaVersion: 0,
    user: { workbenchName: "王老师工作台", teacherName: "王老师" },
    students: [{ id: "REAL-001", name: "真实学生", className: "八年级1班", subject: "数学", score: 88, previousScore: 80, rank: 4, previousRank: 8, classSize: 42, maxScore: 100 }],
    tasks: [{ id: "REAL-T1", title: "核对作业", category: "教学", dueAt: "2026-10-02T18:00:00+08:00", estimatedMinutes: 20, status: "待开始" }],
  }, "2026-10-01T10:00:00+08:00");
  assert.equal(migrated.source, "migrated");
  assert.equal(migrated.data.students.length, 1);
  assert.equal(migrated.data.students[0].id, "REAL-001");
  assert.equal(migrated.data.students[0].assessments.length, 2);
  assert.equal(migrated.data.students[0].homeSchool.communicationDifficulty, 0);
  assert.equal(migrated.data.tasks[0].id, "REAL-T1");
  assert.equal(migrated.data.meta.containsDemoData, false);
});

test("strict restore rejects invalid time zones, duplicate identities and invalid legacy output", () => {
  const now = "2026-10-01T10:00:00+08:00";

  const invalidTimeZone = createSeedWorkbenchData();
  invalidTimeZone.user.timeZone = "Definitely/Not-A-Time-Zone";
  assert.throws(
    () => migrateWorkbenchData(invalidTimeZone, now),
    /结构或字段不完整/,
    "a restored workspace must not persist a time zone that crashes Intl",
  );

  const duplicateStudentIds = createSeedWorkbenchData();
  duplicateStudentIds.students[1].id = duplicateStudentIds.students[0].id;
  assert.throws(
    () => migrateWorkbenchData(duplicateStudentIds, now),
    /结构或字段不完整/,
    "student commands and React keys require unique student ids",
  );

  const duplicateAssessmentIds = createSeedWorkbenchData();
  duplicateAssessmentIds.students[0].assessments[1].id = duplicateAssessmentIds.students[0].assessments[0].id;
  assert.throws(
    () => migrateWorkbenchData(duplicateAssessmentIds, now),
    /结构或字段不完整/,
    "assessment edit/delete must identify exactly one record",
  );

  const invalidLegacy = {
    schemaVersion: 0,
    user: { workbenchName: "旧数据", teacherName: "王老师" },
    students: [{
      id: "REAL-1",
      name: "真实学生",
      className: "八年级1班",
      assessments: [{
        id: "REAL-A1",
        title: "旧测评",
        subject: "数学",
        occurredOn: "2026-09-01",
        maxScore: 100,
        score: 80,
        rank: 5,
        cohortSize: 40,
        classAverage: 999,
        status: "已核对",
      }],
    }],
  };
  assert.throws(
    () => migrateWorkbenchData(invalidLegacy, now),
    /INVALID_LEGACY_DATA/,
    "migration must validate its output before restore preview",
  );
});
