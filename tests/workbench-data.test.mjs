import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_DEVICE_LOCAL_ACCESS,
  MOBILE_READ_ONLY_ACCESS,
  WORKBENCH_BACKUP_KEY,
  WORKBENCH_RECOVERY_KEY,
  WORKBENCH_STORAGE_KEY,
  applyWorkbenchUpdate,
  checkWorkbenchWriteAccess,
  createMobileReadOnlySnapshot,
  createSeedWorkbenchData,
  deleteAssessmentRecord,
  getAssessmentChange,
  loadDeviceLocalWorkbench,
  listDeviceLocalRecoveryCopies,
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

test("stored fictional preview copy refreshes without changing teacher-written text", () => {
  const data = createSeedWorkbenchData();
  delete data.meta.demoCopyVersion;
  const student = data.students.find((candidate) => candidate.id === "S08403");
  assert.ok(student?.recentIssue);
  student.recentIssue.title = "文本依据仍不充分";
  student.recentIssue.detail = "解释动作描写的情感作用时，答案缺少对应原句。";
  student.recentIssue.nextAction = "课堂比较任务中再次核对是否能先标原句再作答。";
  student.homeSchool.communicationNote = "老师自己补写的沟通记录";
  data.tasks.find((task) => task.id === "T004").title = "核对赵清禾补学清单剩余阅读题";
  const teacherStudent = structuredClone(student);
  teacherStudent.id = "REAL-001";
  teacherStudent.name = "老师新增学生";
  teacherStudent.assessments = [];
  teacherStudent.recentIssue.id = "REAL-I001";
  teacherStudent.recentIssue.title = "写作第二稿尚未提交";
  data.students.push(teacherStudent);
  const teacherTask = structuredClone(data.tasks[0]);
  teacherTask.id = "REAL-T001";
  teacherTask.title = "核对赵清禾补学清单剩余阅读题";
  data.tasks.push(teacherTask);

  const refreshed = migrateWorkbenchData(data, "2026-10-01T10:00:00+08:00").data;
  const refreshedStudent = refreshed.students.find((candidate) => candidate.id === "S08403");
  assert.equal(refreshedStudent?.recentIssue?.title, "回答时没有引用原文");
  assert.equal(refreshedStudent?.recentIssue?.detail, "说到人物情感时，常直接写结论，没有先找出原文中的对应句子。");
  assert.equal(refreshedStudent?.recentIssue?.nextAction, "下次讲评时，让他先画出原句，再说这句话表现了什么情感。");
  assert.equal(refreshedStudent?.homeSchool.communicationNote, "老师自己补写的沟通记录");
  assert.equal(refreshed.tasks.find((task) => task.id === "T004")?.title, "查看赵清禾补写的阅读题");
  assert.equal(refreshed.students.find((candidate) => candidate.id === "REAL-001")?.recentIssue?.title, "写作第二稿尚未提交");
  assert.equal(refreshed.tasks.find((task) => task.id === "REAL-T001")?.title, "核对赵清禾补学清单剩余阅读题");

  const nonDemo = createSeedWorkbenchData();
  nonDemo.meta.containsDemoData = false;
  nonDemo.students[0].recentIssue.title = "文本依据仍不充分";
  const untouched = migrateWorkbenchData(nonDemo, "2026-10-01T10:00:00+08:00").data;
  assert.equal(untouched.students[0].recentIssue?.title, "文本依据仍不充分");
});

test("the one-time demo refresh never rewrites subsequent teacher edits or reused identities", () => {
  const now = "2026-10-01T10:00:00+08:00";
  const legacy = createSeedWorkbenchData();
  delete legacy.meta.demoCopyVersion;
  legacy.students[0].recentIssue.title = "文本依据仍不充分";
  legacy.students[1].name = "老师自己添加的学生";
  legacy.students[1].recentIssue.title = "补学清单还差1项确认";
  legacy.students[2].recentIssue.id = "TEACHER-ISSUE";
  legacy.students[2].recentIssue.title = "订正依据尚未补全";
  legacy.students[3].id = "__proto__";

  const refreshed = migrateWorkbenchData(legacy, now).data;
  assert.equal(refreshed.meta.demoCopyVersion, 1);
  assert.equal(refreshed.students[0].recentIssue.title, "回答时没有引用原文");
  assert.equal(refreshed.students[1].recentIssue.title, "补学清单还差1项确认");
  assert.equal(refreshed.students[2].recentIssue.title, "订正依据尚未补全");
  const changed = applyWorkbenchUpdate(refreshed, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    draft.students[0].recentIssue.title = "文本依据仍不充分";
    draft.tasks.find((task) => task.id === "T004").title = "核对赵清禾补学清单剩余阅读题";
  }, now);
  assert.equal(changed.students[0].recentIssue.title, "文本依据仍不充分");

  const storage = new MemoryStorage();
  assert.equal(saveDeviceLocalWorkbench(changed, { access: DESKTOP_DEVICE_LOCAL_ACCESS, storage }).ok, true);
  const reloaded = loadDeviceLocalWorkbench({ storage, now });
  assert.equal(reloaded.data.students[0].recentIssue.title, "文本依据仍不充分");
  assert.equal(reloaded.data.tasks.find((task) => task.id === "T004").title, "核对赵清禾补学清单剩余阅读题");
});

test("ordinary saves preserve unreadable data until an explicit restore or reset", () => {
  const storage = new MemoryStorage();
  const original = "{broken teacher records";
  storage.setItem(WORKBENCH_STORAGE_KEY, original);
  const loaded = loadDeviceLocalWorkbench({ storage });
  assert.equal(loaded.source, "seed");
  assert.ok(loaded.warnings.length);

  const result = saveDeviceLocalWorkbench(loaded.data, { access: DESKTOP_DEVICE_LOCAL_ACCESS, storage });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-stored-data");
  assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), original);
  assert.equal(storage.getItem(WORKBENCH_BACKUP_KEY), null);

  const recovered = createSeedWorkbenchData();
  const restored = saveDeviceLocalWorkbench(recovered, {
    access: DESKTOP_DEVICE_LOCAL_ACCESS,
    storage,
    allowReplaceInvalidStoredData: true,
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(listDeviceLocalRecoveryCopies(storage), [{ savedAt: recovered.meta.updatedAt, payload: original }]);
  assert.equal(storage.getItem(WORKBENCH_BACKUP_KEY), null, "an unreadable original is not offered as a normal restorable backup");
  const savedValue = storage.getItem(WORKBENCH_STORAGE_KEY);
  const invalid = structuredClone(recovered);
  invalid.students[0].assessments[0].score = 999;
  const invalidSave = saveDeviceLocalWorkbench(invalid, { access: DESKTOP_DEVICE_LOCAL_ACCESS, storage });
  assert.equal(invalidSave.ok, false);
  assert.equal(invalidSave.reason, "invalid-data");
  assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), savedValue);

  for (let index = 0; index < 4; index += 1) {
    const next = applyWorkbenchUpdate(recovered, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
      draft.tasks[0].title = `后续保存 ${index}`;
    }, "2026-10-01T10:00:00+08:00");
    assert.equal(saveDeviceLocalWorkbench(next, { access: DESKTOP_DEVICE_LOCAL_ACCESS, storage }).ok, true);
  }
  assert.equal(listDeviceLocalRecoveryCopies(storage)[0].payload, original, "normal rolling saves must not discard the repair source");
});

test("restoring stops if the original content cannot be backed up exactly", () => {
  const original = "{original teacher records";
  const data = createSeedWorkbenchData();
  for (const failureMode of ["throws", "does-not-persist", "unreadable-archive"]) {
    class FailingRecoveryStorage extends MemoryStorage {
      setItem(key, value) {
        if (key === WORKBENCH_RECOVERY_KEY && failureMode === "throws") throw new Error("QuotaExceededError");
        if (key === WORKBENCH_RECOVERY_KEY && failureMode === "does-not-persist") return;
        super.setItem(key, value);
      }
    }
    const storage = new FailingRecoveryStorage();
    storage.setItem(WORKBENCH_STORAGE_KEY, original);
    if (failureMode === "unreadable-archive") storage.setItem(WORKBENCH_RECOVERY_KEY, "existing unreadable archive");
    const result = saveDeviceLocalWorkbench(data, {
      access: DESKTOP_DEVICE_LOCAL_ACCESS,
      storage,
      allowReplaceInvalidStoredData: true,
    });
    assert.equal(result.ok, false, failureMode);
    assert.equal(result.reason, "recovery-backup-failed", failureMode);
    assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), original, failureMode);
    assert.equal(storage.getItem(WORKBENCH_BACKUP_KEY), null, failureMode);
  }

  for (const failureMode of ["throws", "does-not-persist"]) {
    class FailingRollingStorage extends MemoryStorage {
      setItem(key, value) {
        if (key === WORKBENCH_BACKUP_KEY) {
          if (failureMode === "throws") throw new Error("QuotaExceededError");
          return;
        }
        super.setItem(key, value);
      }
    }
    const storage = new FailingRollingStorage();
    assert.equal(saveDeviceLocalWorkbench(data, { access: DESKTOP_DEVICE_LOCAL_ACCESS, storage }).ok, true);
    const storedBeforeRestore = storage.getItem(WORKBENCH_STORAGE_KEY);
    const replacement = structuredClone(data);
    replacement.tasks = [];
    const result = saveDeviceLocalWorkbench(replacement, {
      access: DESKTOP_DEVICE_LOCAL_ACCESS,
      storage,
      allowReplaceInvalidStoredData: true,
    });
    assert.equal(result.ok, false, `valid original: ${failureMode}`);
    assert.equal(result.reason, "recovery-backup-failed", failureMode);
    assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), storedBeforeRestore, failureMode);
  }
});

test("mobile snapshots use the teacher local day and compare real instants across offsets", () => {
  const data = createSeedWorkbenchData({ includeMobileSnapshot: false });
  const lesson = data.lessons[0];
  data.lessons = [
    { ...lesson, id: "LATE", startsAt: "2026-09-17T01:00:00Z", endsAt: "2026-09-17T02:00:00Z" },
    { ...lesson, id: "EARLY", startsAt: "2026-09-17T08:00:00+08:00", endsAt: "2026-09-17T08:45:00+08:00" },
    { ...lesson, id: "STARTED", startsAt: "2026-09-17T04:00:00+08:00", endsAt: "2026-09-17T06:00:00+08:00" },
  ];
  const task = data.tasks[0];
  data.tasks = [
    { ...task, id: "TASK-LATE", dueAt: "2026-09-17T01:00:00Z" },
    { ...task, id: "TASK-EARLY", dueAt: "2026-09-17T08:00:00+08:00" },
  ];
  const snapshot = createMobileReadOnlySnapshot(data, "2026-09-16T20:30:00Z");
  assert.equal(snapshot.summary.lessonsOnDate, 3);
  assert.deepEqual(snapshot.upcomingLessons.map((item) => item.id), ["EARLY", "LATE"]);
  assert.deepEqual(snapshot.openTasks.map((item) => item.id), ["TASK-EARLY", "TASK-LATE"]);
});

test("demo mobile snapshots keep their teaching reference time separate from the actual export time", () => {
  const data = createSeedWorkbenchData({ includeMobileSnapshot: false });
  const generatedAt = "2026-12-01T10:00:00Z";
  const snapshot = createMobileReadOnlySnapshot(data, generatedAt, {
    referenceNow: "2026-09-16T15:40:00+08:00",
  });
  assert.equal(snapshot.generatedAt, generatedAt);
  assert.match(snapshot.snapshotId, /20261201100000$/);
  assert.equal(snapshot.summary.lessonsOnDate, 3);
  assert.equal(snapshot.upcomingLessons[0].startsAt, "2026-09-16T15:50:00+08:00");
  assert.ok(snapshot.upcomingLessons.every((lesson) => lesson.status === "待上课"));
  assert.equal(createMobileReadOnlySnapshot(data, generatedAt).upcomingLessons.length, 0);
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

  const differentCohort = structuredClone(student);
  differentCohort.assessments[2].cohortSize = 100;
  assert.equal(getAssessmentChange(differentCohort).rankDelta, null, "class and grade rankings cannot be compared as one cohort");

  const decimalScores = structuredClone(student);
  decimalScores.assessments[0].score = 79.1;
  decimalScores.assessments[2].score = 80.2;
  assert.equal(getAssessmentChange(decimalScores).scoreDelta, 1.1);
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

  const legacyWithUnreadableRecords = [
    { students: { REAL: { name: "学生", className: "一班" } } },
    { students: [{ id: "REAL", name: "学生", className: "一班", assessments: {} }] },
    { students: [{ id: "REAL", name: "学生", className: "一班", assessments: [{ title: "测评", score: 999, maxScore: 100 }] }] },
    { students: [{ id: "REAL", name: "学生" }] },
    { tasks: [{ id: "REAL-TASK" }] },
    { lessons: [{ id: "REAL-LESSON", title: "旧课程" }] },
    { resources: [{ id: "REAL-RESOURCE", title: "旧教案" }] },
  ];
  for (const records of legacyWithUnreadableRecords) {
    assert.throws(
      () => migrateWorkbenchData({ schemaVersion: 0, ...records }, now),
      /INVALID_LEGACY_DATA/,
      "a successful restore must never silently discard unreadable source records",
    );
  }
});
