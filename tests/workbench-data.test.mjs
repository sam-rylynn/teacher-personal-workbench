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
  loadDeviceLocalWorkbench,
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
