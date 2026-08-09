/**
 * Teacher Workbench transfer layer: real-data import, backup/export files,
 * ICS calendar generation and local reminder computation.
 *
 * Like workbench-data.ts this module has no React or server dependency. All
 * parsing and validation is pure so it can be unit-tested with node:test.
 */

import {
  MAX_LESSON_REMINDER_MINUTES,
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_STORAGE_KIND,
  expandLessonsForRange,
  getDeviceLocalDate,
  migrateWorkbenchData,
  type AssessmentRecord,
  type LessonSession,
  type MobileReadOnlySnapshot,
  type MobileStudentSummary,
  type StorageLike,
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

function reserveUniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
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
  const usedStudentIds = new Set(draft.students.map((student) => student.id));
  const usedAssessmentIds = new Set(draft.students.flatMap((student) => student.assessments.map((assessment) => assessment.id)));
  const importStamp = now.replace(/\D/g, "").slice(0, 14);

  plan.entries.forEach((entry, index) => {
    const key = `${entry.studentName}|${entry.className}`;
    let student = byIdentity.get(key);
    if (!student) {
      student = {
        id: reserveUniqueId(`S-IMP-${importStamp}-${index}`, usedStudentIds),
        name: entry.studentName,
        className: entry.className,
        initials: studentInitials(entry.studentName),
        color: AVATAR_COLORS[draft.students.length % AVATAR_COLORS.length],
        assessments: [],
        recentIssue: null,
        homeSchool: {
          communicationDifficulty: 0,
          communicationNote: "尚未设置，由老师手动选择。",
          supportWillingness: 0,
          supportNote: "尚未设置，由老师手动选择。",
          updatedAt: now,
        },
      };
      draft.students.push(student);
      byIdentity.set(key, student);
      addedStudents += 1;
    }
    student.assessments.push({
      ...entry.record,
      id: reserveUniqueId(`${student.id}-A-IMP-${importStamp}-${index}`, usedAssessmentIds),
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
    if (
      reminderRaw !== "" &&
      (typeof reminderMinutes !== "number" || !Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > MAX_LESSON_REMINDER_MINUTES)
    ) {
      return fail("提醒", `课前提醒应在 1 到 ${MAX_LESSON_REMINDER_MINUTES} 分钟之间。`);
    }
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
        reminderMinutesBefore: reminderMinutes,
      },
    });
  });

  return { entries, issues };
}

export function applyLessonImportPlan(draft: WorkbenchData, plan: LessonImportPlan, now: string): number {
  const usedLessonIds = new Set(draft.lessons.map((lesson) => lesson.id));
  const importStamp = now.replace(/\D/g, "").slice(0, 14);
  plan.entries.forEach((entry, index) => {
    draft.lessons.push({
      ...entry.record,
      id: reserveUniqueId(`L-IMP-${importStamp}-${index}`, usedLessonIds),
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
    throw new Error("文件格式无法识别，请选择本工作台导出的数据文件。");
  }
  try {
    return migrateWorkbenchData(parsed, now);
  } catch (error) {
    throw new Error(error instanceof Error ? `文件无法识别：${error.message}` : "文件无法识别。");
  }
}

export function readBackupEntry(entry: WorkbenchBackupEntry, now: string): WorkbenchHydrationResult & { source: "stored" | "migrated" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.payload);
  } catch {
    throw new Error("自动备份已损坏，未覆盖当前数据。");
  }
  try {
    return migrateWorkbenchData(parsed, now);
  } catch (error) {
    throw new Error(error instanceof Error ? `自动备份无法识别：${error.message}` : "自动备份无法识别。");
  }
}

/* ------------------------------------------------------------------------ */
/* Portable read-only mobile view                                            */
/* ------------------------------------------------------------------------ */

export const MOBILE_VIEW_FILE_KIND = "teacher-workbench-mobile-view" as const;
export const MOBILE_VIEW_FILE_VERSION = 1 as const;
export const MOBILE_VIEW_STORAGE_KEY = "teacher-workbench:mobile-view:v1" as const;
export const MOBILE_VIEW_MAX_BYTES = 512 * 1024;

export interface MobileViewFileV1 {
  kind: typeof MOBILE_VIEW_FILE_KIND;
  fileVersion: typeof MOBILE_VIEW_FILE_VERSION;
  exportedAt: string;
  snapshot: MobileReadOnlySnapshot;
}

export interface MobileViewImportResult {
  envelope: MobileViewFileV1;
  warnings: string[];
}

function mobileFileRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}结构不正确。`);
  }
  return value as Record<string, unknown>;
}

function exactMobileKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label}包含不支持的字段“${unknown[0]}”。`);
}

function mobileString(value: unknown, label: string, maxLength = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label}不正确。`);
  }
  return value;
}

function mobileOptionalString(value: unknown, label: string, maxLength = 500): string | undefined {
  if (value === undefined) return undefined;
  return mobileString(value, label, maxLength);
}

function mobileNumber(value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}不是有效数字。`);
  if (options.integer && !Number.isInteger(value)) throw new Error(`${label}必须是整数。`);
  if (options.min !== undefined && value < options.min) throw new Error(`${label}超出允许范围。`);
  if (options.max !== undefined && value > options.max) throw new Error(`${label}超出允许范围。`);
  return value;
}

function mobileNullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : mobileNumber(value, label);
}

function mobileIso(value: unknown, label: string): string {
  const text = mobileString(value, label, 80);
  if (Number.isNaN(new Date(text).getTime())) throw new Error(`${label}不是有效时间。`);
  return text;
}

function rebuildMobileStudent(value: unknown, index: number): MobileStudentSummary {
  const record = mobileFileRecord(value, `重点学生第 ${index + 1} 条`);
  exactMobileKeys(record, ["id", "name", "className", "latestScore", "latestMaxScore", "currentRank", "cohortSize", "scoreDelta", "rankDelta", "issueTitle", "issueStatus"], `重点学生第 ${index + 1} 条`);
  const issueStatus = record.issueStatus;
  if (issueStatus !== null && issueStatus !== "待处理" && issueStatus !== "观察中" && issueStatus !== "已缓解") {
    throw new Error(`重点学生第 ${index + 1} 条的问题状态不正确。`);
  }
  return {
    id: mobileString(record.id, "学生编号", 120),
    name: mobileString(record.name, "学生姓名", 80),
    className: mobileString(record.className, "班级", 120),
    latestScore: mobileNullableNumber(record.latestScore, "最新成绩"),
    latestMaxScore: mobileNullableNumber(record.latestMaxScore, "满分"),
    currentRank: mobileNullableNumber(record.currentRank, "当前排名"),
    cohortSize: mobileNullableNumber(record.cohortSize, "参考人数"),
    scoreDelta: mobileNullableNumber(record.scoreDelta, "成绩变化"),
    rankDelta: mobileNullableNumber(record.rankDelta, "排名变化"),
    issueTitle: record.issueTitle === null ? null : mobileString(record.issueTitle, "近期问题", 300),
    issueStatus,
  };
}

function rebuildMobileLesson(value: unknown, index: number): LessonSession {
  const record = mobileFileRecord(value, `课次第 ${index + 1} 条`);
  exactMobileKeys(record, ["id", "title", "subject", "className", "startsAt", "endsAt", "room", "preparation", "status", "reminderMinutesBefore"], `课次第 ${index + 1} 条`);
  if (record.status !== "待上课" && record.status !== "已完成" && record.status !== "已取消") throw new Error(`课次第 ${index + 1} 条状态不正确。`);
  return {
    id: mobileString(record.id, "课次编号", 160),
    title: mobileString(record.title, "课次标题", 300),
    subject: mobileString(record.subject, "学科", 100),
    className: mobileString(record.className, "班级", 120),
    startsAt: mobileIso(record.startsAt, "课次开始时间"),
    endsAt: mobileIso(record.endsAt, "课次结束时间"),
    room: typeof record.room === "string" && record.room.length <= 300 ? record.room : (() => { throw new Error("课次地点不正确。"); })(),
    preparation: typeof record.preparation === "string" && record.preparation.length <= 1000 ? record.preparation : (() => { throw new Error("备课清单不正确。"); })(),
    status: record.status,
    reminderMinutesBefore: record.reminderMinutesBefore === null ? null : mobileNumber(record.reminderMinutesBefore, "课前提醒", { min: 1, max: MAX_LESSON_REMINDER_MINUTES }),
  };
}

function rebuildMobileTask(value: unknown, index: number): WorkbenchTask {
  const record = mobileFileRecord(value, `事项第 ${index + 1} 条`);
  exactMobileKeys(record, ["id", "category", "title", "dueAt", "estimatedMinutes", "status", "reminderAt", "relatedLabel", "completedAt"], `事项第 ${index + 1} 条`);
  if (record.category !== "教学" && record.category !== "学生" && record.category !== "行政" && record.category !== "论文") throw new Error(`事项第 ${index + 1} 条类别不正确。`);
  if (record.status !== "待开始" && record.status !== "进行中" && record.status !== "已完成") throw new Error(`事项第 ${index + 1} 条状态不正确。`);
  const relatedLabel = mobileOptionalString(record.relatedLabel, "事项关联", 300);
  const completedAt = mobileOptionalString(record.completedAt, "完成时间", 80);
  return {
    id: mobileString(record.id, "事项编号", 160),
    category: record.category,
    title: mobileString(record.title, "事项标题", 500),
    dueAt: mobileIso(record.dueAt, "事项截止时间"),
    estimatedMinutes: mobileNumber(record.estimatedMinutes, "预计用时", { min: 0, max: 10080 }),
    status: record.status,
    reminderAt: record.reminderAt === null ? null : mobileIso(record.reminderAt, "事项提醒时间"),
    ...(relatedLabel ? { relatedLabel } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

function rebuildMobileSummary(value: unknown): MobileReadOnlySnapshot["summary"] {
  const record = mobileFileRecord(value, "摘要");
  const keys = ["totalStudents", "studentsWithConfirmedAssessments", "rankImproved", "rankDeclined", "scoreImproved", "scoreDeclined", "issuesPending", "issuesWatching", "homeSchoolFollowUps", "openTasks", "openTaskMinutes", "lessonsOnDate", "averageLatestScoreRate"] as const;
  exactMobileKeys(record, keys, "摘要");
  const integer = (key: typeof keys[number]) => mobileNumber(record[key], `摘要.${key}`, { integer: true, min: 0, max: 100000 });
  return {
    totalStudents: integer("totalStudents"),
    studentsWithConfirmedAssessments: integer("studentsWithConfirmedAssessments"),
    rankImproved: integer("rankImproved"),
    rankDeclined: integer("rankDeclined"),
    scoreImproved: integer("scoreImproved"),
    scoreDeclined: integer("scoreDeclined"),
    issuesPending: integer("issuesPending"),
    issuesWatching: integer("issuesWatching"),
    homeSchoolFollowUps: integer("homeSchoolFollowUps"),
    openTasks: integer("openTasks"),
    openTaskMinutes: integer("openTaskMinutes"),
    lessonsOnDate: integer("lessonsOnDate"),
    averageLatestScoreRate: record.averageLatestScoreRate === null ? null : mobileNumber(record.averageLatestScoreRate, "平均得分率", { min: 0, max: 100 }),
  };
}

function rebuildMobileSnapshot(value: unknown): MobileReadOnlySnapshot {
  const record = mobileFileRecord(value, "手机看板");
  exactMobileKeys(record, ["snapshotVersion", "snapshotId", "readOnly", "generatedAt", "sourceRevision", "workbenchName", "accent", "summary", "priorityStudents", "upcomingLessons", "openTasks"], "手机看板");
  if (record.snapshotVersion !== 1 || record.readOnly !== true) throw new Error("手机看板版本或只读标记不正确。");
  if (record.accent !== "松柏绿" && record.accent !== "黛蓝" && record.accent !== "暖橙") throw new Error("手机看板配色不正确。");
  if (!Array.isArray(record.priorityStudents) || record.priorityStudents.length > 5) throw new Error("重点学生摘要最多只能包含 5 名。 ");
  if (!Array.isArray(record.upcomingLessons) || record.upcomingLessons.length > 5) throw new Error("课次摘要最多只能包含 5 节。 ");
  if (!Array.isArray(record.openTasks) || record.openTasks.length > 8) throw new Error("事项摘要最多只能包含 8 件。 ");
  return {
    snapshotVersion: 1,
    snapshotId: mobileString(record.snapshotId, "内容编号", 180),
    readOnly: true,
    generatedAt: mobileIso(record.generatedAt, "生成时间"),
    sourceRevision: mobileNumber(record.sourceRevision, "来源版本", { integer: true, min: 0 }),
    workbenchName: mobileString(record.workbenchName, "工作台名称", 200),
    accent: record.accent,
    summary: rebuildMobileSummary(record.summary),
    priorityStudents: record.priorityStudents.map(rebuildMobileStudent),
    upcomingLessons: record.upcomingLessons.map(rebuildMobileLesson),
    openTasks: record.openTasks.map(rebuildMobileTask),
  };
}

export function serializeMobileViewFile(snapshot: MobileReadOnlySnapshot, exportedAt: string): string {
  return JSON.stringify({
    kind: MOBILE_VIEW_FILE_KIND,
    fileVersion: MOBILE_VIEW_FILE_VERSION,
    exportedAt,
    snapshot: rebuildMobileSnapshot(snapshot),
  } satisfies MobileViewFileV1, null, 2);
}

export function parseMobileViewFile(text: string, current: MobileReadOnlySnapshot | null = null): MobileViewImportResult {
  if (new TextEncoder().encode(text).byteLength > MOBILE_VIEW_MAX_BYTES) throw new Error("手机查看文件超过 512KB，未导入。 ");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的手机查看文件。 ");
  }
  const record = mobileFileRecord(parsed, "手机查看文件");
  exactMobileKeys(record, ["kind", "fileVersion", "exportedAt", "snapshot"], "手机查看文件");
  if (record.kind !== MOBILE_VIEW_FILE_KIND) throw new Error("请选择由电脑工作台生成的手机查看文件。 ");
  if (record.fileVersion !== MOBILE_VIEW_FILE_VERSION) throw new Error("手机查看文件版本不受支持。 ");
  const envelope: MobileViewFileV1 = {
    kind: MOBILE_VIEW_FILE_KIND,
    fileVersion: MOBILE_VIEW_FILE_VERSION,
    exportedAt: mobileIso(record.exportedAt, "导出时间"),
    snapshot: rebuildMobileSnapshot(record.snapshot),
  };
  const warnings = current && envelope.snapshot.generatedAt < current.generatedAt
    ? ["这个文件比手机当前内容更早，导入后会显示较旧的摘要。"]
    : [];
  return { envelope, warnings };
}

export function saveImportedMobileView(storage: StorageLike, snapshot: MobileReadOnlySnapshot): { ok: true } | { ok: false; message: string } {
  try {
    storage.setItem(MOBILE_VIEW_STORAGE_KEY, serializeMobileViewFile(snapshot, snapshot.generatedAt));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `手机内容保存失败：${error.message}` : "手机内容保存失败。" };
  }
}

export function loadImportedMobileView(storage: StorageLike): { snapshot: MobileReadOnlySnapshot | null; warning?: string } {
  const text = storage.getItem(MOBILE_VIEW_STORAGE_KEY);
  if (!text) return { snapshot: null };
  try {
    return { snapshot: parseMobileViewFile(text).envelope.snapshot };
  } catch (error) {
    return { snapshot: null, warning: error instanceof Error ? error.message : "手机内容无法读取，请重新导入。" };
  }
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
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 folding by UTF-8 octets; continuation whitespace counts. */
export function foldIcsLineUtf8(line: string, maxOctets = 75): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).byteLength <= maxOctets) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    if (current && currentBytes + characterBytes > maxOctets) {
      parts.push(current);
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

function addLocalDate(dateString: string, amount: number): string {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function getCalendarLessonRange(data: WorkbenchData, now: string): { fromDate: string; toDate: string } {
  const localDate = getDeviceLocalDate(now, data.user.timeZone);
  const rescheduledDates = (data.lessonExceptions ?? []).flatMap((exception) =>
    exception.action === "reschedule" && exception.newDate && isValidDate(exception.newDate)
      ? [exception.newDate]
      : [],
  );
  const starts = [
    ...data.lessons.map((lesson) => lesson.startsAt.slice(0, 10)),
    ...(data.lessonTemplates ?? []).map((template) => template.semesterStart),
    ...rescheduledDates,
  ].filter(Boolean);
  const ends = [
    ...data.lessons.map((lesson) => lesson.startsAt.slice(0, 10)),
    ...(data.lessonTemplates ?? []).map((template) => template.semesterEnd),
    ...rescheduledDates,
  ].filter(Boolean);
  return {
    fromDate: starts.length ? starts.sort()[0] : localDate,
    toDate: ends.length ? ends.sort().at(-1)! : addLocalDate(localDate, 180),
  };
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
  const range = getCalendarLessonRange(data, now);
  const effectiveLessons = expandLessonsForRange(data, range.fromDate, range.toDate, now);

  for (const lesson of effectiveLessons) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${lesson.id}@teacher-workbench`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SEQUENCE:${data.meta.revision}`);
    lines.push(`LAST-MODIFIED:${stamp}`);
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
    const start = new Date(due.getTime() - Math.max(15, task.estimatedMinutes) * 60_000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${task.id}@teacher-workbench`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SEQUENCE:${data.meta.revision}`);
    lines.push(`LAST-MODIFIED:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(start.toISOString())}`);
    lines.push(`DTEND:${toIcsUtc(task.dueAt)}`);
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
  return lines.map((line) => foldIcsLineUtf8(line)).join("\r\n") + "\r\n";
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
  const localDate = getDeviceLocalDate(nowIso, data.user.timeZone);
  const lessonReminderMinutes = [
    ...data.lessons.map((lesson) => lesson.reminderMinutesBefore),
    ...(data.lessonTemplates ?? []).map((template) => template.reminderMinutesBefore),
  ].filter((minutes): minutes is number => typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0);
  const maxReminderMinutes = Math.min(
    MAX_LESSON_REMINDER_MINUTES,
    Math.max(0, ...lessonReminderMinutes),
  );
  const lookAheadDays = Math.max(1, Math.ceil(maxReminderMinutes / (24 * 60)));
  const effectiveLessons = expandLessonsForRange(
    data,
    addLocalDate(localDate, -1),
    addLocalDate(localDate, lookAheadDays),
    nowIso,
  );

  for (const lesson of effectiveLessons) {
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
 * Converts captured notes into pending workbench tasks. Notes captured after
 * 18:00 are due the next day, and none touch the workspace until the teacher
 * confirms the import on the computer.
 */
export function inboxToTasks(items: readonly InboxItem[], now: string, timeZone = "Asia/Shanghai"): Array<Omit<WorkbenchTask, "id"> & { sourceInboxId: string }> {
  const today = getDeviceLocalDate(now, timeZone);
  const todayDue = `${today}T18:00:00+08:00`;
  const dueDate = new Date(now).getTime() >= new Date(todayDue).getTime() ? addLocalDate(today, 1) : today;
  return items.map((item) => ({
    sourceInboxId: item.id,
    category: item.category,
    title: item.text,
    dueAt: `${dueDate}T18:00:00+08:00`,
    estimatedMinutes: 10,
    status: "待开始",
    reminderAt: null,
    relatedLabel: "手机速记",
  }));
}
