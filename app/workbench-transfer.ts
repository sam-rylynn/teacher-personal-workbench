/**
 * Teacher Workbench transfer layer: real-data import, backup/export files,
 * ICS calendar generation and local reminder computation.
 *
 * Like workbench-data.ts this module has no React or server dependency. All
 * parsing and validation is pure so it can be unit-tested with node:test.
 */

import {
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_STORAGE_KIND,
  deserializeWorkbenchData,
  getDeviceLocalDate,
  type AssessmentRecord,
  type LessonSession,
  type StudentRecord,
  type TaskCategory,
  type WorkbenchBackupEntry,
  type WorkbenchData,
  type WorkbenchHydrationResult,
  type WorkbenchTask,
} from "./workbench-data.ts";

/* ------------------------------------------------------------------------ */
/* Delimited text parsing (CSV / TSV paste)                                  */
/* ------------------------------------------------------------------------ */

/**
 * Parses CSV, TSV or semicolon-separated text (including quoted cells with
 * embedded separators and newlines) into a grid of trimmed strings.
 */
export function parseDelimitedText(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  let separator: string | null = null;

  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      inQuotes = true;
      continue;
    }
    if (char === "," || char === "\t" || char === ";") {
      if (separator === null) separator = char;
      if (char === separator || separator !== "\t" || char !== ",") {
        row.push(cell.trim());
        cell = "";
        continue;
      }
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      separator = null;
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

/** Splits a grid into a header row and body rows, requiring known columns. */
function splitHeader(rows: string[][], requiredColumns: string[]): { header: string[]; body: string[][] } | null {
  if (rows.length === 0) return null;
  const [first, ...rest] = rows;
  const looksLikeHeader = requiredColumns.some((column) => first.includes(column));
  return looksLikeHeader ? { header: first, body: rest } : { header: [], body: rows };
}

function columnIndex(header: string[], aliases: string[], fallback: number): number {
  for (const alias of aliases) {
    const index = header.indexOf(alias);
    if (index >= 0) return index;
  }
  return fallback;
}

/* ------------------------------------------------------------------------ */
/* Shared import validation                                                  */
/* ------------------------------------------------------------------------ */

export interface ImportIssue {
  rowNumber: number;
  field: string;
  message: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  );
}

function parseNumberCell(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const AVATAR_COLORS = ["sage", "apricot", "blue", "rose", "violet", "teal", "gold", "coral"] as const;

function studentInitials(name: string): string {
  return name.length > 2 ? name.slice(-2) : name;
}

function findStudentByIdentity(students: readonly StudentRecord[], name: string, className: string): StudentRecord | undefined {
  return students.find((student) => student.name === name && student.className === className);
}

/* ------------------------------------------------------------------------ */
/* Assessment import (学生名单 + 测评)                                        */
/* ------------------------------------------------------------------------ */

export interface AssessmentImportEntry {
  studentName: string;
  className: string;
  isNewStudent: boolean;
  record: Omit<AssessmentRecord, "id" | "verifiedAt">;
}

export interface AssessmentImportPlan {
  entries: AssessmentImportEntry[];
  issues: ImportIssue[];
  newStudentCount: number;
}

const ASSESSMENT_COLUMNS = {
  name: ["姓名", "学生姓名", "名字"],
  className: ["班级", "班"],
  title: ["测评", "测评名称", "考试", "名称"],
  subject: ["学科", "科目"],
  occurredOn: ["日期", "测评日期", "考试日期"],
  maxScore: ["满分", "总分"],
  score: ["成绩", "分数", "得分"],
  rank: ["排名", "名次", "班级排名"],
  cohortSize: ["参考人数", "人数", "班级人数"],
  classAverage: ["班级均分", "均分", "平均分"],
} as const;

/**
 * Builds a validated import plan from pasted spreadsheet text. Existing data
 * is only read, never modified; nothing is applied until the teacher confirms.
 */
export function planAssessmentImport(
  text: string,
  students: readonly StudentRecord[],
  options: { defaultSubject?: string; defaultMaxScore?: number } = {},
): AssessmentImportPlan {
  const rows = parseDelimitedText(text);
  const issues: ImportIssue[] = [];
  const entries: AssessmentImportEntry[] = [];
  const split = splitHeader(rows, [...ASSESSMENT_COLUMNS.name, ...ASSESSMENT_COLUMNS.score]);
  if (!split || split.body.length === 0) {
    return { entries, issues: [{ rowNumber: 0, field: "内容", message: "没有识别到可导入的数据行。" }], newStudentCount: 0 };
  }

  const index = {
    name: columnIndex(split.header, [...ASSESSMENT_COLUMNS.name], 0),
    className: columnIndex(split.header, [...ASSESSMENT_COLUMNS.className], 1),
    title: columnIndex(split.header, [...ASSESSMENT_COLUMNS.title], 2),
    subject: columnIndex(split.header, [...ASSESSMENT_COLUMNS.subject], -1),
    occurredOn: columnIndex(split.header, [...ASSESSMENT_COLUMNS.occurredOn], 3),
    maxScore: columnIndex(split.header, [...ASSESSMENT_COLUMNS.maxScore], 4),
    score: columnIndex(split.header, [...ASSESSMENT_COLUMNS.score], 5),
    rank: columnIndex(split.header, [...ASSESSMENT_COLUMNS.rank], 6),
    cohortSize: columnIndex(split.header, [...ASSESSMENT_COLUMNS.cohortSize], 7),
    classAverage: columnIndex(split.header, [...ASSESSMENT_COLUMNS.classAverage], 8),
  };

  const seenInFile = new Set<string>();
  const newStudentKeys = new Set<string>();
  let validRowNumber = 0;

  split.body.forEach((cells, bodyIndex) => {
    const rowNumber = bodyIndex + (split.header.length ? 2 : 1);
    const name = cells[index.name] ?? "";
    const className = cells[index.className] ?? "";
    const title = cells[index.title] ?? "";
    const subject = (index.subject >= 0 ? cells[index.subject] : "") || options.defaultSubject || "语文";
    const occurredOn = (cells[index.occurredOn] ?? "").replaceAll("/", "-").replaceAll(".", "-");
    const maxScore = parseNumberCell(cells[index.maxScore] ?? "") ?? options.defaultMaxScore ?? 100;
    const score = parseNumberCell(cells[index.score] ?? "");
    const rank = parseNumberCell(cells[index.rank] ?? "");
    const cohortSize = parseNumberCell(cells[index.cohortSize] ?? "");
    const classAverage = parseNumberCell(cells[index.classAverage] ?? "") ?? 0;

    const fail = (field: string, message: string) => issues.push({ rowNumber, field, message });
    if (!name) return fail("姓名", "缺少学生姓名。");
    if (!className) return fail("班级", "缺少班级。");
    if (!title) return fail("测评", "缺少测评名称。");
    if (!isValidDate(occurredOn)) return fail("日期", `日期“${cells[index.occurredOn] ?? ""}”不是有效的 YYYY-MM-DD。`);
    if (score === null) return fail("成绩", "成绩不是数字。");
    if (maxScore <= 0 || score < 0 || score > maxScore) return fail("成绩", `成绩 ${score} 超出 0 到满分 ${maxScore} 的范围。`);
    if (rank === null || !Number.isInteger(rank)) return fail("排名", "排名不是整数。");
    if (cohortSize === null || !Number.isInteger(cohortSize) || cohortSize < 1) return fail("参考人数", "参考人数不是正整数。");
    if (rank < 1 || rank > cohortSize) return fail("排名", `排名 ${rank} 不能大于参考人数 ${cohortSize}。`);
    if (classAverage < 0 || classAverage > maxScore) return fail("班级均分", "班级均分应在 0 到满分之间。");

    const fileKey = `${name}|${className}|${title}|${occurredOn}`;
    if (seenInFile.has(fileKey)) return fail("重复", "与本次导入内容中的另一行重复。");
    seenInFile.add(fileKey);

    const existing = findStudentByIdentity(students, name, className);
    if (existing?.assessments.some((assessment) => assessment.title === title && assessment.occurredOn === occurredOn)) {
      return fail("重复", "该学生已存在同名同日的测评记录。");
    }

    const studentKey = `${name}|${className}`;
    if (!existing) newStudentKeys.add(studentKey);
    validRowNumber += 1;
    entries.push({
      studentName: name,
      className,
      isNewStudent: !existing,
      record: {
        title,
        subject,
        occurredOn,
        maxScore,
        score,
        rank,
        cohortSize,
        classAverage,
        status: "待核对",
        source: "表格导入",
      },
    });
  });

  void validRowNumber;
  return { entries, issues, newStudentCount: newStudentKeys.size };
}

/**
 * Applies a confirmed import plan to a draft (inside applyWorkbenchUpdate).
 * New students are created with empty issue/home-school placeholders that
 * clearly require the teacher's own follow-up input.
 */
export function applyAssessmentImportPlan(
  draft: WorkbenchData,
  plan: AssessmentImportPlan,
  now: string,
): { addedStudents: number; addedAssessments: number } {
  let addedStudents = 0;
  let addedAssessments = 0;
  const byIdentity = new Map(draft.students.map((student) => [`${student.name}|${student.className}`, student]));

  plan.entries.forEach((entry, index) => {
    const key = `${entry.studentName}|${entry.className}`;
    let student = byIdentity.get(key);
    if (!student) {
      student = {
        id: `S-IMP-${now.replace(/\D/g, "").slice(0, 14)}-${index}`,
        name: entry.studentName,
        className: entry.className,
        initials: studentInitials(entry.studentName),
        color: AVATAR_COLORS[draft.students.length % AVATAR_COLORS.length],
        assessments: [],
        recentIssue: null,
        homeSchool: {
          communicationDifficulty: 3,
          communicationNote: "导入后尚未填写沟通情况。",
          supportWillingness: 3,
          supportNote: "导入后尚未填写家庭辅助情况。",
          updatedAt: now,
        },
      };
      draft.students.push(student);
      byIdentity.set(key, student);
      addedStudents += 1;
    }
    student.assessments.push({
      ...entry.record,
      id: `${student.id}-A-IMP-${now.replace(/\D/g, "").slice(0, 14)}-${index}`,
    });
    addedAssessments += 1;
  });

  return { addedStudents, addedAssessments };
}

/* ------------------------------------------------------------------------ */
/* Lesson import (课表)                                                      */
/* ------------------------------------------------------------------------ */

export interface LessonImportEntry {
  record: Omit<LessonSession, "id">;
}

export interface LessonImportPlan {
  entries: LessonImportEntry[];
  issues: ImportIssue[];
}

const LESSON_COLUMNS = {
  title: ["标题", "课次", "内容", "课题"],
  subject: ["学科", "科目"],
  className: ["班级", "班"],
  date: ["日期", "上课日期"],
  start: ["开始", "开始时间", "上课时间"],
  end: ["结束", "结束时间", "下课时间"],
  room: ["地点", "教室", "场地"],
  preparation: ["备课", "备课清单", "准备"],
  reminder: ["提醒", "课前提醒", "提醒分钟"],
} as const;

export function planLessonImport(text: string, lessons: readonly LessonSession[]): LessonImportPlan {
  const rows = parseDelimitedText(text);
  const issues: ImportIssue[] = [];
  const entries: LessonImportEntry[] = [];
  const split = splitHeader(rows, [...LESSON_COLUMNS.title, ...LESSON_COLUMNS.date]);
  if (!split || split.body.length === 0) {
    return { entries, issues: [{ rowNumber: 0, field: "内容", message: "没有识别到可导入的数据行。" }], };
  }

  const index = {
    title: columnIndex(split.header, [...LESSON_COLUMNS.title], 0),
    subject: columnIndex(split.header, [...LESSON_COLUMNS.subject], 1),
    className: columnIndex(split.header, [...LESSON_COLUMNS.className], 2),
    date: columnIndex(split.header, [...LESSON_COLUMNS.date], 3),
    start: columnIndex(split.header, [...LESSON_COLUMNS.start], 4),
    end: columnIndex(split.header, [...LESSON_COLUMNS.end], 5),
    room: columnIndex(split.header, [...LESSON_COLUMNS.room], 6),
    preparation: columnIndex(split.header, [...LESSON_COLUMNS.preparation], 7),
    reminder: columnIndex(split.header, [...LESSON_COLUMNS.reminder], 8),
  };

  const seenInFile = new Set<string>();
  split.body.forEach((cells, bodyIndex) => {
    const rowNumber = bodyIndex + (split.header.length ? 2 : 1);
    const title = cells[index.title] ?? "";
    const subject = cells[index.subject] ?? "";
    const className = cells[index.className] ?? "";
    const date = (cells[index.date] ?? "").replaceAll("/", "-").replaceAll(".", "-");
    const start = cells[index.start] ?? "";
    const end = cells[index.end] ?? "";
    const room = cells[index.room] ?? "";
    const preparation = cells[index.preparation] ?? "";
    const reminderRaw = cells[index.reminder] ?? "";

    const fail = (field: string, message: string) => issues.push({ rowNumber, field, message });
    if (!title) return fail("标题", "缺少课次标题。");
    if (!subject) return fail("学科", "缺少学科。");
    if (!className) return fail("班级", "缺少班级。");
    if (!isValidDate(date)) return fail("日期", `日期“${cells[index.date] ?? ""}”不是有效的 YYYY-MM-DD。`);
    if (!TIME_PATTERN.test(start)) return fail("开始时间", `开始时间“${start}”不是有效的 HH:MM。`);
    if (!TIME_PATTERN.test(end)) return fail("结束时间", `结束时间“${end}”不是有效的 HH:MM。`);
    if (end <= start) return fail("时间", "结束时间应晚于开始时间。");
    if (!room) return fail("地点", "缺少上课地点。");

    const fileKey = `${className}|${date}|${start}`;
    if (seenInFile.has(fileKey)) return fail("重复", "与本次导入内容中的另一行重复。");
    seenInFile.add(fileKey);

    const startsAt = `${date}T${start.length === 4 ? `0${start}` : start}:00+08:00`;
    const endsAt = `${date}T${end.length === 4 ? `0${end}` : end}:00+08:00`;
    if (lessons.some((lesson) => lesson.className === className && lesson.startsAt === startsAt)) {
      return fail("重复", "该班级在此时间已有课次。");
    }

    const reminderMinutes = reminderRaw === "" ? null : Number.parseInt(reminderRaw.replace(/\D/g, ""), 10);
    entries.push({
      record: {
        title,
        subject,
        className,
        startsAt,
        endsAt,
        room,
        preparation: preparation || "按教案准备",
        status: "待上课",
        reminderMinutesBefore: Number.isFinite(reminderMinutes) ? reminderMinutes : null,
      },
    });
  });

  return { entries, issues };
}

export function applyLessonImportPlan(draft: WorkbenchData, plan: LessonImportPlan, now: string): number {
  plan.entries.forEach((entry, index) => {
    draft.lessons.push({
      ...entry.record,
      id: `L-IMP-${now.replace(/\D/g, "").slice(0, 14)}-${index}`,
    });
  });
  return plan.entries.length;
}

/* ------------------------------------------------------------------------ */
/* Export / backup / restore                                                 */
/* ------------------------------------------------------------------------ */

/** Serializes the workspace into the portable export-file format. */
export function serializeWorkbenchExport(data: WorkbenchData, savedAt: string): string {
  return JSON.stringify(
    {
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      storageKind: WORKBENCH_STORAGE_KIND,
      exportedAt: savedAt,
      savedAt,
      data,
    },
    null,
    2,
  );
}

/**
 * Parses an export/backup file. Throws with a teacher-readable message when
 * the file cannot be understood; migration warnings are passed through.
 */
export function parseWorkbenchImportText(text: string, now: string): WorkbenchHydrationResult & { source: "stored" | "migrated" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("文件内容不是有效的 JSON，请选择本工作台导出的数据文件。");
  }
  try {
    return deserializeWorkbenchData(JSON.stringify(parsed), now) as WorkbenchHydrationResult & { source: "stored" | "migrated" };
  } catch (error) {
    throw new Error(error instanceof Error ? `文件无法识别：${error.message}` : "文件无法识别。");
  }
}

export function readBackupEntry(entry: WorkbenchBackupEntry, now: string): WorkbenchHydrationResult & { source: "stored" | "migrated" } {
  return deserializeWorkbenchData(entry.payload, now) as WorkbenchHydrationResult & { source: "stored" | "migrated" };
}

/* ------------------------------------------------------------------------ */
/* ICS calendar export                                                       */
/* ------------------------------------------------------------------------ */

function toIcsUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "19700101T000000Z";
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function foldIcsLine(line: string): string {
  const limit = 74;
  if (line.length <= limit) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > limit) {
    parts.push(rest.slice(0, limit));
    rest = ` ${rest.slice(limit)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** Builds an RFC 5545 calendar with one event per lesson and per open task. */
export function buildIcsCalendar(data: WorkbenchData, now: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//teacher-personal-workbench//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(data.user.workbenchName)}`,
  ];
  const stamp = toIcsUtc(now);

  for (const lesson of data.lessons) {
    if (lesson.status === "已取消") continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${lesson.id}@teacher-workbench`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(lesson.startsAt)}`);
    lines.push(`DTEND:${toIcsUtc(lesson.endsAt)}`);
    lines.push(`SUMMARY:${escapeIcsText(`${lesson.className} ${lesson.subject}｜${lesson.title}`)}`);
    lines.push(`LOCATION:${escapeIcsText(lesson.room)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(`备课清单：${lesson.preparation}`)}`);
    if (lesson.reminderMinutesBefore !== null) {
      lines.push("BEGIN:VALARM");
      lines.push(`TRIGGER:-PT${Math.max(1, Math.round(lesson.reminderMinutesBefore))}M`);
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcsText(lesson.title)}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  for (const task of data.tasks) {
    if (task.status === "已完成") continue;
    const due = new Date(task.dueAt);
    if (Number.isNaN(due.getTime())) continue;
    const end = new Date(due.getTime() + Math.max(15, task.estimatedMinutes) * 60_000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${task.id}@teacher-workbench`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(task.dueAt)}`);
    lines.push(`DTEND:${toIcsUtc(end.toISOString())}`);
    lines.push(`SUMMARY:${escapeIcsText(`事项｜${task.title}`)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(`类别：${task.category}${task.relatedLabel ? `；关联：${task.relatedLabel}` : ""}`)}`);
    if (task.reminderAt) {
      const triggerMinutes = Math.round((due.getTime() - new Date(task.reminderAt).getTime()) / 60_000);
      if (triggerMinutes > 0) {
        lines.push("BEGIN:VALARM");
        lines.push(`TRIGGER:-PT${triggerMinutes}M`);
        lines.push("ACTION:DISPLAY");
        lines.push(`DESCRIPTION:${escapeIcsText(task.title)}`);
        lines.push("END:VALARM");
      }
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------------ */
/* Local reminders (while the desktop page is open)                          */
/* ------------------------------------------------------------------------ */

export interface DueReminder {
  key: string;
  kind: "课次" | "事项";
  title: string;
  message: string;
}

/**
 * Returns reminders that are due at `nowIso` and have not been delivered yet.
 * Lesson reminders fire inside [start - minutes, start); task reminders fire
 * inside [reminderAt, dueAt]. Delivered keys should be persisted by the caller
 * for the duration of the session.
 */
export function computeDueReminders(data: WorkbenchData, nowIso: string, delivered: ReadonlySet<string>): DueReminder[] {
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(now)) return [];
  const due: DueReminder[] = [];

  for (const lesson of data.lessons) {
    if (lesson.status !== "待上课" || lesson.reminderMinutesBefore === null) continue;
    const start = new Date(lesson.startsAt).getTime();
    if (Number.isNaN(start)) continue;
    const remindAt = start - lesson.reminderMinutesBefore * 60_000;
    const key = `lesson:${lesson.id}:${lesson.startsAt}`;
    if (now >= remindAt && now < start && !delivered.has(key)) {
      due.push({
        key,
        kind: "课次",
        title: lesson.title,
        message: `${lesson.className} ${lesson.subject} 将于 ${lesson.startsAt.slice(11, 16)} 在${lesson.room}开始。`,
      });
    }
  }

  for (const task of data.tasks) {
    if (task.status === "已完成" || !task.reminderAt) continue;
    const remindAt = new Date(task.reminderAt).getTime();
    const dueAt = new Date(task.dueAt).getTime();
    if (Number.isNaN(remindAt) || Number.isNaN(dueAt)) continue;
    const key = `task:${task.id}:${task.reminderAt}`;
    if (now >= remindAt && now < dueAt && !delivered.has(key)) {
      due.push({
        key,
        kind: "事项",
        title: task.title,
        message: `截止时间为 ${task.dueAt.slice(11, 16)}，请安排处理。`,
      });
    }
  }

  return due;
}

/* ------------------------------------------------------------------------ */
/* Mobile quick-capture inbox (手机速记收集箱)                                */
/* ------------------------------------------------------------------------ */

export const INBOX_STORAGE_KEY = "teacher-workbench:inbox:v1" as const;

export interface InboxItem {
  id: string;
  text: string;
  category: TaskCategory;
  createdAt: string;
}

const INBOX_CATEGORIES: TaskCategory[] = ["教学", "学生", "行政", "论文"];

function isInboxItem(value: unknown): value is InboxItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as InboxItem;
  return (
    typeof item.id === "string" &&
    typeof item.text === "string" &&
    INBOX_CATEGORIES.includes(item.category) &&
    typeof item.createdAt === "string"
  );
}

/** Serializes phone-side quick-capture notes into a portable JSON payload. */
export function serializeInbox(items: readonly InboxItem[]): string {
  return JSON.stringify({ kind: "teacher-workbench-inbox", version: 1, items }, null, 2);
}

/**
 * Parses an inbox payload pasted on the desktop. Accepts the serialized
 * envelope or a bare array. Throws a teacher-readable message when invalid.
 */
export function parseInbox(text: string): InboxItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("内容不是有效的速记数据,请在手机上点“复制速记”后再粘贴到这里。");
  }
  const items = Array.isArray(parsed)
    ? parsed
    : (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null);
  if (!items) throw new Error("没有识别到速记内容。");
  const valid = items.filter(isInboxItem);
  if (valid.length === 0) throw new Error("没有识别到速记内容。");
  return valid;
}

/**
 * Converts captured notes into pending workbench tasks, due today at 18:00,
 * so the teacher reviews them on the desktop. Notes do not touch the
 * workspace until the teacher confirms on the PC.
 */
export function inboxToTasks(items: readonly InboxItem[], now: string, timeZone = "Asia/Shanghai"): Omit<WorkbenchTask, "id">[] {
  const today = getDeviceLocalDate(now, timeZone);
  return items.map((item) => ({
    category: item.category,
    title: item.text,
    dueAt: `${today}T18:00:00+08:00`,
    estimatedMinutes: 10,
    status: "待开始",
    reminderAt: null,
    relatedLabel: "手机速记",
  }));
}
