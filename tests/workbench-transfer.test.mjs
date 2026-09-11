import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_DEVICE_LOCAL_ACCESS,
  WORKBENCH_BACKUP_KEY,
  applyWorkbenchUpdate,
  createEmptyWorkbenchData,
  createMobileReadOnlySnapshot,
  createSeedWorkbenchData,
  expandLessonsForRange,
  getDeviceLocalDate,
  listDeviceLocalBackups,
  rankPriorityStudents,
  saveDeviceLocalWorkbench,
  summarizeWorkbench,
} from "../app/workbench-data.ts";
import {
  applyAssessmentImportPlan,
  applyLessonImportPlan,
  buildIcsCalendar,
  computeDueReminders,
  foldIcsLineUtf8,
  inboxToTasks,
  loadImportedMobileView,
  parseDelimitedText,
  parseInbox,
  parseMobileViewFile,
  parseWorkbenchImportText,
  planAssessmentImport,
  planLessonImport,
  serializeInbox,
  serializeMobileViewFile,
  serializeWorkbenchExport,
  saveImportedMobileView,
} from "../app/workbench-transfer.ts";

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

test("parseDelimitedText handles commas, tabs, quotes and CRLF", () => {
  assert.deepEqual(parseDelimitedText("a,b\r\nc,d\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseDelimitedText("姓名\t班级\n小明\t八1班"), [["姓名", "班级"], ["小明", "八1班"]]);
  assert.deepEqual(parseDelimitedText('"含,逗号",b'), [["含,逗号", "b"]]);
  assert.deepEqual(parseDelimitedText('"两行\n内容",b'), [["两行\n内容", "b"]]);
  assert.deepEqual(parseDelimitedText(""), []);
  assert.deepEqual(parseDelimitedText("\n\n"), []);
  assert.deepEqual(parseDelimitedText("\n\na,b\nc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseDelimitedText("标题\t备注\n课堂\t准备,打印;装订"), [["标题", "备注"], ["课堂", "准备,打印;装订"]]);
  assert.deepEqual(parseDelimitedText("a,b\nc;d,e"), [["a", "b"], ["c;d", "e"]]);
  assert.throws(() => parseDelimitedText('a,b\n"缺少结束引号,c'), /引号/);
});

test("assessment import rejects ambiguous headers and bad numbers without shifting columns", () => {
  const missing = planAssessmentImport("姓名,班级,测评,日期,成绩,参考人数\n小明,一班,单元测,2026-10-12,80,40", []);
  assert.equal(missing.entries.length, 0);
  assert.match(missing.issues[0].message, /排名/);
  const duplicate = planAssessmentImport("姓名,班级,测评,日期,满分,成绩,得分,排名,参考人数\n小明,一班,单元测,2026-10-12,100,80,90,2,40", []);
  assert.equal(duplicate.entries.length, 0);
  assert.match(duplicate.issues[0].message, /出现多次/);
  for (const [maxScore, average] of [["abc", "80"], ["100", "abc"], ["0x64", "80"]]) {
    const plan = planAssessmentImport(`小明,一班,单元测,2026-10-12,${maxScore},80,2,40,${average}`, []);
    assert.equal(plan.entries.length, 0);
    assert.equal(plan.issues.length, 1);
  }
  const optionalAbsent = planAssessmentImport("参考人数,排名,成绩,日期,测评,班级,姓名\n40,2,80,2026-10-12,单元测,一班,小明", []);
  assert.equal(optionalAbsent.issues.length, 0);
  assert.equal(optionalAbsent.entries[0].record.maxScore, 100);
});

test("assessment import preserves subjects and remains idempotent when a plan is reused", () => {
  const now = "2026-10-12T20:00:00+08:00";
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, now);
  const plan = planAssessmentImport("姓名,班级,测评,学科,日期,满分,成绩,排名,参考人数\n小明,一班,期中,语文,2026-10-12,100,80,2,40\n小明,一班,期中,数学,2026-10-12,100,82,3,40", []);
  assert.equal(plan.entries.length, 2);
  assert.equal(plan.issues.length, 0);
  assert.deepEqual(applyAssessmentImportPlan(data, plan, now), { addedStudents: 1, addedAssessments: 2 });
  assert.deepEqual(applyAssessmentImportPlan(data, plan, now), { addedStudents: 0, addedAssessments: 0 });
  assert.equal(data.students[0].assessments.length, 2);
});

test("planAssessmentImport validates ranges, dates and duplicates", () => {
  const data = createSeedWorkbenchData();
  const valid = planAssessmentImport(
    "姓名,班级,测评,日期,满分,成绩,排名,参考人数,班级均分\n王小明,八年级1班,单元三,2026-10-12,100,87,6,45,79.5",
    data.students,
  );
  assert.equal(valid.issues.length, 0);
  assert.equal(valid.entries.length, 1);
  assert.equal(valid.entries[0].isNewStudent, true);
  assert.equal(valid.entries[0].record.status, "待核对");
  assert.equal(valid.newStudentCount, 1);

  const currentUiHeaders = planAssessmentImport(
    "班级平均分,学生姓名,班级,测评名称,日期,满分,成绩,班级排名,班级人数\n79.5,王小明,八年级1班,单元三,2026-10-12,100,87,6,45",
    data.students,
  );
  assert.equal(currentUiHeaders.issues.length, 0);
  assert.equal(currentUiHeaders.entries[0].record.classAverage, 79.5);
  assert.equal(currentUiHeaders.entries[0].record.cohortSize, 45);

  const outOfRange = planAssessmentImport("王小明,八1班,单元三,2026-10-12,100,187,6,45,79", []);
  assert.equal(outOfRange.entries.length, 0);
  assert.match(outOfRange.issues[0].message, /超出/);

  const badRank = planAssessmentImport("王小明,八1班,单元三,2026-10-12,100,87,60,45,79", []);
  assert.equal(badRank.entries.length, 0);
  assert.match(badRank.issues[0].message, /参考人数/);

  const badDate = planAssessmentImport("王小明,八1班,单元三,2026-13-40,100,87,6,45,79", []);
  assert.equal(badDate.entries.length, 0);

  const dupInFile = planAssessmentImport(
    "王小明,八1班,单元三,2026-10-12,100,87,6,45,79\n王小明,八1班,单元三,2026-10-12,100,88,5,45,79",
    [],
  );
  assert.equal(dupInFile.entries.length, 1);
  assert.equal(dupInFile.issues.length, 1);

  const dupExisting = planAssessmentImport("李明澈,八年级4班,阶段测,2026-09-15,100,90,1,43,85", data.students);
  assert.equal(dupExisting.entries.length, 0);
  assert.match(dupExisting.issues[0].message, /已有名称和日期都相同/);
});

test("applyAssessmentImportPlan creates students and marks records unverified", () => {
  const data = createSeedWorkbenchData();
  const plan = planAssessmentImport(
    "姓名,班级,测评,日期,满分,成绩,排名,参考人数,班级均分\n王小明,八年级1班,单元三,2026-10-12,100,87,6,45,79.5\n李小红,八年级1班,单元三,2026-10-12,100,91,3,45,79.5\n李明澈,八年级4班,单元三,2026-10-12,100,90,2,43,82",
    data.students,
  );
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.newStudentCount, 2);

  const now = "2026-10-12T20:00:00+08:00";
  const updated = applyWorkbenchUpdate(
    data,
    DESKTOP_DEVICE_LOCAL_ACCESS,
    (draft) => {
      const result = applyAssessmentImportPlan(draft, plan, now);
      assert.equal(result.addedStudents, 2);
      assert.equal(result.addedAssessments, 3);
    },
    now,
  );

  assert.equal(updated.students.length, data.students.length + 2);
  const imported = updated.students.find((student) => student.name === "王小明");
  assert.ok(imported);
  assert.equal(imported.assessments.length, 1);
  assert.equal(imported.assessments[0].status, "待核对");
  assert.equal(imported.assessments[0].source, "表格导入");
  assert.equal(imported.recentIssue, null);
  const existing = updated.students.find((student) => student.name === "李明澈");
  assert.equal(existing.assessments.length, 9);
  // Source data is untouched.
  assert.equal(data.students.length, 8);
});

test("separate assessment imports in the same second reserve unique ids", () => {
  const now = "2026-10-12T20:00:00+08:00";
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, now);
  const header = "姓名,班级,测评,学科,日期,满分,成绩,排名,参考人数,班级均分\n";

  const first = planAssessmentImport(
    header + "张同学,八年级1班,第一次,数学,2026-10-10,100,80,5,40,75",
    data.students,
  );
  applyAssessmentImportPlan(data, first, now);
  const second = planAssessmentImport(
    header + "李同学,八年级2班,第一次,数学,2026-10-10,100,81,4,40,75",
    data.students,
  );
  applyAssessmentImportPlan(data, second, now);
  const third = planAssessmentImport(
    header + "张同学,八年级1班,第二次,数学,2026-10-11,100,82,3,40,75",
    data.students,
  );
  applyAssessmentImportPlan(data, third, now);

  assert.deepEqual([first.issues.length, second.issues.length, third.issues.length], [0, 0, 0]);
  assert.equal(new Set(data.students.map((student) => student.id)).size, data.students.length);
  const allAssessmentIds = data.students.flatMap((student) => student.assessments.map((assessment) => assessment.id));
  assert.equal(new Set(allAssessmentIds).size, allAssessmentIds.length);
});

test("planLessonImport validates times and conflicts", () => {
  const data = createSeedWorkbenchData();
  const valid = planLessonImport(
    "标题,学科,班级,日期,开始,结束,地点,备课,提醒分钟\n说明文阅读,语文,八年级1班,2026-10-13,08:55,09:40,教学楼 401,阅读材料,10",
    data.lessons,
  );
  assert.equal(valid.issues.length, 0);
  assert.equal(valid.entries.length, 1);
  assert.equal(valid.entries[0].record.startsAt, "2026-10-13T08:55:00+08:00");
  assert.equal(valid.entries[0].record.reminderMinutesBefore, 10);

  const badTime = planLessonImport("说明文阅读,语文,八1班,2026-10-13,25:55,09:40,401,,", []);
  assert.equal(badTime.entries.length, 0);

  const reversed = planLessonImport("说明文阅读,语文,八1班,2026-10-13,09:55,09:40,401,,", []);
  assert.equal(reversed.entries.length, 0);
  assert.match(reversed.issues[0].message, /结束时间/);

  const conflict = planLessonImport("班会,班会,八年级4班,2026-09-16,15:50,16:35,教室,,", data.lessons);
  assert.equal(conflict.entries.length, 0);
  assert.match(conflict.issues[0].message, /已有课程/);

  const now = "2026-10-12T20:00:00+08:00";
  const updated = applyWorkbenchUpdate(
    data,
    DESKTOP_DEVICE_LOCAL_ACCESS,
    (draft) => {
      assert.equal(applyLessonImportPlan(draft, valid, now), 1);
    },
    now,
  );
  assert.equal(updated.lessons.length, data.lessons.length + 1);
});

test("separate lesson imports in the same second reserve unique ids", () => {
  const now = "2026-10-12T20:00:00+08:00";
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, now);
  const header = "标题,学科,班级,日期,开始,结束,地点,备课,提醒分钟\n";

  const first = planLessonImport(
    header + "第一节,语文,八年级1班,2026-10-13,08:00,08:45,101,讲义,10",
    data.lessons,
  );
  assert.equal(first.issues.length, 0);
  assert.equal(applyLessonImportPlan(data, first, now), 1);

  const second = planLessonImport(
    header + "第二节,数学,八年级2班,2026-10-14,09:00,09:45,202,习题,20",
    data.lessons,
  );
  assert.equal(second.issues.length, 0);
  assert.equal(applyLessonImportPlan(data, second, now), 1);

  assert.equal(data.lessons.length, 2);
  assert.equal(new Set(data.lessons.map((lesson) => lesson.id)).size, data.lessons.length);
});

test("lesson import normalizes hours and rejects overlapping lessons and malformed reminders", () => {
  const valid = planLessonImport("课程名称,学科,班级,日期,开始,结束,地点\n单元测,语文,一班,2026-10-13,9:00,10:00,101", []);
  assert.equal(valid.issues.length, 0);
  assert.equal(valid.entries[0].record.startsAt, "2026-10-13T09:00:00+08:00");
  for (const reminder of ["-10", "1.5", "约10", "10x"]) {
    assert.equal(planLessonImport(`单元测,语文,一班,2026-10-13,09:00,10:00,101,,${reminder}`, []).entries.length, 0);
  }
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, "2026-10-01T00:00:00+08:00");
  assert.equal(applyLessonImportPlan(data, valid, "2026-10-01T00:00:00+08:00"), 1);
  assert.equal(applyLessonImportPlan(data, valid, "2026-10-01T00:01:00+08:00"), 0);
  assert.equal(planLessonImport("第二节,数学,二班,2026-10-13,09:30,10:15,102,,", data.lessons).entries.length, 0);
  const fileOverlap = planLessonImport("第一节,语文,一班,2026-10-14,9:00,10:00,101,,\n第二节,数学,二班,2026-10-14,09:30,10:15,102,,", []);
  assert.equal(fileOverlap.entries.length, 1);
  assert.match(fileOverlap.issues[0].message, /时间重叠/);
  data.lessonTemplates = [{ id: "LT-CONFLICT", weekday: 3, startTime: "08:00", endTime: "08:45", title: "固定课", subject: "数学", className: "二班", room: "102", preparation: "", reminderMinutesBefore: null, semesterStart: "2026-10-01", semesterEnd: "2026-10-31" }];
  data.lessonExceptions = [{ id: "MOVE", templateId: "LT-CONFLICT", date: "2026-10-14", action: "reschedule", newDate: "2026-10-15", newStartTime: "10:00", newEndTime: "10:45" }];
  const rescheduled = planLessonImport("第三节,语文,三班,2026-10-15,10:15,11:00,103,,", data.lessons, data);
  assert.equal(rescheduled.entries.length, 0);
  assert.match(rescheduled.issues[0].message, /已有课程/);
});

test("export file round-trips through parseWorkbenchImportText", () => {
  const data = createSeedWorkbenchData();
  const now = "2026-10-12T20:00:00+08:00";
  const serialized = serializeWorkbenchExport(data, now);
  const restored = parseWorkbenchImportText(serialized, now);
  assert.equal(restored.data.students.length, data.students.length);
  assert.equal(restored.data.tasks.length, data.tasks.length);
  assert.equal(restored.data.meta.containsDemoData, true);
  assert.throws(() => parseWorkbenchImportText("not json", now), /文件格式无法识别/);
  assert.throws(() => parseWorkbenchImportText("{}", now), /不是可识别/);
  assert.throws(() => parseWorkbenchImportText("[]", now), /无法识别/);
  assert.throws(() => parseWorkbenchImportText('{"schemaVersion":99}', now), /UNSUPPORTED/);
  const malformed = structuredClone(data);
  malformed.students[0].assessments[0].score = 9999;
  assert.throws(() => parseWorkbenchImportText(JSON.stringify(malformed), now), /结构或字段不完整/);
});

test("every save rotates the previous version into rolling backups", () => {
  const storage = new MemoryStorage();
  const access = DESKTOP_DEVICE_LOCAL_ACCESS;
  const base = createSeedWorkbenchData();

  const times = ["2026-10-01T10:00:00+08:00", "2026-10-02T10:00:00+08:00", "2026-10-03T10:00:00+08:00", "2026-10-04T10:00:00+08:00"];
  let current = base;
  for (const now of times) {
    current = applyWorkbenchUpdate(current, access, (draft) => {
      draft.tasks[0].title = `修改于 ${now}`;
    }, now);
    const saved = saveDeviceLocalWorkbench(current, { access, storage, savedAt: now });
    assert.equal(saved.ok, true);
  }

  const backups = listDeviceLocalBackups(storage);
  assert.equal(backups.length, 3, "keeps at most three rolling backups");
  assert.equal(backups[0].revision, current.meta.revision - 1);
  assert.ok(backups[0].savedAt > backups[1].savedAt);
  assert.ok(storage.getItem(WORKBENCH_BACKUP_KEY));
  // Backup payload restores to valid data.
  const parsed = JSON.parse(backups[0].payload);
  assert.equal(parsed.storageKind, "device-local");
});

test("the first save backs up the in-memory previous state", () => {
  const storage = new MemoryStorage();
  const previous = createSeedWorkbenchData();
  const next = createEmptyWorkbenchData(previous.user, "2026-10-01T10:00:00+08:00");
  const saved = saveDeviceLocalWorkbench(next, {
    access: DESKTOP_DEVICE_LOCAL_ACCESS,
    storage,
    savedAt: "2026-10-01T10:00:00+08:00",
    previousDataForBackup: previous,
  });
  assert.equal(saved.ok, true);
  const backups = listDeviceLocalBackups(storage);
  assert.equal(backups.length, 1);
  const restored = parseWorkbenchImportText(backups[0].payload, "2026-10-01T10:01:00+08:00");
  assert.equal(restored.data.meta.containsDemoData, true);
  assert.equal(restored.data.students.length, previous.students.length);
});

test("ICS calendar contains lessons, open tasks and reminder alarms", () => {
  const data = createSeedWorkbenchData();
  const ics = buildIcsCalendar(data, "2026-10-12T20:00:00+08:00");
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
  const eventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
  const expected = data.lessons.length + data.tasks.filter((task) => task.status !== "已完成").length;
  assert.equal(eventCount, expected);
  assert.match(ics, /TRIGGER:-PT10M/);
  assert.match(ics, /SUMMARY:八年级4班 班会｜班会：运动会岗位确认/);
  // Completed tasks never appear.
  assert.ok(!ics.includes("提交教研组周计划"));
  assert.ok(ics.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
});

test("task calendar alarms keep the chosen reminder time regardless of task duration", () => {
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, "2026-10-01T00:00:00+08:00");
  data.tasks = [{ id: "T-ALARM", category: "教学", title: "备课", dueAt: "2026-10-12T12:00:00+08:00", estimatedMinutes: 60, status: "待开始", reminderAt: "2026-10-12T11:30:00+08:00" }];
  const ics = buildIcsCalendar(data, "2026-10-12T08:00:00+08:00");
  assert.match(ics, /DTSTART:20261012T030000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261012T033000Z/);
  data.tasks[0].reminderAt = data.tasks[0].dueAt;
  assert.match(buildIcsCalendar(data, "2026-10-12T08:00:00+08:00"), /TRIGGER;VALUE=DATE-TIME:20261012T040000Z/);
  assert.equal(computeDueReminders(data, data.tasks[0].dueAt, new Set()).length, 1);
  assert.equal(computeDueReminders(data, "2026-10-12T12:00:30+08:00", new Set()).length, 1);
  assert.equal(computeDueReminders(data, "2026-10-12T12:01:00+08:00", new Set()).length, 0);
});

test("recurring and weekend lessons enter ICS and reminder computation", () => {
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, "2026-09-01T00:00:00+08:00");
  data.lessonTemplates = [{ id: "WEEKEND", weekday: 7, startTime: "09:00", endTime: "09:45", title: "周日课", subject: "数学", className: "教培1班", room: "教室1", preparation: "练习册", reminderMinutesBefore: 15, semesterStart: "2026-09-01", semesterEnd: "2026-09-30" }];
  const ics = buildIcsCalendar(data, "2026-09-01T00:00:00+08:00");
  assert.match(ics, /SUMMARY:教培1班 数学｜周日课/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 4, "September 2026 contains four Sundays");
  const reminder = computeDueReminders(data, "2026-09-06T08:50:00+08:00", new Set());
  assert.equal(reminder.length, 1);
  assert.equal(reminder[0].title, "周日课");
});

test("ICS folding counts UTF-8 octets and never splits Unicode characters", () => {
  const folded = foldIcsLineUtf8(`DESCRIPTION:${"中文课堂🙂".repeat(30)}`);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75));
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ")));
  assert.equal(lines.join("").replaceAll(" ", "").includes("�"), false);
});

test("mobile view files are strict, minimal and stored separately from the workspace", () => {
  const data = createSeedWorkbenchData();
  const snapshot = createMobileReadOnlySnapshot(data, "2026-09-16T15:40:00+08:00");
  const text = serializeMobileViewFile(snapshot, "2026-09-16T15:40:00+08:00");
  const parsed = parseMobileViewFile(text);
  assert.deepEqual(parsed.envelope.snapshot, snapshot);
  assert.ok(!text.includes('"assessments"'));
  assert.ok(!text.includes('"homeSchool"'));
  assert.ok(!text.includes('"resources"'));
  assert.ok(!text.includes('"lessonTemplates"'));
  assert.throws(() => parseMobileViewFile("{}"), /结构|字段|选择/);
  const wrongKind = JSON.parse(text);
  wrongKind.kind = "device-local";
  assert.throws(() => parseMobileViewFile(JSON.stringify(wrongKind)), /电脑工作台生成/);
  const writable = JSON.parse(text);
  writable.snapshot.readOnly = false;
  assert.throws(() => parseMobileViewFile(JSON.stringify(writable)), /只读标记/);
  const withUnknown = JSON.parse(text);
  withUnknown.snapshot.students = [];
  assert.throws(() => parseMobileViewFile(JSON.stringify(withUnknown)), /不支持的字段/);

  const storage = new MemoryStorage();
  assert.equal(loadImportedMobileView(storage).snapshot, null);
  assert.equal(saveImportedMobileView(storage, snapshot).ok, true);
  assert.equal(storage.getItem("teacher-workbench:device-local:v1"), null);
  assert.deepEqual(loadImportedMobileView(storage).snapshot, snapshot);
});

test("mobile imports validate actual values and compare timestamps as instants", () => {
  const snapshot = createMobileReadOnlySnapshot(createSeedWorkbenchData(), "2026-09-16T15:40:00+08:00");
  const file = JSON.parse(serializeMobileViewFile(snapshot, snapshot.generatedAt));
  const corruptions = [
    (value) => { value.snapshot.priorityStudents[0].currentRank = -1; },
    (value) => { value.snapshot.priorityStudents[0].latestScore = 9999; },
    (value) => { value.snapshot.priorityStudents[1] = value.snapshot.priorityStudents[0]; },
    (value) => { value.snapshot.upcomingLessons[0].endsAt = value.snapshot.upcomingLessons[0].startsAt; },
    (value) => { value.snapshot.generatedAt = "2026-02-30T08:00:00+08:00"; },
  ];
  for (const corrupt of corruptions) {
    const malformed = structuredClone(file);
    corrupt(malformed);
    assert.throws(() => parseMobileViewFile(JSON.stringify(malformed)));
  }
  const current = { ...snapshot, generatedAt: "2026-09-16T08:00:00Z" };
  assert.equal(parseMobileViewFile(JSON.stringify(file), current).warnings.length, 1);
  const failingStorage = { getItem() { throw new Error("SecurityError"); } };
  assert.deepEqual(loadImportedMobileView(failingStorage), { snapshot: null, warning: "手机内容无法读取，请重新导入电脑生成的文件。" });
});

test("mobile files preserve long teacher text while enforcing the whole-file byte limit", () => {
  const now = "2026-09-16T08:00:00+08:00";
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, now);
  const title = "备课要求：整理例题和讲评思路。".repeat(100);
  data.tasks = [{ id: "T-LONG", category: "教学", title, dueAt: "2026-09-16T18:00:00+08:00", estimatedMinutes: 30, status: "待开始", reminderAt: null }];
  const snapshot = createMobileReadOnlySnapshot(data, now);
  const text = serializeMobileViewFile(snapshot, now);
  assert.equal(parseMobileViewFile(text).envelope.snapshot.openTasks[0].title, title);
  assert.equal(data.tasks[0].title, title, "export must not shorten the desktop original");
  const oversized = structuredClone(snapshot);
  oversized.openTasks[0].title = "长".repeat(180_000);
  assert.throws(() => serializeMobileViewFile(oversized, now), /512KB/);
  const oversizedFile = JSON.parse(text);
  oversizedFile.snapshot.openTasks[0].title = oversized.openTasks[0].title;
  assert.throws(() => parseMobileViewFile(JSON.stringify(oversizedFile)), /512KB/);
});

test("computeDueReminders fires inside the reminder window only once", () => {
  const data = createSeedWorkbenchData();
  // Lesson L-20260916-03 starts 15:50 with a 15-minute reminder.
  const before = computeDueReminders(data, "2026-09-16T15:34:00+08:00", new Set());
  assert.equal(before.length, 0);
  const inside = computeDueReminders(data, "2026-09-16T15:36:00+08:00", new Set());
  assert.equal(inside.length, 1);
  assert.equal(inside[0].kind, "课次");
  const delivered = new Set(inside.map((reminder) => reminder.key));
  assert.equal(computeDueReminders(data, "2026-09-16T15:37:00+08:00", delivered).length, 0);
  const after = computeDueReminders(data, "2026-09-16T15:51:00+08:00", new Set());
  assert.equal(after.length, 0);

  // Task T001 reminds at 14:50 with a 15:20 due time; completed tasks never fire.
  const taskDue = computeDueReminders(data, "2026-09-16T14:55:00+08:00", new Set());
  assert.ok(taskDue.some((reminder) => reminder.kind === "事项" && reminder.title.includes("岗位表")));
  const done = applyWorkbenchUpdate(data, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    const task = draft.tasks.find((candidate) => candidate.id === "T001");
    task.status = "已完成";
  }, "2026-09-16T14:56:00+08:00");
  assert.ok(!computeDueReminders(done, "2026-09-16T14:57:00+08:00", new Set()).some((reminder) => reminder.title.includes("岗位表")));
});

test("lesson reminders longer than one day fire at the configured time", () => {
  const data = createEmptyWorkbenchData(createSeedWorkbenchData().user, "2026-09-01T00:00:00+08:00");
  data.lessons.push({
    id: "L-LONG-REMINDER",
    title: "提前两天提醒",
    subject: "语文",
    className: "八年级1班",
    startsAt: "2026-09-10T10:00:00+08:00",
    endsAt: "2026-09-10T10:45:00+08:00",
    room: "101",
    preparation: "讲义",
    status: "待上课",
    reminderMinutesBefore: 2880,
  });

  assert.equal(computeDueReminders(data, "2026-09-08T09:59:00+08:00", new Set()).length, 0);
  const due = computeDueReminders(data, "2026-09-08T10:00:00+08:00", new Set());
  assert.equal(due.length, 1);
  assert.equal(due[0].title, "提前两天提醒");
  assert.equal(computeDueReminders(data, "2026-09-08T10:01:00+08:00", new Set([due[0].key])).length, 0);
});

test("device local date and empty workspace support real-data onboarding", () => {
  assert.equal(getDeviceLocalDate("2026-10-12T15:30:00+08:00", "Asia/Shanghai"), "2026-10-12");
  assert.match(getDeviceLocalDate(new Date(), "Asia/Shanghai"), /^\d{4}-\d{2}-\d{2}$/);

  const seed = createSeedWorkbenchData();
  const empty = createEmptyWorkbenchData(seed.user, "2026-10-12T20:00:00+08:00");
  assert.equal(empty.meta.containsDemoData, false);
  assert.equal(empty.students.length, 0);
  assert.equal(empty.user.teacherName, seed.user.teacherName);
  const summary = summarizeWorkbench(empty, "2026-10-12");
  assert.equal(summary.totalStudents, 0);
  assert.equal(summary.openTasks, 0);
});

test("priority ranking and summaries stay fast at real-world scale", () => {
  const data = createSeedWorkbenchData();
  const rows = [];
  for (let index = 0; index < 96; index += 1) {
    rows.push(`学生${String(index + 1).padStart(3, "0")},八年级${(index % 6) + 1}班,阶段测,2026-10-12,100,${55 + (index % 45)},${(index % 45) + 1},45,78`);
  }
  const plan = planAssessmentImport(rows.join("\n"), data.students);
  assert.equal(plan.issues.length, 0);
  const updated = applyWorkbenchUpdate(data, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    applyAssessmentImportPlan(draft, plan, "2026-10-12T20:00:00+08:00");
  }, "2026-10-12T20:00:00+08:00");
  assert.equal(updated.students.length, 104);

  const started = performance.now();
  const priorities = rankPriorityStudents(updated.students);
  const summary = summarizeWorkbench(updated, "2026-10-12");
  const elapsed = performance.now() - started;
  assert.equal(priorities.length, 104);
  assert.equal(summary.totalStudents, 104);
  assert.ok(elapsed < 500, `summary of 104 students should be fast, took ${elapsed}ms`);
});

test("recurring lesson templates expand across the semester with exceptions", () => {
  const empty = createEmptyWorkbenchData(createSeedWorkbenchData().user, "2026-09-01T00:00:00+08:00");
  const withTemplate = applyWorkbenchUpdate(empty, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    draft.lessonTemplates = [{
      id: "LT1",
      weekday: 3, // 周三
      startTime: "08:00",
      endTime: "08:45",
      title: "语文正课",
      subject: "语文",
      className: "八年级4班",
      room: "教学楼 302",
      preparation: "课件",
      reminderMinutesBefore: 10,
      semesterStart: "2026-09-01",
      semesterEnd: "2026-09-30",
    }];
  }, "2026-09-01T00:00:00+08:00");

  // 2026-09-02 是周三,2026-09-09/16/23/30 也是周三(9月共5个周三在学期内)
  const expanded = expandLessonsForRange(withTemplate, "2026-09-01", "2026-09-30", "2026-09-01T00:00:00+08:00");
  const wednesdays = expanded.filter((l) => l.id.startsWith("LT1@"));
  assert.ok(wednesdays.length >= 4, "模板应在学期内每周三展开");
  assert.ok(wednesdays.every((l) => l.className === "八年级4班"));

  // 取消 2026-09-09 那一节
  const withCancel = applyWorkbenchUpdate(withTemplate, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    draft.lessonExceptions = [{ id: "LE1", templateId: "LT1", date: "2026-09-09", action: "cancel" }];
  }, "2026-09-01T00:00:00+08:00");
  const afterCancel = expandLessonsForRange(withCancel, "2026-09-01", "2026-09-30", "2026-09-01T00:00:00+08:00");
  assert.ok(!afterCancel.some((l) => l.id === "LT1@2026-09-09"), "取消的当天不应出现");
  assert.ok(afterCancel.some((l) => l.id === "LT1@2026-09-16"), "其他周照常");

  // 调课:2026-09-16 改到 14:00 另一教室
  const withMove = applyWorkbenchUpdate(withTemplate, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    draft.lessonExceptions = [{ id: "LE2", templateId: "LT1", date: "2026-09-16", action: "reschedule", newStartTime: "14:00", newEndTime: "14:45", newRoom: "录播室" }];
  }, "2026-09-01T00:00:00+08:00");
  const afterMove = expandLessonsForRange(withMove, "2026-09-01", "2026-09-30", "2026-09-01T00:00:00+08:00");
  const moved = afterMove.find((l) => l.id === "LT1@2026-09-16");
  assert.ok(moved);
  assert.equal(moved.startsAt, "2026-09-16T14:00:00+08:00");
  assert.equal(moved.room, "录播室");

  // 跨范围调课：原周不显示，目标周显示一次，ID仍绑定原日期。
  const crossWeek = applyWorkbenchUpdate(withTemplate, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    draft.lessonExceptions = [{ id: "LE3", templateId: "LT1", date: "2026-09-30", action: "reschedule", newDate: "2026-10-05", newStartTime: "10:00", newEndTime: "10:45" }];
  }, "2026-09-01T00:00:00+08:00");
  assert.ok(!expandLessonsForRange(crossWeek, "2026-09-28", "2026-10-04", "2026-09-01T00:00:00Z").some((lesson) => lesson.id === "LT1@2026-09-30"));
  const targetWeek = expandLessonsForRange(crossWeek, "2026-10-05", "2026-10-11", "2026-09-01T00:00:00Z").filter((lesson) => lesson.id === "LT1@2026-09-30");
  assert.equal(targetWeek.length, 1);
  assert.equal(targetWeek[0].startsAt, "2026-10-05T10:00:00+08:00");
  const crossWeekIcs = buildIcsCalendar(crossWeek, "2026-09-01T00:00:00+08:00");
  assert.ok(crossWeekIcs.includes("UID:LT1@2026-09-30@teacher-workbench"));
  assert.ok(crossWeekIcs.includes("DTSTART:20261005T020000Z"), "ICS must include a move beyond semesterEnd");
  assert.ok(!crossWeekIcs.includes("DTSTART:20260930T000000Z"), "the source occurrence must not remain in ICS");

  // A one-sided time edit must fail validation; expansion also skips such
  // malformed input defensively if a caller bypasses the transaction guard.
  assert.throws(() => applyWorkbenchUpdate(withTemplate, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => {
    draft.lessonExceptions = [{ id: "LE-BROKEN", templateId: "LT1", date: "2026-09-16", action: "reschedule", newStartTime: "14:00" }];
  }, "2026-09-01T00:01:00+08:00"), /INVALID_WORKBENCH_DATA/);
  const malformedPartialMove = structuredClone(withTemplate);
  malformedPartialMove.lessonExceptions = [{ id: "LE-BROKEN", templateId: "LT1", date: "2026-09-16", action: "reschedule", newStartTime: "14:00" }];
  assert.ok(!expandLessonsForRange(malformedPartialMove, "2026-09-16", "2026-09-16", "2026-09-01T00:00:00Z").some((lesson) => lesson.id === "LT1@2026-09-16"));

  // Production passes UTC Z timestamps; completed status must compare instants.
  const afterClass = expandLessonsForRange(withTemplate, "2026-09-02", "2026-09-02", "2026-09-02T01:00:00Z");
  assert.equal(afterClass[0].status, "已完成", "09:00 China time is after an 08:45 lesson");

  // 当日课次汇总把模板展开算进去
  const summary = summarizeWorkbench(withTemplate, "2026-09-02");
  assert.equal(summary.lessonsOnDate, 1, "周三当日应有 1 节模板课");
  const summaryOff = summarizeWorkbench(withTemplate, "2026-09-03");
  assert.equal(summaryOff.lessonsOnDate, 0, "周四无课");

  // 手机内容包含模板展开的未来课次
  const snapshot = createMobileReadOnlySnapshot(withTemplate, "2026-09-01T07:00:00+08:00", { localDate: "2026-09-01" });
  assert.ok(snapshot.upcomingLessons.some((l) => l.id.startsWith("LT1@")), "手机待上课应含模板展开课次");
});

test("inbox quick-capture serializes, parses and converts to pending tasks", () => {
  const items = [
    { id: "N-1", text: "提醒李明澈带阅读单", category: "学生", createdAt: "2026-09-16T08:00:00+08:00" },
    { id: "N-2", text: "准备单元三课件", category: "教学", createdAt: "2026-09-16T08:05:00+08:00" },
  ];
  const payload = serializeInbox(items);
  const parsed = parseInbox(payload);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].text, "提醒李明澈带阅读单");

  const tasks = inboxToTasks(parsed, "2026-09-16T12:00:00+08:00");
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].status, "待开始");
  assert.equal(tasks[0].relatedLabel, "手机速记");
  assert.match(tasks[0].dueAt, /^2026-09-16T18:00/);

  assert.throws(() => parseInbox("不是 json"), /速记/);
  assert.throws(() => parseInbox("{}"), /没有识别到速记内容/);
});

test("inbox import never silently loses malformed notes or creates duplicate tasks", () => {
  const item = { id: "N-ONE", text: "准备讲义", category: "教学", createdAt: "2026-09-16T08:00:00+08:00" };
  assert.equal(parseInbox(serializeInbox([item, item])).length, 1);
  assert.throws(() => parseInbox(serializeInbox([item, { ...item, text: "不同内容" }])), /编号相同/);
  assert.throws(() => parseInbox(serializeInbox([item, { ...item, id: "N-TWO", text: "" }])), /本次没有导入任何/);
  assert.throws(() => parseInbox(JSON.stringify({ kind: "wrong", version: 1, items: [item] })), /没有识别到/);
  assert.throws(() => parseInbox(serializeInbox([{ ...item, createdAt: "2026-02-30" }])), /内容不完整/);
});

test("student signals: green streak, red streak, cliff drop, anomaly and maxscore change", async () => {
  const { analyzeStudentSignals, collectStudentSignals, buildStudentInsights, getSubjectBreakdown } = await import("../app/workbench-data.ts");

  const make = (scores) => ({
    id: "SX",
    name: "测试生",
    className: "八年级1班",
    initials: "测试",
    color: "sage",
    recentIssue: null,
    homeSchool: { communicationDifficulty: 3, communicationNote: "", supportWillingness: 3, supportNote: "", updatedAt: "2026-09-01T00:00:00+08:00" },
    assessments: scores.map(([score, maxScore, i]) => ({
      id: `A${i}`, title: `测${i}`, subject: "语文", occurredOn: `2026-09-0${i}`,
      maxScore, score, rank: 10, cohortSize: 45, classAverage: maxScore * 0.75,
      status: "已核对", source: "手工录入",
    })),
  });

  // 绿色:连续两次上涨
  const green = analyzeStudentSignals(make([[60, 100, 1], [70, 100, 2], [80, 100, 3]]));
  assert.ok(green.some((s) => s.tone === "green" && s.rule === "improve-streak"));

  // 红色:连续两次下降
  const red = analyzeStudentSignals(make([[80, 100, 1], [72, 100, 2], [65, 100, 3]]));
  assert.ok(red.some((s) => s.tone === "red" && s.rule === "decline-streak"));

  // 红色断崖:单次降幅 ≥15 个百分点
  const cliff = analyzeStudentSignals(make([[85, 100, 1], [68, 100, 2]]));
  assert.ok(cliff.some((s) => s.tone === "red" && s.rule === "cliff-drop"));

  // 黄色异常:单次涨幅 ≥30
  const jump = analyzeStudentSignals(make([[55, 100, 1], [90, 100, 2]]));
  assert.ok(jump.some((s) => s.tone === "yellow" && s.rule === "anomaly-jump"));

  // 黄色满分不一致:100 → 300
  const maxChange = analyzeStudentSignals(make([[80, 100, 1], [240, 300, 2]]));
  assert.ok(maxChange.some((s) => s.tone === "yellow" && s.rule === "maxscore-change"));

  // 未核对测评不参与判定
  const unconfirmed = make([[60, 100, 1], [70, 100, 2], [85, 100, 3]]);
  unconfirmed.assessments[2].status = "待核对";
  assert.equal(analyzeStudentSignals(unconfirmed).filter((s) => s.rule === "improve-streak").length, 0);

  // 聚合:绿优先、去重已关闭、最多3条
  const students = [
    { ...make([[60, 100, 1], [70, 100, 2], [80, 100, 3]]), id: "S1", name: "甲" },
    { ...make([[80, 100, 1], [72, 100, 2], [65, 100, 3]]), id: "S2", name: "乙" },
  ];
  const collected = collectStudentSignals(students, new Set(), 3);
  assert.ok(collected.length <= 3);
  assert.equal(collected[0].tone, "red", "需关注的下降提示应排在最前,不被好消息挤掉");
  const dismissed = new Set(collected.map((s) => s.key));
  assert.equal(collectStudentSignals(students, dismissed, 3).length, 0, "全部关闭后应无提示");

  // 分科与结论
  const multi = make([[80, 100, 1], [85, 100, 2]]);
  multi.assessments.push({ id: "M1", title: "单元一", subject: "数学", occurredOn: "2026-09-06", maxScore: 100, score: 62, rank: 30, cohortSize: 45, classAverage: 75, status: "已核对", source: "手工录入" });
  const breakdown = getSubjectBreakdown(multi);
  assert.equal(breakdown.length, 2);
  const insights = buildStudentInsights(multi);
  assert.ok(insights.some((text) => text.includes("目前得分率较低的是数学")));
});
