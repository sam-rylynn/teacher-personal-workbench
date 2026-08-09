/**
 * Teacher Workbench device-local data model.
 *
 * This module deliberately has no React or server dependency. All domain
 * calculations are pure, and browser storage is resolved only inside the
 * load/save helpers so importing the file remains safe during SSR.
 */

export const WORKBENCH_SCHEMA_VERSION = 1 as const;
export const WORKBENCH_STORAGE_KIND = "device-local" as const;
export const WORKBENCH_STORAGE_KEY =
  `teacher-workbench:${WORKBENCH_STORAGE_KIND}:v${WORKBENCH_SCHEMA_VERSION}` as const;
export const LEGACY_WORKBENCH_STORAGE_KEYS = [
  "teacher-workbench:device-local:v0",
  "teacher-workbench:data",
] as const;
export const WORKBENCH_BACKUP_KEY =
  `teacher-workbench:${WORKBENCH_STORAGE_KIND}:v${WORKBENCH_SCHEMA_VERSION}:backups` as const;
export const WORKBENCH_BACKUP_LIMIT = 3 as const;
export const MAX_LESSON_REMINDER_MINUTES = 7 * 24 * 60;

export type SchoolStage = "小学" | "初中" | "高中" | "教培";
export type AssessmentStatus = "已核对" | "待核对";
export type AssessmentSource = "手工录入" | "表格导入" | "图片识别";
export type StudentIssueStatus = "待处理" | "观察中" | "已缓解";
export type TaskCategory = "教学" | "学生" | "行政" | "论文";
export type TaskStatus = "待开始" | "进行中" | "已完成";
export type ResourceKind = "教案" | "课件" | "练习" | "模板" | "参考资料";
export type HomeSchoolRating = 0 | 1 | 2 | 3 | 4 | 5;

export interface AssessmentRecord {
  id: string;
  title: string;
  subject: string;
  occurredOn: string;
  maxScore: number;
  score: number;
  rank: number;
  cohortSize: number;
  classAverage: number;
  status: AssessmentStatus;
  source: AssessmentSource;
  verifiedAt?: string;
}

export interface StudentIssue {
  id: string;
  title: string;
  detail: string;
  observedOn: string;
  status: StudentIssueStatus;
  nextAction: string;
  followUpOn?: string;
}

/**
 * Communication difficulty runs from 1 (easy) to 5 (currently difficult).
 * Support willingness runs from 1 (no current action) to 5 (proactive).
 */
export interface HomeSchoolProfile {
  /** 0 means the teacher has not made a selection yet. */
  communicationDifficulty: HomeSchoolRating;
  communicationNote: string;
  /** 0 means the teacher has not made a selection yet. */
  supportWillingness: HomeSchoolRating;
  supportNote: string;
  updatedAt: string;
}

export interface StudentRecord {
  id: string;
  name: string;
  className: string;
  initials: string;
  color: string;
  assessments: AssessmentRecord[];
  recentIssue: StudentIssue | null;
  homeSchool: HomeSchoolProfile;
}

export interface LessonSession {
  id: string;
  title: string;
  subject: string;
  className: string;
  startsAt: string;
  endsAt: string;
  room: string;
  preparation: string;
  status: "待上课" | "已完成" | "已取消";
  reminderMinutesBefore: number | null;
}

/** 学期循环课次模板：每周固定某天的同一时段。weekday 1=周一 … 7=周日。 */
export interface LessonTemplate {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  className: string;
  room: string;
  preparation: string;
  reminderMinutesBefore: number | null;
  semesterStart: string;
  semesterEnd: string;
}

/** 例外规则：某一天的模板课次被取消或调整到别的时间/地点/日期。 */
export type LessonException =
  | { id: string; templateId: string; date: string; action: "cancel" }
  | {
      id: string;
      templateId: string;
      date: string;
      action: "reschedule";
      newDate?: string;
      newStartTime?: string;
      newEndTime?: string;
      newRoom?: string;
    };

export interface WorkbenchTask {
  id: string;
  category: TaskCategory;
  title: string;
  dueAt: string;
  estimatedMinutes: number;
  status: TaskStatus;
  reminderAt: string | null;
  relatedLabel?: string;
  completedAt?: string;
}

export interface WorkbenchResource {
  id: string;
  title: string;
  kind: ResourceKind;
  subject: string;
  gradeOrClass: string;
  location: string;
  updatedAt: string;
}

export interface UserConfiguration {
  workbenchName: string;
  teacherName: string;
  roleLabel: string;
  schoolStage: SchoolStage;
  subjects: string[];
  timeZone: string;
  locale: "zh-CN";
  weekStartsOn: 1;
  appearance: {
    accent: "松柏绿" | "黛蓝" | "暖橙";
    avatarMark: string;
  };
}

export interface MobileStudentSummary {
  id: string;
  name: string;
  className: string;
  latestScore: number | null;
  latestMaxScore: number | null;
  currentRank: number | null;
  cohortSize: number | null;
  scoreDelta: number | null;
  rankDelta: number | null;
  issueTitle: string | null;
  issueStatus: StudentIssueStatus | null;
}

export interface MobileReadOnlySnapshot {
  snapshotVersion: 1;
  snapshotId: string;
  readOnly: true;
  generatedAt: string;
  sourceRevision: number;
  workbenchName: string;
  accent: "松柏绿" | "黛蓝" | "暖橙";
  summary: WorkbenchSummary;
  priorityStudents: MobileStudentSummary[];
  upcomingLessons: LessonSession[];
  openTasks: WorkbenchTask[];
}

export interface WorkbenchDataV1 {
  schemaVersion: 1;
  storageKind: "device-local";
  meta: {
    revision: number;
    createdAt: string;
    updatedAt: string;
    containsDemoData: boolean;
  };
  user: UserConfiguration;
  students: StudentRecord[];
  lessons: LessonSession[];
  tasks: WorkbenchTask[];
  resources: WorkbenchResource[];
  lessonTemplates?: LessonTemplate[];
  lessonExceptions?: LessonException[];
  mobileSnapshot: MobileReadOnlySnapshot | null;
}

export type WorkbenchData = WorkbenchDataV1;

export interface AssessmentChange {
  subject: string | null;
  latest: AssessmentRecord | null;
  previous: AssessmentRecord | null;
  scoreDelta: number | null;
  scoreRateDelta: number | null;
  /** Positive means the rank improved; negative means it declined. */
  rankDelta: number | null;
}

export interface WorkbenchSummary {
  totalStudents: number;
  studentsWithConfirmedAssessments: number;
  rankImproved: number;
  rankDeclined: number;
  scoreImproved: number;
  scoreDeclined: number;
  issuesPending: number;
  issuesWatching: number;
  homeSchoolFollowUps: number;
  openTasks: number;
  openTaskMinutes: number;
  lessonsOnDate: number;
  averageLatestScoreRate: number | null;
}

export type StudentPriorityReason =
  | "近期问题待处理"
  | "排名下降"
  | "排名上升"
  | "成绩下降"
  | "家长沟通需跟进"
  | "家庭辅助尚未行动"
  | "近期问题观察中";

export interface StudentPriority {
  student: StudentRecord;
  priorityScore: number;
  reasons: StudentPriorityReason[];
  progress: AssessmentChange;
}

export interface TaskDurationSummary {
  totalMinutes: number;
  openMinutes: number;
  completedMinutes: number;
  openTaskCount: number;
  byCategory: Record<TaskCategory, number>;
}

export interface WorkbenchWriteContext {
  device: "desktop" | "mobile";
  surface: "workspace" | "mobile-snapshot";
}

export type WorkbenchWriteGuard =
  | { allowed: true }
  | {
      allowed: false;
      code: "MOBILE_READ_ONLY" | "SNAPSHOT_READ_ONLY";
      message: string;
    };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface StoredWorkbenchEnvelopeV1 {
  schemaVersion: 1;
  storageKind: "device-local";
  savedAt: string;
  data: WorkbenchDataV1;
}

export interface WorkbenchHydrationResult {
  data: WorkbenchData;
  source: "stored" | "migrated" | "seed";
  migratedFrom: number | null;
  warnings: string[];
}

export type DeviceLocalLoadResult = WorkbenchHydrationResult & {
  storageAvailable: boolean;
  storageKey: string;
};

export type DeviceLocalSaveResult =
  | { ok: true; storageKey: string; savedAt: string }
  | {
      ok: false;
      storageKey: string;
      reason: "storage-unavailable" | "read-only" | "storage-error";
      message: string;
    };

export interface WorkbenchBackupEntry {
  savedAt: string;
  revision: number;
  payload: string;
}

export const DESKTOP_DEVICE_LOCAL_ACCESS: WorkbenchWriteContext = {
  device: "desktop",
  surface: "workspace",
};

export const MOBILE_READ_ONLY_ACCESS: WorkbenchWriteContext = {
  device: "mobile",
  surface: "mobile-snapshot",
};

export const COMMUNICATION_DIFFICULTY_LABELS = [
  "未设置",
  "畅通",
  "可沟通",
  "需解释",
  "需多次跟进",
  "暂难推进",
] as const;

export const SUPPORT_WILLINGNESS_LABELS = [
  "未设置",
  "暂无行动",
  "偶有行动",
  "提醒后配合",
  "稳定配合",
  "主动共促",
] as const;

const SEED_CREATED_AT = "2026-09-16T07:30:00+08:00";
const SEED_UPDATED_AT = "2026-09-16T15:40:00+08:00";
const SEED_LOCAL_DATE = "2026-09-16";

const assessmentTitles = ["开学测", "单元一", "单元二", "阶段测"] as const;
const assessmentDates = ["2026-09-02", "2026-09-05", "2026-09-10", "2026-09-15"] as const;

function createSeedAssessments(
  studentId: string,
  scores: readonly [number, number, number, number],
  ranks: readonly [number, number, number, number],
  cohortSize: number,
  classAverage: number,
): AssessmentRecord[] {
  return assessmentTitles.map((title, index) => ({
    id: `${studentId}-A${index + 1}`,
    title,
    subject: "语文",
    occurredOn: assessmentDates[index],
    maxScore: 100,
    score: scores[index],
    rank: ranks[index],
    cohortSize,
    classAverage,
    status: "已核对",
    source: index === 0 ? "表格导入" : "手工录入",
    verifiedAt: `${assessmentDates[index]}T18:00:00+08:00`,
  }));
}

/** Extra single-subject demo records so the detail page shows per-subject trends. */
function createSubjectAssessments(
  studentId: string,
  subject: string,
  entries: readonly (readonly [number, number, number?])[],
  cohortSize: number,
  classAverage: number,
): AssessmentRecord[] {
  const dates = ["2026-09-06", "2026-09-13"] as const;
  return entries.map(([score, rank, maxScore], index) => ({
    id: `${studentId}-${subject}${index + 1}`,
    title: index === 0 ? "单元一" : "单元二",
    subject,
    occurredOn: dates[index],
    maxScore: maxScore ?? 100,
    score,
    rank,
    cohortSize,
    classAverage,
    status: "已核对" as const,
    source: "手工录入" as const,
    verifiedAt: `${dates[index]}T18:00:00+08:00`,
  }));
}

function createSeedStudents(): StudentRecord[] {
  return [
    {
      id: "S08403",
      name: "李明澈",
      className: "八年级4班",
      initials: "明澈",
      color: "sage",
      assessments: [...createSeedAssessments("S08403", [79, 81, 82, 85], [19, 17, 14, 10], 43, 79), ...createSubjectAssessments("S08403", "数学", [[85, 12], [88, 9]], 43, 80), ...createSubjectAssessments("S08403", "英语", [[72, 25], [74, 22]], 43, 76)],
      recentIssue: {
        id: "I08403",
        title: "文本依据仍不充分",
        detail: "解释动作描写的情感作用时，答案缺少对应原句。",
        observedOn: "2026-09-15",
        status: "观察中",
        nextAction: "课堂比较任务中再次核对是否能先标原句再作答。",
        followUpOn: "2026-09-17",
      },
      homeSchool: {
        communicationDifficulty: 2,
        communicationNote: "最近2次沟通均在次日之前完成确认。",
        supportWillingness: 5,
        supportNote: "愿意配合使用同类文本做一次对照练习。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08412",
      name: "赵清禾",
      className: "八年级4班",
      initials: "清禾",
      color: "apricot",
      assessments: [...createSeedAssessments("S08412", [78, 82, 83, 81], [22, 17, 15, 19], 43, 79), ...createSubjectAssessments("S08412", "数学", [[80, 18], [78, 21]], 43, 80), ...createSubjectAssessments("S08412", "英语", [[83, 14], [85, 12]], 43, 76)],
      recentIssue: {
        id: "I08412",
        title: "补学清单还剩1项",
        detail: "请假课次的阅读题尚未完成核对。",
        observedOn: "2026-09-16",
        status: "待处理",
        nextAction: "完成阅读题后，由老师核对关键步骤。",
        followUpOn: "2026-09-17",
      },
      homeSchool: {
        communicationDifficulty: 1,
        communicationNote: "请假与补学安排一次沟通即确认。",
        supportWillingness: 4,
        supportNote: "已按清单提醒并协助确认其中2项。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08207",
      name: "陈屿安",
      className: "八年级2班",
      initials: "屿安",
      color: "blue",
      assessments: [...createSeedAssessments("S08207", [78, 81, 84, 87], [21, 17, 12, 9], 44, 80), ...createSubjectAssessments("S08207", "数学", [[84, 13], [87, 8]], 44, 81), ...createSubjectAssessments("S08207", "英语", [[79, 20], [81, 17]], 44, 77)],
      recentIssue: {
        id: "I08207",
        title: "修改理由尚未写明",
        detail: "修改课堂回答后，没有说明两版答案的差异。",
        observedOn: "2026-09-15",
        status: "观察中",
        nextAction: "课堂复盘两版答案并补写一句修改理由。",
        followUpOn: "2026-09-17",
      },
      homeSchool: {
        communicationDifficulty: 2,
        communicationNote: "最近3次消息均在24小时内收到回复。",
        supportWillingness: 4,
        supportNote: "已确认课后5分钟比较两版答案的安排。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08219",
      name: "周雨桐",
      className: "八年级2班",
      initials: "雨桐",
      color: "rose",
      assessments: [...createSeedAssessments("S08219", [86, 88, 90, 92], [8, 6, 4, 3], 44, 80), ...createSubjectAssessments("S08219", "数学", [[90, 5], [93, 2]], 44, 81), ...createSubjectAssessments("S08219", "英语", [[88, 7], [90, 5]], 44, 77)],
      recentIssue: {
        id: "I08219",
        title: "写作第二稿尚未提交",
        detail: "叙事写作第一稿已反馈，第二稿还未收到。",
        observedOn: "2026-09-16",
        status: "待处理",
        nextAction: "按3项修改清单完成第二稿。",
        followUpOn: "2026-09-17",
      },
      homeSchool: {
        communicationDifficulty: 1,
        communicationNote: "最近一次写作反馈在当日完成确认。",
        supportWillingness: 4,
        supportNote: "已协助确认第二稿提交日期。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08231",
      name: "方知夏",
      className: "八年级2班",
      initials: "知夏",
      color: "violet",
      assessments: [...createSeedAssessments("S08231", [80, 78, 74, 69], [21, 23, 26, 30], 44, 80), ...createSubjectAssessments("S08231", "数学", [[74, 24], [71, 27]], 44, 81), ...createSubjectAssessments("S08231", "英语", [[77, 22], [75, 24]], 44, 77)],
      recentIssue: {
        id: "I08231",
        title: "阅读问题单尚未补写",
        detail: "阅读问题单第3题目前为空。",
        observedOn: "2026-09-16",
        status: "待处理",
        nextAction: "下节课开始前核对补写结果。",
        followUpOn: "2026-09-17",
      },
      homeSchool: {
        communicationDifficulty: 3,
        communicationNote: "最近一次沟通经1次提醒后完成确认。",
        supportWillingness: 3,
        supportNote: "已知晓补写安排，当前尚未确认完成。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08427",
      name: "孙予宁",
      className: "八年级4班",
      initials: "予宁",
      color: "teal",
      assessments: [...createSeedAssessments("S08427", [83, 85, 87, 89], [13, 10, 7, 5], 43, 79), ...createSubjectAssessments("S08427", "数学", [[86, 10], [89, 6]], 43, 80), ...createSubjectAssessments("S08427", "英语", [[84, 13], [86, 11]], 43, 76)],
      recentIssue: {
        id: "I08427",
        title: "朗读停顿位置需复核",
        detail: "录音中有两处停顿与标点位置不一致。",
        observedOn: "2026-09-15",
        status: "观察中",
        nextAction: "第二版录音提交后复核对应时间点。",
        followUpOn: "2026-09-18",
      },
      homeSchool: {
        communicationDifficulty: 2,
        communicationNote: "朗读反馈在当日晚间完成确认。",
        supportWillingness: 3,
        supportNote: "已提醒查看两处时间标记，第二版待上传。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08605",
      name: "王星野",
      className: "八年级6班",
      initials: "星野",
      color: "gold",
      assessments: [...createSeedAssessments("S08605", [84, 86, 88, 91], [12, 10, 7, 4], 42, 78), ...createSubjectAssessments("S08605", "数学", [[88, 8], [91, 4]], 42, 79), ...createSubjectAssessments("S08605", "英语", [[82, 16], [84, 14]], 42, 75)],
      recentIssue: {
        id: "I08605",
        title: "材料来源尚未补全",
        detail: "论据卡中的两项材料没有注明书名或文章名。",
        observedOn: "2026-09-16",
        status: "待处理",
        nextAction: "核对并补充两项材料来源。",
        followUpOn: "2026-09-18",
      },
      homeSchool: {
        communicationDifficulty: 4,
        communicationNote: "家庭联系时段与学校窗口不重合，通常需预约晚间沟通。",
        supportWillingness: 3,
        supportNote: "已确认补充来源要求，尚未反馈完成情况。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
    {
      id: "S08616",
      name: "郑书言",
      className: "八年级6班",
      initials: "书言",
      color: "coral",
      assessments: [...createSeedAssessments("S08616", [71, 73, 75, 78], [34, 31, 28, 24], 42, 78), ...createSubjectAssessments("S08616", "数学", [[68, 33], [71, 30]], 42, 79), ...createSubjectAssessments("S08616", "英语", [[70, 31], [88, 28, 120]], 42, 75)],
      recentIssue: {
        id: "I08616",
        title: "论据与观点关系不直接",
        detail: "写作提纲中的一个事例无法直接支撑中心观点。",
        observedOn: "2026-09-15",
        status: "观察中",
        nextAction: "替换论据后核对与观点的对应关系。",
        followUpOn: "2026-09-17",
      },
      homeSchool: {
        communicationDifficulty: 2,
        communicationNote: "最近一次写作反馈在24小时内确认。",
        supportWillingness: 5,
        supportNote: "愿意共同核对替换论据的完成情况。",
        updatedAt: SEED_UPDATED_AT,
      },
    },
  ];
}

function createSeedLessons(): LessonSession[] {
  return [
    {
      id: "L-20260916-01",
      title: "《背影》动作描写与情感",
      subject: "语文",
      className: "八年级4班",
      startsAt: "2026-09-16T08:00:00+08:00",
      endsAt: "2026-09-16T08:45:00+08:00",
      room: "教学楼 302",
      preparation: "课件、动作描写对照片段、随堂问题单",
      status: "已完成",
      reminderMinutesBefore: 10,
    },
    {
      id: "L-20260916-02",
      title: "叙事写作：如何选择关键细节",
      subject: "语文",
      className: "八年级2班",
      startsAt: "2026-09-16T10:10:00+08:00",
      endsAt: "2026-09-16T10:55:00+08:00",
      room: "教学楼 205",
      preparation: "两份学生习作、修改清单",
      status: "已完成",
      reminderMinutesBefore: 10,
    },
    {
      id: "L-20260916-03",
      title: "班会：运动会岗位确认",
      subject: "班会",
      className: "八年级4班",
      startsAt: "2026-09-16T15:50:00+08:00",
      endsAt: "2026-09-16T16:35:00+08:00",
      room: "八年级4班教室",
      preparation: "岗位表、报名补充单、两项待确认名单",
      status: "待上课",
      reminderMinutesBefore: 15,
    },
    {
      id: "L-20260917-01",
      title: "说明文阅读：筛选关键信息",
      subject: "语文",
      className: "八年级6班",
      startsAt: "2026-09-17T08:55:00+08:00",
      endsAt: "2026-09-17T09:40:00+08:00",
      room: "教学楼 401",
      preparation: "阅读材料、信息筛选表",
      status: "待上课",
      reminderMinutesBefore: 10,
    },
    {
      id: "L-20260917-02",
      title: "《背影》语言赏析练习",
      subject: "语文",
      className: "八年级4班",
      startsAt: "2026-09-17T14:00:00+08:00",
      endsAt: "2026-09-17T14:45:00+08:00",
      room: "教学楼 302",
      preparation: "随堂练习、答案对照表",
      status: "待上课",
      reminderMinutesBefore: 10,
    },
  ];
}

function createSeedTasks(): WorkbenchTask[] {
  return [
    {
      id: "T001",
      category: "教学",
      title: "完成八4班会岗位表最后核对",
      dueAt: "2026-09-16T15:20:00+08:00",
      estimatedMinutes: 20,
      status: "进行中",
      reminderAt: "2026-09-16T14:50:00+08:00",
      relatedLabel: "八年级4班",
    },
    {
      id: "T002",
      category: "教学",
      title: "批改八2阅读问题单并记录共性问题",
      dueAt: "2026-09-17T17:00:00+08:00",
      estimatedMinutes: 50,
      status: "进行中",
      reminderAt: "2026-09-17T15:30:00+08:00",
      relatedLabel: "八年级2班",
    },
    {
      id: "T003",
      category: "行政",
      title: "汇总八4运动会报名及志愿岗位",
      dueAt: "2026-09-17T16:00:00+08:00",
      estimatedMinutes: 20,
      status: "待开始",
      reminderAt: "2026-09-17T14:30:00+08:00",
      relatedLabel: "八年级4班",
    },
    {
      id: "T004",
      category: "学生",
      title: "核对赵清禾补学清单剩余阅读题",
      dueAt: "2026-09-17T12:00:00+08:00",
      estimatedMinutes: 10,
      status: "待开始",
      reminderAt: "2026-09-17T11:20:00+08:00",
      relatedLabel: "赵清禾",
    },
    {
      id: "T005",
      category: "学生",
      title: "查看郑书言替换后的论据是否支持观点",
      dueAt: "2026-09-17T18:00:00+08:00",
      estimatedMinutes: 10,
      status: "待开始",
      reminderAt: "2026-09-17T17:20:00+08:00",
      relatedLabel: "郑书言",
    },
    {
      id: "T006",
      category: "论文",
      title: "整理课堂提问记录的研究笔记",
      dueAt: "2026-09-20T20:00:00+08:00",
      estimatedMinutes: 35,
      status: "待开始",
      reminderAt: "2026-09-20T19:00:00+08:00",
      relatedLabel: "论文笔记",
    },
    {
      id: "T007",
      category: "行政",
      title: "提交教研组周计划",
      dueAt: "2026-09-16T12:00:00+08:00",
      estimatedMinutes: 15,
      status: "已完成",
      reminderAt: null,
      relatedLabel: "语文教研组",
      completedAt: "2026-09-16T11:36:00+08:00",
    },
  ];
}

function createSeedResources(): WorkbenchResource[] {
  return [
    {
      id: "R001",
      title: "《背影》动作描写课堂课件",
      kind: "课件",
      subject: "语文",
      gradeOrClass: "八年级",
      location: "资料/八年级/阅读教学",
      updatedAt: "2026-09-15T21:10:00+08:00",
    },
    {
      id: "R002",
      title: "叙事写作第二稿修改清单",
      kind: "模板",
      subject: "语文",
      gradeOrClass: "八年级2班",
      location: "资料/八年级2班/写作",
      updatedAt: "2026-09-16T09:20:00+08:00",
    },
    {
      id: "R003",
      title: "单元二阅读问题单",
      kind: "练习",
      subject: "语文",
      gradeOrClass: "八年级",
      location: "资料/八年级/单元二",
      updatedAt: "2026-09-14T18:40:00+08:00",
    },
    {
      id: "R004",
      title: "班会岗位确认流程",
      kind: "教案",
      subject: "班会",
      gradeOrClass: "八年级4班",
      location: "资料/班主任/班会",
      updatedAt: "2026-09-16T13:10:00+08:00",
    },
    {
      id: "R005",
      title: "课堂提问记录编码说明",
      kind: "参考资料",
      subject: "教学研究",
      gradeOrClass: "个人研究",
      location: "资料/个人研究/课堂提问",
      updatedAt: "2026-09-13T16:30:00+08:00",
    },
  ];
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

function isValidInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(new Date(value).getTime());
}

function isValidClock(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidTimeZone(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function hasUniqueIds(values: readonly unknown[]): boolean {
  const ids = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || !isNonEmptyString(value.id) || ids.has(value.id)) return false;
    ids.add(value.id);
  }
  return true;
}

function isHomeSchoolRating(value: unknown): value is HomeSchoolRating {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 5;
}

function isAssessmentStatus(value: unknown): value is AssessmentStatus {
  return value === "已核对" || value === "待核对";
}

function isStudentIssueStatus(value: unknown): value is StudentIssueStatus {
  return value === "待处理" || value === "观察中" || value === "已缓解";
}

function isLessonStatus(value: unknown): value is LessonSession["status"] {
  return value === "待上课" || value === "已完成" || value === "已取消";
}

function isAssessmentRecordShape(value: unknown): value is AssessmentRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.subject) &&
    isValidCalendarDate(value.occurredOn) &&
    isFiniteNumber(value.maxScore) && value.maxScore > 0 &&
    isFiniteNumber(value.score) && value.score >= 0 && value.score <= value.maxScore &&
    Number.isInteger(value.rank) && Number(value.rank) >= 1 &&
    Number.isInteger(value.cohortSize) && Number(value.cohortSize) >= Number(value.rank) &&
    isFiniteNumber(value.classAverage) && value.classAverage >= 0 && value.classAverage <= value.maxScore &&
    isAssessmentStatus(value.status) &&
    (value.source === undefined || isAssessmentSource(value.source)) &&
    (value.verifiedAt === undefined || isValidInstant(value.verifiedAt))
  );
}

function isStudentIssueShape(value: unknown): value is StudentIssue {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.detail === "string" &&
    isNonEmptyString(value.observedOn) &&
    isStudentIssueStatus(value.status) &&
    typeof value.nextAction === "string" &&
    (value.followUpOn === undefined || typeof value.followUpOn === "string")
  );
}

function isHomeSchoolProfileShape(value: unknown): value is HomeSchoolProfile {
  if (!isRecord(value)) return false;
  return (
    isHomeSchoolRating(value.communicationDifficulty) &&
    typeof value.communicationNote === "string" &&
    isHomeSchoolRating(value.supportWillingness) &&
    typeof value.supportNote === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isStudentRecordShape(value: unknown): value is StudentRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.className) &&
    typeof value.initials === "string" &&
    typeof value.color === "string" &&
    Array.isArray(value.assessments) && hasUniqueIds(value.assessments) && value.assessments.every(isAssessmentRecordShape) &&
    (value.recentIssue === null || isStudentIssueShape(value.recentIssue)) &&
    isHomeSchoolProfileShape(value.homeSchool)
  );
}

function isLessonSessionShape(value: unknown): value is LessonSession {
  if (!isRecord(value)) return false;
  const startsAt = isValidInstant(value.startsAt) ? new Date(value.startsAt).getTime() : Number.NaN;
  const endsAt = isValidInstant(value.endsAt) ? new Date(value.endsAt).getTime() : Number.NaN;
  return (
    isNonEmptyString(value.id) && isNonEmptyString(value.title) &&
    isNonEmptyString(value.subject) && isNonEmptyString(value.className) &&
    Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt &&
    typeof value.room === "string" && typeof value.preparation === "string" &&
    isLessonStatus(value.status) &&
    (value.reminderMinutesBefore === undefined || value.reminderMinutesBefore === null ||
      (Number.isInteger(value.reminderMinutesBefore) && Number(value.reminderMinutesBefore) >= 1 && Number(value.reminderMinutesBefore) <= MAX_LESSON_REMINDER_MINUTES))
  );
}

function isLessonTemplateShape(value: unknown): value is LessonTemplate {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    Number.isInteger(value.weekday) && Number(value.weekday) >= 1 && Number(value.weekday) <= 7 &&
    isValidClock(value.startTime) && isValidClock(value.endTime) && value.endTime > value.startTime &&
    isNonEmptyString(value.title) && isNonEmptyString(value.subject) &&
    isNonEmptyString(value.className) && typeof value.room === "string" &&
    typeof value.preparation === "string" &&
    (value.reminderMinutesBefore === null ||
      (Number.isInteger(value.reminderMinutesBefore) && Number(value.reminderMinutesBefore) >= 1 && Number(value.reminderMinutesBefore) <= MAX_LESSON_REMINDER_MINUTES)) &&
    isValidCalendarDate(value.semesterStart) && isValidCalendarDate(value.semesterEnd) && value.semesterEnd >= value.semesterStart
  );
}

function isLessonExceptionShape(value: unknown): value is LessonException {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.templateId) || !isValidCalendarDate(value.date)) {
    return false;
  }
  if (value.action === "cancel") return true;
  const hasStart = value.newStartTime !== undefined;
  const hasEnd = value.newEndTime !== undefined;
  if (hasStart !== hasEnd) return false;
  if (hasStart && (!isValidClock(value.newStartTime) || !isValidClock(value.newEndTime) || value.newEndTime <= value.newStartTime)) {
    return false;
  }
  return (
    value.action === "reschedule" &&
    (value.newDate === undefined || isValidCalendarDate(value.newDate)) &&
    (value.newRoom === undefined || typeof value.newRoom === "string") &&
    (value.newDate !== undefined || hasStart || value.newRoom !== undefined)
  );
}

function isTaskShape(value: unknown): value is WorkbenchTask {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) && isTaskCategory(value.category) &&
    isNonEmptyString(value.title) && isNonEmptyString(value.dueAt) &&
    isFiniteNumber(value.estimatedMinutes) && value.estimatedMinutes >= 0 &&
    isTaskStatus(value.status) &&
    (value.reminderAt === undefined || value.reminderAt === null || typeof value.reminderAt === "string") &&
    (value.relatedLabel === undefined || typeof value.relatedLabel === "string") &&
    (value.completedAt === undefined || typeof value.completedAt === "string")
  );
}

function isResourceShape(value: unknown): value is WorkbenchResource {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) && isNonEmptyString(value.title) &&
    (value.kind === "教案" || value.kind === "课件" || value.kind === "练习" || value.kind === "模板" || value.kind === "参考资料") &&
    typeof value.subject === "string" && typeof value.gradeOrClass === "string" &&
    typeof value.location === "string" && typeof value.updatedAt === "string"
  );
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isWorkbenchSummaryShape(value: unknown): value is WorkbenchSummary {
  if (!isRecord(value)) return false;
  const integerKeys: Array<keyof WorkbenchSummary> = [
    "totalStudents",
    "studentsWithConfirmedAssessments",
    "rankImproved",
    "rankDeclined",
    "scoreImproved",
    "scoreDeclined",
    "issuesPending",
    "issuesWatching",
    "homeSchoolFollowUps",
    "openTasks",
    "openTaskMinutes",
    "lessonsOnDate",
  ];
  return (
    integerKeys.every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0) &&
    isNullableFiniteNumber(value.averageLatestScoreRate)
  );
}

function isMobileStudentSummaryShape(value: unknown): value is MobileStudentSummary {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) && isNonEmptyString(value.name) && isNonEmptyString(value.className) &&
    isNullableFiniteNumber(value.latestScore) && isNullableFiniteNumber(value.latestMaxScore) &&
    isNullableFiniteNumber(value.currentRank) && isNullableFiniteNumber(value.cohortSize) &&
    isNullableFiniteNumber(value.scoreDelta) && isNullableFiniteNumber(value.rankDelta) &&
    (value.issueTitle === null || typeof value.issueTitle === "string") &&
    (value.issueStatus === null || isStudentIssueStatus(value.issueStatus))
  );
}

function isUserConfigurationShape(value: unknown): value is UserConfiguration {
  if (!isRecord(value) || !isRecord(value.appearance)) return false;
  return (
    isNonEmptyString(value.workbenchName) && isNonEmptyString(value.teacherName) &&
    typeof value.roleLabel === "string" &&
    (value.schoolStage === "小学" || value.schoolStage === "初中" || value.schoolStage === "高中" || value.schoolStage === "教培") &&
    Array.isArray(value.subjects) && value.subjects.every((subject) => typeof subject === "string") &&
    isValidTimeZone(value.timeZone) && value.locale === "zh-CN" && value.weekStartsOn === 1 &&
    (value.appearance.accent === "松柏绿" || value.appearance.accent === "黛蓝" || value.appearance.accent === "暖橙") &&
    typeof value.appearance.avatarMark === "string"
  );
}

function isMobileSnapshotShape(value: unknown): value is MobileReadOnlySnapshot {
  if (!isRecord(value)) return false;
  return (
    value.snapshotVersion === 1 && value.readOnly === true &&
    isNonEmptyString(value.snapshotId) && isNonEmptyString(value.generatedAt) &&
    Number.isInteger(value.sourceRevision) && Number(value.sourceRevision) >= 0 && isNonEmptyString(value.workbenchName) &&
    (value.accent === "松柏绿" || value.accent === "黛蓝" || value.accent === "暖橙") &&
    isWorkbenchSummaryShape(value.summary) &&
    Array.isArray(value.priorityStudents) && value.priorityStudents.every(isMobileStudentSummaryShape) &&
    Array.isArray(value.upcomingLessons) && value.upcomingLessons.every(isLessonSessionShape) &&
    Array.isArray(value.openTasks) && value.openTasks.every(isTaskShape)
  );
}

function isWorkbenchDataV1(value: unknown): value is WorkbenchDataV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== WORKBENCH_SCHEMA_VERSION) return false;
  if (value.storageKind !== WORKBENCH_STORAGE_KIND) return false;
  if (!isRecord(value.meta) || !isRecord(value.user)) return false;
  if (!Array.isArray(value.students) || !Array.isArray(value.lessons)) return false;
  if (!Array.isArray(value.tasks) || !Array.isArray(value.resources)) return false;
  const lessonTemplates = value.lessonTemplates === undefined ? [] : value.lessonTemplates;
  const lessonExceptions = value.lessonExceptions === undefined ? [] : value.lessonExceptions;
  if (!Array.isArray(lessonTemplates) || !Array.isArray(lessonExceptions)) return false;
  if (
    !hasUniqueIds(value.students) ||
    !hasUniqueIds(value.lessons) ||
    !hasUniqueIds(value.tasks) ||
    !hasUniqueIds(value.resources) ||
    !hasUniqueIds(lessonTemplates) ||
    !hasUniqueIds(lessonExceptions)
  ) {
    return false;
  }
  const templateIds = new Set(
    lessonTemplates.flatMap((template) => isRecord(template) && isNonEmptyString(template.id) ? [template.id] : []),
  );
  const exceptionOccurrences = new Set<string>();
  for (const exception of lessonExceptions) {
    if (!isRecord(exception) || !isNonEmptyString(exception.templateId) || !isNonEmptyString(exception.date)) return false;
    if (!templateIds.has(exception.templateId)) return false;
    const occurrenceKey = `${exception.templateId}|${exception.date}`;
    if (exceptionOccurrences.has(occurrenceKey)) return false;
    exceptionOccurrences.add(occurrenceKey);
  }
  return (
    isFiniteNumber(value.meta.revision) && Number.isInteger(value.meta.revision) && value.meta.revision >= 1 &&
    typeof value.meta.createdAt === "string" && typeof value.meta.updatedAt === "string" &&
    typeof value.meta.containsDemoData === "boolean" &&
    isUserConfigurationShape(value.user) &&
    value.students.every(isStudentRecordShape) && value.lessons.every(isLessonSessionShape) &&
    value.tasks.every(isTaskShape) && value.resources.every(isResourceShape) &&
    lessonTemplates.every(isLessonTemplateShape) &&
    lessonExceptions.every(isLessonExceptionShape) &&
    (value.mobileSnapshot === null || isMobileSnapshotShape(value.mobileSnapshot))
  );
}

function unpackStoredData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.storageKind === WORKBENCH_STORAGE_KIND && isRecord(value.data)) {
    return value.data;
  }
  return value;
}

function resolveBrowserStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeStoredV1(data: WorkbenchDataV1): WorkbenchDataV1 {
  const normalized = cloneSerializable(data);
  normalized.meta.revision = Math.max(1, Math.floor(normalized.meta.revision));
  normalized.students = normalized.students.filter((student) => Boolean(student?.id && student?.name));
  normalized.lessons = normalized.lessons.filter((lesson) => Boolean(lesson?.id && lesson?.startsAt));
  normalized.tasks = normalized.tasks.filter((task) => Boolean(task?.id && task?.title));
  normalized.resources = normalized.resources.filter((resource) => Boolean(resource?.id && resource?.title));

  // Early v1 prototypes did not persist these three provenance/reminder fields.
  // Normalizing them here keeps those device-local records readable without a
  // silent schema reset.
  for (const student of normalized.students) {
    for (const assessment of student.assessments) {
      if (!isAssessmentSource(assessment.source)) assessment.source = "手工录入";
    }
  }
  for (const lesson of normalized.lessons) {
    if (
      lesson.reminderMinutesBefore !== null &&
      (typeof lesson.reminderMinutesBefore !== "number" ||
        !Number.isFinite(lesson.reminderMinutesBefore))
    ) {
      lesson.reminderMinutesBefore = null;
    }
  }
  for (const task of normalized.tasks) {
    if (typeof task.reminderAt !== "string") task.reminderAt = null;
  }
  if (!Array.isArray(normalized.lessonTemplates)) normalized.lessonTemplates = [];
  if (!Array.isArray(normalized.lessonExceptions)) normalized.lessonExceptions = [];
  return normalized;
}

function isRecognizableLegacyV0(value: Record<string, unknown>): boolean {
  if (value.schemaVersion === 0) return true;
  if (Array.isArray(value.students) || Array.isArray(value.tasks) || Array.isArray(value.lessons) || Array.isArray(value.resources)) return true;
  const legacyUser = isRecord(value.user) ? value.user : isRecord(value.profile) ? value.profile : null;
  return Boolean(
    legacyUser &&
    ("workbenchName" in legacyUser || "workspaceName" in legacyUser || "teacherName" in legacyUser || "name" in legacyUser),
  );
}

function legacyRating(value: unknown): HomeSchoolRating {
  return isHomeSchoolRating(value) ? value : 0;
}

function legacyAssessment(
  value: unknown,
  studentId: string,
  index: number,
  fallbackDate: string,
): AssessmentRecord | null {
  if (!isRecord(value)) return null;
  const maxScore = toFiniteNumber(value.maxScore, 100);
  const score = toFiniteNumber(value.score, Number.NaN);
  const cohortSize = Math.max(1, Math.floor(toFiniteNumber(value.cohortSize ?? value.classSize, 1)));
  const rank = Math.min(cohortSize, Math.max(1, Math.floor(toFiniteNumber(value.rank, cohortSize))));
  if (!Number.isFinite(score) || maxScore <= 0 || score < 0 || score > maxScore) return null;
  return {
    id: toStringValue(value.id, `${studentId}-A-MIGRATED-${index + 1}`),
    title: toStringValue(value.title ?? value.assessmentTitle, `迁移成绩 ${index + 1}`),
    subject: toStringValue(value.subject, "未标注学科"),
    occurredOn: toStringValue(value.occurredOn ?? value.date, fallbackDate),
    maxScore,
    score,
    rank,
    cohortSize,
    classAverage: toFiniteNumber(value.classAverage, 0),
    status: isAssessmentStatus(value.status) ? value.status : "已核对",
    source: isAssessmentSource(value.source) ? value.source : "手工录入",
    verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : undefined,
  };
}

/**
 * Migrates the previous unversioned prototype shape into the current schema.
 * It starts from an empty workspace so real legacy records are preserved and
 * fictional seed records can never be injected into a teacher's restore.
 */
function migrateLegacyV0(value: Record<string, unknown>, now: string): WorkbenchDataV1 {
  const seedUser = createSeedWorkbenchData({ includeMobileSnapshot: false }).user;
  const migrated = createEmptyWorkbenchData(seedUser, now);
  const legacyUser = isRecord(value.user) ? value.user : isRecord(value.profile) ? value.profile : null;

  if (legacyUser) {
    migrated.user.workbenchName = toStringValue(
      legacyUser.workbenchName ?? legacyUser.workspaceName,
      migrated.user.workbenchName,
    );
    migrated.user.teacherName = toStringValue(
      legacyUser.teacherName ?? legacyUser.name,
      migrated.user.teacherName,
    );
    migrated.user.roleLabel = toStringValue(legacyUser.roleLabel ?? legacyUser.role, migrated.user.roleLabel);
    if (legacyUser.schoolStage === "小学" || legacyUser.schoolStage === "初中" || legacyUser.schoolStage === "高中" || legacyUser.schoolStage === "教培") {
      migrated.user.schoolStage = legacyUser.schoolStage;
    }
    if (Array.isArray(legacyUser.subjects)) {
      migrated.user.subjects = legacyUser.subjects.filter((subject): subject is string => typeof subject === "string");
    }
  }

  if (Array.isArray(value.students)) {
    for (const [index, rawStudent] of value.students.entries()) {
      if (!isRecord(rawStudent)) continue;
      const name = toStringValue(rawStudent.name, "");
      const className = toStringValue(rawStudent.className, "");
      if (!name || !className) continue;
      const id = toStringValue(rawStudent.id, `S-MIGRATED-${index + 1}`);
      const fallbackDate = getDeviceLocalDate(now, migrated.user.timeZone);
      const assessments = Array.isArray(rawStudent.assessments)
        ? rawStudent.assessments.flatMap((assessment, assessmentIndex) => {
            const parsed = legacyAssessment(assessment, id, assessmentIndex, fallbackDate);
            return parsed ? [parsed] : [];
          })
        : [];
      if (assessments.length === 0 && (isFiniteNumber(rawStudent.score) || isFiniteNumber(rawStudent.previousScore))) {
        if (isFiniteNumber(rawStudent.previousScore)) {
          const previous = legacyAssessment({
            title: rawStudent.previousTitle ?? "迁移前次成绩",
            subject: rawStudent.subject,
            occurredOn: rawStudent.previousOccurredOn ?? addDaysLocal(fallbackDate, -1),
            maxScore: rawStudent.maxScore,
            score: rawStudent.previousScore,
            rank: rawStudent.previousRank,
            cohortSize: rawStudent.classSize ?? rawStudent.cohortSize,
            classAverage: rawStudent.classAverage,
          }, id, assessments.length, fallbackDate);
          if (previous) assessments.push(previous);
        }
        if (isFiniteNumber(rawStudent.score)) {
          const latest = legacyAssessment({
            title: rawStudent.title ?? rawStudent.assessmentTitle ?? "迁移当前成绩",
            subject: rawStudent.subject,
            occurredOn: rawStudent.occurredOn ?? fallbackDate,
            maxScore: rawStudent.maxScore,
            score: rawStudent.score,
            rank: rawStudent.rank,
            cohortSize: rawStudent.classSize ?? rawStudent.cohortSize,
            classAverage: rawStudent.classAverage,
          }, id, assessments.length, fallbackDate);
          if (latest) assessments.push(latest);
        }
      }
      const rawHomeSchool = isRecord(rawStudent.homeSchool) ? rawStudent.homeSchool : null;
      const issueText = typeof rawStudent.recentIssue === "string" ? rawStudent.recentIssue : "";
      migrated.students.push({
        id,
        name,
        className,
        initials: toStringValue(rawStudent.initials, name.length > 2 ? name.slice(-2) : name),
        color: toStringValue(rawStudent.color, "sage"),
        assessments,
        recentIssue: issueText
          ? {
              id: toStringValue(rawStudent.issueId, `${id}-I-MIGRATED`),
              title: toStringValue(rawStudent.issueTitle, "迁移的近期问题"),
              detail: issueText,
              observedOn: toStringValue(rawStudent.observedOn, fallbackDate),
              status: isStudentIssueStatus(rawStudent.issueStatus) ? rawStudent.issueStatus : "观察中",
              nextAction: toStringValue(rawStudent.issueNext, "请老师核对并补充下一步。"),
            }
          : null,
        homeSchool: {
          communicationDifficulty: legacyRating(rawHomeSchool?.communicationDifficulty),
          communicationNote: typeof rawHomeSchool?.communicationNote === "string" ? rawHomeSchool.communicationNote : "尚未设置。",
          supportWillingness: legacyRating(rawHomeSchool?.supportWillingness),
          supportNote: typeof rawHomeSchool?.supportNote === "string" ? rawHomeSchool.supportNote : "尚未设置。",
          updatedAt: typeof rawHomeSchool?.updatedAt === "string" ? rawHomeSchool.updatedAt : now,
        },
      });
    }
  }

  if (Array.isArray(value.tasks)) {
    const migratedTasks: WorkbenchTask[] = [];
    for (const rawTask of value.tasks) {
      if (!isRecord(rawTask)) continue;
      const title = toStringValue(rawTask.title, "");
      if (!title) continue;
      const rawDuration = rawTask.estimatedMinutes ?? rawTask.duration;
      const minutes =
        typeof rawDuration === "string"
          ? Number.parseInt(rawDuration.replace(/\D/g, ""), 10)
          : toFiniteNumber(rawDuration, 0);
      migratedTasks.push({
        id: toStringValue(rawTask.id, `T-MIGRATED-${migratedTasks.length + 1}`),
        category: isTaskCategory(rawTask.category ?? rawTask.kind)
          ? (rawTask.category ?? rawTask.kind) as TaskCategory
          : "教学",
        title,
        dueAt: toStringValue(rawTask.dueAt, `${SEED_LOCAL_DATE}T18:00:00+08:00`),
        estimatedMinutes: Number.isFinite(minutes) ? minutes : 0,
        status: isTaskStatus(rawTask.status) ? rawTask.status : "待开始",
        reminderAt: typeof rawTask.reminderAt === "string" ? rawTask.reminderAt : null,
        relatedLabel: typeof rawTask.relatedLabel === "string" ? rawTask.relatedLabel : undefined,
      });
    }
    migrated.tasks = migratedTasks;
  }

  if (Array.isArray(value.lessons)) {
    migrated.lessons = value.lessons.flatMap((lesson) => isLessonSessionShape(lesson) ? [cloneSerializable(lesson)] : []);
  }
  if (Array.isArray(value.resources)) {
    migrated.resources = value.resources.flatMap((resource) => isResourceShape(resource) ? [cloneSerializable(resource)] : []);
  }
  const legacyMeta = isRecord(value.meta) ? value.meta : null;
  migrated.meta.containsDemoData = legacyMeta?.containsDemoData === true;
  migrated.meta.revision = 1;
  migrated.meta.updatedAt = now;
  migrated.mobileSnapshot = null;
  return migrated;
}

function isTaskCategory(value: unknown): value is TaskCategory {
  return value === "教学" || value === "学生" || value === "行政" || value === "论文";
}

function isAssessmentSource(value: unknown): value is AssessmentSource {
  return value === "手工录入" || value === "表格导入" || value === "图片识别";
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "待开始" || value === "进行中" || value === "已完成";
}

/**
 * Creates a real, empty workspace for a teacher who has finished (or skipped)
 * initialization. Collections start empty; only the user configuration is
 * retained. `containsDemoData` is false so the demo banner disappears.
 */
export function createEmptyWorkbenchData(user: UserConfiguration, now: string): WorkbenchData {
  return {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    storageKind: WORKBENCH_STORAGE_KIND,
    meta: {
      revision: 1,
      createdAt: now,
      updatedAt: now,
      containsDemoData: false,
    },
    user: cloneSerializable(user),
    students: [],
    lessons: [],
    tasks: [],
    resources: [],
    mobileSnapshot: null,
  };
}

/** Returns the device's local calendar date (YYYY-MM-DD) in the given time zone. */
export function getDeviceLocalDate(now: Date | string, timeZone = "Asia/Shanghai"): string {
  const date = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Creates a fresh, independent set of fictional demonstration data. */
export function createSeedWorkbenchData(options: { includeMobileSnapshot?: boolean } = {}): WorkbenchData {
  const data: WorkbenchData = {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    storageKind: WORKBENCH_STORAGE_KIND,
    meta: {
      revision: 1,
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_UPDATED_AT,
      containsDemoData: true,
    },
    user: {
      workbenchName: "林老师的工作台",
      teacherName: "林老师",
      roleLabel: "初中语文教师 · 八年级4班班主任",
      schoolStage: "初中",
      subjects: ["语文", "班会"],
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      weekStartsOn: 1,
      appearance: {
        accent: "松柏绿",
        avatarMark: "林",
      },
    },
    students: createSeedStudents(),
    lessons: createSeedLessons(),
    tasks: createSeedTasks(),
    resources: createSeedResources(),
    mobileSnapshot: null,
  };

  if (options.includeMobileSnapshot !== false) {
    data.mobileSnapshot = createMobileReadOnlySnapshot(data, SEED_UPDATED_AT);
  }
  return data;
}

export function getAssessmentChange(
  student: Pick<StudentRecord, "assessments">,
  options: { confirmedOnly?: boolean; subject?: string } = {},
): AssessmentChange {
  const confirmedOnly = options.confirmedOnly !== false;
  const eligible = student.assessments
    .filter((assessment) => !confirmedOnly || assessment.status === "已核对")
    .slice()
    .sort((left, right) => {
      const dateOrder = left.occurredOn.localeCompare(right.occurredOn);
      return dateOrder === 0 ? left.id.localeCompare(right.id) : dateOrder;
    });
  const subject = options.subject ?? eligible.at(-1)?.subject ?? null;
  const ordered = subject ? eligible.filter((assessment) => assessment.subject === subject) : [];
  const latest = ordered.at(-1) ?? null;
  const previous = ordered.at(-2) ?? null;

  if (!latest || !previous) {
    return {
      subject,
      latest,
      previous,
      scoreDelta: null,
      scoreRateDelta: null,
      rankDelta: null,
    };
  }

  const latestRate = latest.maxScore > 0 ? (latest.score / latest.maxScore) * 100 : null;
  const previousRate = previous.maxScore > 0 ? (previous.score / previous.maxScore) * 100 : null;

  return {
    subject,
    latest,
    previous,
    scoreDelta: latest.maxScore === previous.maxScore ? latest.score - previous.score : null,
    scoreRateDelta:
      latestRate === null || previousRate === null ? null : roundTo(latestRate - previousRate, 1),
    rankDelta: previous.rank - latest.rank,
  };
}

export type AssessmentReviewFields = Pick<
  AssessmentRecord,
  "title" | "subject" | "occurredOn" | "maxScore" | "score" | "rank" | "cohortSize" | "classAverage"
>;

export type AssessmentMutationResult =
  | { ok: true; record: AssessmentRecord }
  | {
      ok: false;
      code: "STUDENT_NOT_FOUND" | "ASSESSMENT_NOT_FOUND" | "INVALID_ASSESSMENT";
      message: string;
    };

/** Reviews an existing assessment without changing its identity or provenance. */
export function reviewAssessmentRecord(
  draft: WorkbenchData,
  input: {
    studentId: string;
    assessmentId: string;
    fields: AssessmentReviewFields;
    decision: "confirm" | "keep-pending";
    reviewedAt: string;
  },
): AssessmentMutationResult {
  const student = draft.students.find((candidate) => candidate.id === input.studentId);
  if (!student) return { ok: false, code: "STUDENT_NOT_FOUND", message: "没有找到这名学生。" };
  const record = student.assessments.find((candidate) => candidate.id === input.assessmentId);
  if (!record) return { ok: false, code: "ASSESSMENT_NOT_FOUND", message: "没有找到这条成绩记录。" };
  const next: AssessmentRecord = {
    ...record,
    ...input.fields,
    status: input.decision === "confirm" ? "已核对" : "待核对",
    verifiedAt: input.decision === "confirm" ? input.reviewedAt : undefined,
  };
  if (!isAssessmentRecordShape(next)) {
    return { ok: false, code: "INVALID_ASSESSMENT", message: "成绩、满分、名次或参考人数不符合范围。" };
  }
  Object.assign(record, next);
  return { ok: true, record };
}

/** Deletes exactly one selected assessment from a cloned workbench draft. */
export function deleteAssessmentRecord(
  draft: WorkbenchData,
  studentId: string,
  assessmentId: string,
): AssessmentMutationResult {
  const student = draft.students.find((candidate) => candidate.id === studentId);
  if (!student) return { ok: false, code: "STUDENT_NOT_FOUND", message: "没有找到这名学生。" };
  const index = student.assessments.findIndex((candidate) => candidate.id === assessmentId);
  if (index < 0) return { ok: false, code: "ASSESSMENT_NOT_FOUND", message: "没有找到这条成绩记录。" };
  const [record] = student.assessments.splice(index, 1);
  return { ok: true, record };
}

export function rankPriorityStudents(students: readonly StudentRecord[]): StudentPriority[] {
  return students
    .map((student): StudentPriority => {
      const progress = getAssessmentChange(student);
      const reasons: StudentPriorityReason[] = [];
      let priorityScore = 0;

      if (student.recentIssue?.status === "待处理") {
        reasons.push("近期问题待处理");
        priorityScore += 40;
      } else if (student.recentIssue?.status === "观察中") {
        reasons.push("近期问题观察中");
        priorityScore += 16;
      }

      if (progress.rankDelta !== null && progress.rankDelta < 0) {
        reasons.push("排名下降");
        priorityScore += 20 + Math.min(Math.abs(progress.rankDelta) * 2, 18);
      }
      if (progress.rankDelta !== null && progress.rankDelta > 0) {
        reasons.push("排名上升");
        priorityScore += 10 + Math.min(progress.rankDelta * 2, 12);
      }
      if (progress.scoreRateDelta !== null && progress.scoreRateDelta < 0) {
        reasons.push("成绩下降");
        priorityScore += 16 + Math.min(Math.abs(progress.scoreRateDelta) * 2, 14);
      }
      if (student.homeSchool.communicationDifficulty >= 4) {
        reasons.push("家长沟通需跟进");
        priorityScore += 14;
      }
      if (student.homeSchool.supportWillingness > 0 && student.homeSchool.supportWillingness <= 2) {
        reasons.push("家庭辅助尚未行动");
        priorityScore += 12;
      }

      return { student, priorityScore, reasons, progress };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
      return left.student.id.localeCompare(right.student.id);
    });
}

export function summarizeTaskDuration(tasks: readonly WorkbenchTask[]): TaskDurationSummary {
  const byCategory: Record<TaskCategory, number> = {
    教学: 0,
    学生: 0,
    行政: 0,
    论文: 0,
  };
  let totalMinutes = 0;
  let openMinutes = 0;
  let completedMinutes = 0;
  let openTaskCount = 0;

  for (const task of tasks) {
    const minutes = Number.isFinite(task.estimatedMinutes) ? Math.max(0, task.estimatedMinutes) : 0;
    totalMinutes += minutes;
    byCategory[task.category] += minutes;
    if (task.status === "已完成") {
      completedMinutes += minutes;
    } else {
      openMinutes += minutes;
      openTaskCount += 1;
    }
  }

  return { totalMinutes, openMinutes, completedMinutes, openTaskCount, byCategory };
}

export function summarizeWorkbench(
  data: Pick<WorkbenchData, "students" | "tasks" | "lessons"> &
    Partial<Pick<WorkbenchData, "lessonTemplates" | "lessonExceptions">>,
  localDate = SEED_LOCAL_DATE,
): WorkbenchSummary {
  const taskDuration = summarizeTaskDuration(data.tasks);
  const changes = data.students.map((student) => getAssessmentChange(student));
  const latestRates = changes.flatMap((change) => {
    if (!change.latest || change.latest.maxScore <= 0) return [];
    return [(change.latest.score / change.latest.maxScore) * 100];
  });

  return {
    totalStudents: data.students.length,
    studentsWithConfirmedAssessments: changes.filter((change) => change.latest !== null).length,
    rankImproved: changes.filter((change) => change.rankDelta !== null && change.rankDelta > 0).length,
    rankDeclined: changes.filter((change) => change.rankDelta !== null && change.rankDelta < 0).length,
    scoreImproved: changes.filter(
      (change) => change.scoreRateDelta !== null && change.scoreRateDelta > 0,
    ).length,
    scoreDeclined: changes.filter(
      (change) => change.scoreRateDelta !== null && change.scoreRateDelta < 0,
    ).length,
    issuesPending: data.students.filter((student) => student.recentIssue?.status === "待处理").length,
    issuesWatching: data.students.filter((student) => student.recentIssue?.status === "观察中").length,
    homeSchoolFollowUps: data.students.filter(
      (student) =>
        student.homeSchool.communicationDifficulty >= 4 ||
        student.homeSchool.supportWillingness > 0 && student.homeSchool.supportWillingness <= 2,
    ).length,
    openTasks: taskDuration.openTaskCount,
    openTaskMinutes: taskDuration.openMinutes,
    lessonsOnDate: expandLessonsOnDate(data, localDate, `${localDate}T23:59:59+08:00`).filter(
      (lesson) => lesson.status !== "已取消",
    ).length,
    averageLatestScoreRate:
      latestRates.length === 0
        ? null
        : roundTo(latestRates.reduce((total, score) => total + score, 0) / latestRates.length, 1),
  };
}

export function createMobileReadOnlySnapshot(
  data: WorkbenchData,
  generatedAt: string,
  options: { localDate?: string; priorityLimit?: number; lessonLimit?: number; taskLimit?: number } = {},
): MobileReadOnlySnapshot {
  const localDate = options.localDate ?? generatedAt.slice(0, 10);
  const priorityLimit = options.priorityLimit ?? 5;
  const lessonLimit = options.lessonLimit ?? 5;
  const taskLimit = options.taskLimit ?? 8;

  const priorityStudents = rankPriorityStudents(data.students)
    .slice(0, priorityLimit)
    .map(({ student, progress }): MobileStudentSummary => ({
      id: student.id,
      name: student.name,
      className: student.className,
      latestScore: progress.latest?.score ?? null,
      latestMaxScore: progress.latest?.maxScore ?? null,
      currentRank: progress.latest?.rank ?? null,
      cohortSize: progress.latest?.cohortSize ?? null,
      scoreDelta: progress.scoreDelta,
      rankDelta: progress.rankDelta,
      issueTitle: student.recentIssue?.title ?? null,
      issueStatus: student.recentIssue?.status ?? null,
    }));

  return {
    snapshotVersion: 1,
    snapshotId: `mobile-${data.meta.revision}-${generatedAt.replace(/\D/g, "").slice(0, 14)}`,
    readOnly: true,
    generatedAt,
    sourceRevision: data.meta.revision,
    workbenchName: data.user.workbenchName,
    accent: data.user.appearance.accent,
    summary: summarizeWorkbench(data, localDate),
    priorityStudents,
    upcomingLessons: expandLessonsForRange(data, localDate, addDaysLocal(localDate, 14), generatedAt)
      .filter((lesson) => lesson.status === "待上课" && lesson.startsAt >= generatedAt)
      .slice(0, lessonLimit)
      .map(cloneSerializable),
    openTasks: data.tasks
      .filter((task) => task.status !== "已完成")
      .slice()
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .slice(0, taskLimit)
      .map(cloneSerializable),
  };
}

export function checkWorkbenchWriteAccess(context: WorkbenchWriteContext): WorkbenchWriteGuard {
  if (context.surface === "mobile-snapshot") {
    return {
      allowed: false,
      code: "SNAPSHOT_READ_ONLY",
      message: "手机看板仅供查看，请在电脑工作台更新。",
    };
  }
  if (context.device === "mobile") {
    return {
      allowed: false,
      code: "MOBILE_READ_ONLY",
      message: "手机端仅供查看，请在电脑工作台更新。",
    };
  }
  return { allowed: true };
}

/**
 * Applies an update to a cloned draft. The input object is never mutated, and
 * read-only callers are rejected before the updater runs.
 */
export function applyWorkbenchUpdate(
  current: WorkbenchData,
  context: WorkbenchWriteContext,
  updater: (draft: WorkbenchData) => WorkbenchData | void,
  updatedAt: string,
): WorkbenchData {
  const guard = checkWorkbenchWriteAccess(context);
  if (!guard.allowed) throw new Error(`${guard.code}: ${guard.message}`);

  const draft = cloneSerializable(current);
  const candidate = updater(draft) ?? draft;
  if (!isWorkbenchDataV1(candidate)) {
    throw new Error("INVALID_WORKBENCH_DATA: 更新结果不符合当前数据版本。 ");
  }
  // Clone once more in case an updater returns an object it owns. This keeps
  // both the source state and caller-owned objects outside this transaction.
  const updated = cloneSerializable(candidate);
  updated.meta = {
    ...updated.meta,
    revision: current.meta.revision + 1,
    updatedAt,
  };
  return normalizeStoredV1(updated);
}

/** Pure migration from an unknown parsed value into the current version. */
export function migrateWorkbenchData(
  input: unknown,
  now = SEED_UPDATED_AT,
): Omit<WorkbenchHydrationResult, "source"> & { source: "stored" | "migrated" } {
  const unpacked = unpackStoredData(input);
  if (isWorkbenchDataV1(unpacked)) {
    return {
      data: normalizeStoredV1(unpacked),
      source: "stored",
      migratedFrom: null,
      warnings: [],
    };
  }

  if (isRecord(unpacked)) {
    const version = typeof unpacked.schemaVersion === "number" ? unpacked.schemaVersion : 0;
    if (version === 0 && isRecognizableLegacyV0(unpacked)) {
      const migrated = migrateLegacyV0(unpacked, now);
      if (!isWorkbenchDataV1(migrated)) {
        throw new Error("INVALID_LEGACY_DATA: 早期数据中存在无效或重复的记录，未覆盖当前工作区。");
      }
      return {
        data: normalizeStoredV1(migrated),
        source: "migrated",
        migratedFrom: 0,
        warnings: ["已将早期本地数据转换为当前版本，请核对成绩日期和事项截止时间。"],
      };
    }
    if (version === 0) {
      throw new Error("INVALID_WORKBENCH_DATA: 这不是可识别的教师工作台数据文件。");
    }
    if (version === WORKBENCH_SCHEMA_VERSION) {
      throw new Error("INVALID_WORKBENCH_DATA: 当前版本文件的结构或字段不完整。");
    }
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: ${version}`);
  }

  throw new Error("INVALID_WORKBENCH_DATA: 无法识别本地数据。 ");
}

/**
 * Deserializes without throwing. Invalid data falls back to a fresh fictional
 * seed and returns a warning so the UI can offer recovery/export options.
 */
export function deserializeWorkbenchData(
  serialized: string,
  now = SEED_UPDATED_AT,
): WorkbenchHydrationResult {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return migrateWorkbenchData(parsed, now);
  } catch (error) {
    return {
      data: createSeedWorkbenchData(),
      source: "seed",
      migratedFrom: null,
      warnings: [
        error instanceof Error
          ? `本地数据未能读取，已载入演示数据：${error.message}`
          : "本地数据未能读取，已载入演示数据。",
      ],
    };
  }
}

/** Browser helper. It performs no write and remains safe when called during SSR. */
export function loadDeviceLocalWorkbench(options: {
  storage?: StorageLike;
  now?: string;
} = {}): DeviceLocalLoadResult {
  const storage = resolveBrowserStorage(options.storage);
  if (!storage) {
    return {
      data: createSeedWorkbenchData(),
      source: "seed",
      migratedFrom: null,
      warnings: ["当前环境无法读取此设备上的数据，已载入演示数据。"],
      storageAvailable: false,
      storageKey: WORKBENCH_STORAGE_KEY,
    };
  }

  try {
    const current = storage.getItem(WORKBENCH_STORAGE_KEY);
    if (current !== null) {
      return {
        ...deserializeWorkbenchData(current, options.now),
        storageAvailable: true,
        storageKey: WORKBENCH_STORAGE_KEY,
      };
    }

    for (const key of LEGACY_WORKBENCH_STORAGE_KEYS) {
      const legacy = storage.getItem(key);
      if (legacy === null) continue;
      const result = deserializeWorkbenchData(legacy, options.now);
      return {
        ...result,
        source: result.source === "stored" ? "migrated" : result.source,
        migratedFrom: result.migratedFrom ?? 0,
        warnings: [...result.warnings, "检测到早期本地数据，保存后将使用当前版本。"],
        storageAvailable: true,
        storageKey: WORKBENCH_STORAGE_KEY,
      };
    }

    return {
      data: createSeedWorkbenchData(),
      source: "seed",
      migratedFrom: null,
      warnings: [],
      storageAvailable: true,
      storageKey: WORKBENCH_STORAGE_KEY,
    };
  } catch (error) {
    return {
      data: createSeedWorkbenchData(),
      source: "seed",
      migratedFrom: null,
      warnings: [
        error instanceof Error
          ? `此设备上的数据暂时无法读取：${error.message}`
          : "此设备上的数据暂时无法读取。",
      ],
      storageAvailable: true,
      storageKey: WORKBENCH_STORAGE_KEY,
    };
  }
}

/** Reads the rolling backup list (newest first). Never throws. */
export function listDeviceLocalBackups(storage: StorageLike): WorkbenchBackupEntry[] {
  try {
    const raw = storage.getItem(WORKBENCH_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WorkbenchBackupEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as WorkbenchBackupEntry).savedAt === "string" &&
        typeof (entry as WorkbenchBackupEntry).revision === "number" &&
        typeof (entry as WorkbenchBackupEntry).payload === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Rotates rolling backups before the current value is overwritten. The most
 * recent backup is kept first; at most WORKBENCH_BACKUP_LIMIT are retained.
 * Rotation failures never block the primary save.
 */
export function rotateDeviceLocalBackup(storage: StorageLike, currentEnvelopeJson: string | null, now: string): void {
  if (!currentEnvelopeJson) return;
  try {
    const parsed = JSON.parse(currentEnvelopeJson) as { data?: { meta?: { revision?: number } } };
    const revision = parsed.data?.meta?.revision ?? 0;
    const backups = listDeviceLocalBackups(storage);
    if (backups[0]?.payload === currentEnvelopeJson) return;
    const next: WorkbenchBackupEntry[] = [
      { savedAt: now, revision, payload: currentEnvelopeJson },
      ...backups,
    ].slice(0, WORKBENCH_BACKUP_LIMIT);
    storage.setItem(WORKBENCH_BACKUP_KEY, JSON.stringify(next));
  } catch {
    // Backup rotation must never block the primary save.
  }
}

/**
 * Browser helper with a mandatory access context. Mobile/snapshot writes are
 * denied here even if the caller accidentally exposes an editing control.
 */
export function saveDeviceLocalWorkbench(
  data: WorkbenchData,
  options: {
    access: WorkbenchWriteContext;
    storage?: StorageLike;
    savedAt?: string;
    /** In-memory state before this save, used to create the very first backup. */
    previousDataForBackup?: WorkbenchData;
  },
): DeviceLocalSaveResult {
  const guard = checkWorkbenchWriteAccess(options.access);
  if (!guard.allowed) {
    return {
      ok: false,
      storageKey: WORKBENCH_STORAGE_KEY,
      reason: "read-only",
      message: guard.message,
    };
  }

  const storage = resolveBrowserStorage(options.storage);
  if (!storage) {
    return {
      ok: false,
      storageKey: WORKBENCH_STORAGE_KEY,
      reason: "storage-unavailable",
      message: "当前环境无法保存到此设备。",
    };
  }

  const savedAt = options.savedAt ?? data.meta.updatedAt;
  const envelope: StoredWorkbenchEnvelopeV1 = {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    storageKind: WORKBENCH_STORAGE_KIND,
    savedAt,
    data: normalizeStoredV1(data),
  };

  try {
    // Keep the previous version recoverable before overwriting it.
    const storedBeforeSave = storage.getItem(WORKBENCH_STORAGE_KEY);
    const previousEnvelope = !storedBeforeSave && options.previousDataForBackup
      ? JSON.stringify({
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          storageKind: WORKBENCH_STORAGE_KIND,
          savedAt: options.previousDataForBackup.meta.updatedAt,
          data: normalizeStoredV1(options.previousDataForBackup),
        } satisfies StoredWorkbenchEnvelopeV1)
      : null;
    rotateDeviceLocalBackup(storage, storedBeforeSave ?? previousEnvelope, savedAt);
    storage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(envelope));
    return { ok: true, storageKey: WORKBENCH_STORAGE_KEY, savedAt };
  } catch (error) {
    return {
      ok: false,
      storageKey: WORKBENCH_STORAGE_KEY,
      reason: "storage-error",
      message:
        error instanceof Error ? `保存失败：${error.message}` : "保存失败，请检查此设备的可用空间。",
    };
  }
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/* ------------------------------------------------------------------------ */
/* 成绩信号(首页提示栏)与分科/趋势分析                                      */
/* ------------------------------------------------------------------------ */

export type SignalTone = "green" | "red" | "yellow";

export interface StudentSignal {
  /** Stable per student + rule + latest assessment; a new assessment re-alerts. */
  key: string;
  tone: SignalTone;
  rule: "improve-streak" | "decline-streak" | "cliff-drop" | "anomaly-jump" | "maxscore-change";
  studentId: string;
  studentName: string;
  className: string;
  title: string;
  detail: string;
}

export interface SubjectBreakdown {
  subject: string;
  count: number;
  latestRate: number;
  deltaRate: number | null;
  latestTitle: string;
}

export interface ScorePoint {
  title: string;
  occurredOn: string;
  rate: number;
  classAverage: number;
  score: number;
  maxScore: number;
}

/** Confirmed assessments of a student, oldest first. */
function confirmedChronological(student: Pick<StudentRecord, "assessments">): AssessmentRecord[] {
  return student.assessments
    .filter((assessment) => assessment.status === "已核对" && assessment.maxScore > 0)
    .slice()
    .sort((left, right) => {
      const order = left.occurredOn.localeCompare(right.occurredOn);
      return order === 0 ? left.id.localeCompare(right.id) : order;
    });
}

function scoreRateOf(assessment: AssessmentRecord): number {
  return (assessment.score / assessment.maxScore) * 100;
}

/** Per-subject progress for the student detail page. */
export function getSubjectBreakdown(student: StudentRecord): SubjectBreakdown[] {
  const confirmed = confirmedChronological(student);
  const bySubject = new Map<string, AssessmentRecord[]>();
  for (const assessment of confirmed) {
    const list = bySubject.get(assessment.subject) ?? [];
    list.push(assessment);
    bySubject.set(assessment.subject, list);
  }
  return Array.from(bySubject.entries())
    .map(([subject, list]) => {
      const latest = list.at(-1)!;
      const previous = list.at(-2) ?? null;
      return {
        subject,
        count: list.length,
        latestRate: roundTo(scoreRateOf(latest), 1),
        deltaRate: previous ? roundTo(scoreRateOf(latest) - scoreRateOf(previous), 1) : null,
        latestTitle: latest.title,
      };
    })
    .sort((left, right) => right.latestRate - left.latestRate);
}

/** Score-rate series for the trend chart (optionally one subject). */
export function getScoreRateSeries(student: StudentRecord, subject?: string): ScorePoint[] {
  return confirmedChronological(student)
    .filter((assessment) => !subject || assessment.subject === subject)
    .map((assessment) => ({
      title: assessment.title,
      occurredOn: assessment.occurredOn,
      rate: roundTo(scoreRateOf(assessment), 1),
      classAverage: assessment.maxScore > 0 ? roundTo((assessment.classAverage / assessment.maxScore) * 100, 1) : 0,
      score: assessment.score,
      maxScore: assessment.maxScore,
    }));
}

/**
 * Rule-based signals for the home alert strip, computed per subject (streaks
 * only make sense within one subject's chronology). Green = two consecutive
 * rises; red = two consecutive drops or one cliff drop (≥15 rate points);
 * yellow = suspicious single rise (≥30 points) or an inconsistent full score
 * that may need verification. All rules use 已核对 assessments only.
 */
export function analyzeStudentSignals(student: StudentRecord): StudentSignal[] {
  const confirmed = confirmedChronological(student);
  if (confirmed.length < 2) return [];
  const base = { studentId: student.id, studentName: student.name, className: student.className };
  const signals: StudentSignal[] = [];

  const bySubject = new Map<string, AssessmentRecord[]>();
  for (const assessment of confirmed) {
    const list = bySubject.get(assessment.subject) ?? [];
    list.push(assessment);
    bySubject.set(assessment.subject, list);
  }

  for (const [subject, list] of bySubject) {
    if (list.length < 2) continue;
    const rates = list.map(scoreRateOf);
    const latest = list.at(-1)!;
    const previous = list.at(-2)!;
    const lastDelta = roundTo(rates.at(-1)! - rates.at(-2)!, 1);
    const scope = list.length === confirmed.length ? "" : `${subject}`;

    if (list.length >= 3) {
      const prevDelta = roundTo(rates.at(-2)! - rates.at(-3)!, 1);
      if (lastDelta > 0 && prevDelta > 0) {
        const weakest = getSubjectBreakdown(student);
        const weak = weakest.length > 1 ? weakest.at(-1)! : null;
        signals.push({
          key: `${student.id}:improve-streak:${latest.id}`,
          tone: "green",
          rule: "improve-streak",
          ...base,
          title: `${student.name} ${scope}近两次持续上涨`,
          detail: weak && weak.subject !== subject
            ? `两次累计 +${roundTo(rates.at(-1)! - rates.at(-3)!, 1)} 个百分点;${weak.subject} 相对较弱,仍有提升空间。`
            : `两次累计 +${roundTo(rates.at(-1)! - rates.at(-3)!, 1)} 个百分点,保持关注。`,
        });
      }
      if (lastDelta < 0 && prevDelta < 0) {
        signals.push({
          key: `${student.id}:decline-streak:${latest.id}`,
          tone: "red",
          rule: "decline-streak",
          ...base,
          title: `${student.name} ${scope}近两次连续下降`,
          detail: `两次累计 ${roundTo(rates.at(-1)! - rates.at(-3)!, 1)} 个百分点,建议关注原因。`,
        });
      }
    }

    if (lastDelta <= -15) {
      signals.push({
        key: `${student.id}:cliff-drop:${latest.id}`,
        tone: "red",
        rule: "cliff-drop",
        ...base,
        title: `${student.name} ${scope}最近一次降幅较大`,
        detail: `得分率下降 ${Math.abs(lastDelta)} 个百分点,建议尽快了解原因。`,
      });
    }

    if (lastDelta >= 30) {
      signals.push({
        key: `${student.id}:anomaly-jump:${latest.id}`,
        tone: "yellow",
        rule: "anomaly-jump",
        ...base,
        title: `${student.name} ${scope}最近一次涨幅较大`,
        detail: `得分率上升 ${lastDelta} 个百分点,建议核对原始成绩。`,
      });
    }

    if (latest.maxScore !== previous.maxScore) {
      signals.push({
        key: `${student.id}:maxscore-change:${latest.id}`,
        tone: "yellow",
        rule: "maxscore-change",
        ...base,
        title: `${student.name} ${scope}满分口径有变化`,
        detail: `上次满分 ${previous.maxScore}、这次 ${latest.maxScore},建议核对是否录错。`,
      });
    }
  }

  return signals;
}

// Urgency order: a decline must never be crowded out by good news. When no
// alerts exist, green good-news signals still surface.
const SIGNAL_TONE_ORDER: Record<SignalTone, number> = { red: 0, yellow: 1, green: 2 };

/** Aggregates signals across students: alerts first, dismissed excluded, max `limit`. */
export function collectStudentSignals(
  students: readonly StudentRecord[],
  dismissed: ReadonlySet<string>,
  limit = 3,
): StudentSignal[] {
  return students
    .flatMap((student) => analyzeStudentSignals(student))
    .filter((signal) => !dismissed.has(signal.key))
    .sort((left, right) => {
      const toneOrder = SIGNAL_TONE_ORDER[left.tone] - SIGNAL_TONE_ORDER[right.tone];
      return toneOrder === 0 ? left.key.localeCompare(right.key) : toneOrder;
    })
    .slice(0, limit);
}

/** Rule-based local conclusions for the student detail page (no AI required). */
export function buildStudentInsights(student: StudentRecord, subject?: string): string[] {
  const allConfirmed = confirmedChronological(student);
  const insights: string[] = [];
  const targetSubject = subject ?? allConfirmed.at(-1)?.subject;
  const confirmed = targetSubject
    ? allConfirmed.filter((assessment) => assessment.subject === targetSubject)
    : [];
  if (confirmed.length === 0) return insights;

  const rates = confirmed.map(scoreRateOf);
  const latest = confirmed.at(-1)!;
  const latestRate = rates.at(-1)!;

  // Consecutive direction streaks counting back from the latest assessment.
  let riseStreak = 0;
  for (let index = rates.length - 1; index > 0; index -= 1) {
    if (rates[index] > rates[index - 1]) riseStreak += 1;
    else break;
  }
  let dropStreak = 0;
  for (let index = rates.length - 1; index > 0; index -= 1) {
    if (rates[index] < rates[index - 1]) dropStreak += 1;
    else break;
  }
  if (riseStreak >= 2) insights.push(`${targetSubject}连续 ${riseStreak} 次得分率上升，处于上升通道。`);
  if (dropStreak >= 2) insights.push(`${targetSubject}连续 ${dropStreak} 次得分率下降，建议关注近期学习状态。`);

  const classAvgRate = latest.maxScore > 0 ? roundTo((latest.classAverage / latest.maxScore) * 100, 1) : null;
  if (classAvgRate !== null) {
    const gap = roundTo(latestRate - classAvgRate, 1);
    if (gap > 0) insights.push(`最近一次高于班级均分 ${gap} 个百分点。`);
    else if (gap < 0) insights.push(`最近一次低于班级均分 ${Math.abs(gap)} 个百分点。`);
    else insights.push("最近一次与班级均分持平。");
  }

  const subjects = getSubjectBreakdown(student);
  if (subjects.length > 1) {
    insights.push(`相对较弱科目：${subjects.at(-1)!.subject}（得分率 ${subjects.at(-1)!.latestRate}%）。`);
    insights.push(`相对优势科目：${subjects[0].subject}（得分率 ${subjects[0].latestRate}%）。`);
  }

  const spread = roundTo(Math.max(...rates) - Math.min(...rates), 1);
  if (spread >= 20) insights.push(`${targetSubject}历史波动 ${spread} 个百分点，波动偏大，建议观察稳定性。`);

  const change = getAssessmentChange(student, { subject: targetSubject });
  if (change.rankDelta !== null && Math.abs(change.rankDelta) >= 10) {
    insights.push(change.rankDelta > 0 ? `班级排名上升 ${change.rankDelta} 名。` : `班级排名下降 ${Math.abs(change.rankDelta)} 名。`);
  }

  return insights;
}

/* ------------------------------------------------------------------------ */
/* 学期循环课表展开                                                          */
/* ------------------------------------------------------------------------ */

function addDaysLocal(dateString: string, amount: number): string {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(dateString: string): number {
  return new Date(`${dateString}T12:00:00+08:00`).getUTCDay() || 7;
}

/**
 * Expands recurring lesson templates into concrete sessions for the range
 * [fromDate, toDate] (inclusive, YYYY-MM-DD), applies cancel/reschedule
 * exceptions, and merges with manually recorded concrete lessons. Status is
 * derived from `now`: past sessions are 已完成, future ones 待上课.
 */
export function expandLessonsForRange(
  data: Pick<WorkbenchData, "lessons"> & Partial<Pick<WorkbenchData, "lessonTemplates" | "lessonExceptions">>,
  fromDate: string,
  toDate: string,
  now: string,
): LessonSession[] {
  const templates = data.lessonTemplates ?? [];
  const exceptions = data.lessonExceptions ?? [];
  const nowMs = new Date(now).getTime();
  const result = new Map<string, LessonSession>();
  data.lessons
    .filter((lesson) => {
      const date = lesson.startsAt.slice(0, 10);
      return lesson.status !== "已取消" && date >= fromDate && date <= toDate;
    })
    .forEach((lesson) => {
      const cloned = cloneSerializable(lesson);
      const startMs = new Date(cloned.startsAt).getTime();
      const endMs = new Date(cloned.endsAt).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      if (cloned.status !== "已取消" && Number.isFinite(endMs) && Number.isFinite(nowMs)) {
        cloned.status = endMs <= nowMs ? "已完成" : "待上课";
      }
      result.set(cloned.id, cloned);
    });

  const sourceDates = new Set<string>();
  for (let date = fromDate; date <= toDate; date = addDaysLocal(date, 1)) sourceDates.add(date);
  for (const exception of exceptions) {
    if (exception.action === "reschedule" && exception.newDate && exception.newDate >= fromDate && exception.newDate <= toDate) {
      sourceDates.add(exception.date);
    }
  }

  for (const sourceDate of sourceDates) {
    const weekday = weekdayOf(sourceDate);
    for (const template of templates) {
      if (template.weekday !== weekday) continue;
      if (sourceDate < template.semesterStart || sourceDate > template.semesterEnd) continue;

      const exception = exceptions.findLast((candidate) => candidate.templateId === template.id && candidate.date === sourceDate);
      if (exception?.action === "cancel") continue;

      let sessionDate = sourceDate;
      let startTime = template.startTime;
      let endTime = template.endTime;
      let room = template.room;
      if (exception?.action === "reschedule") {
        sessionDate = exception.newDate ?? sourceDate;
        startTime = exception.newStartTime ?? startTime;
        endTime = exception.newEndTime ?? endTime;
        room = exception.newRoom ?? room;
      }
      if (sessionDate < fromDate || sessionDate > toDate) continue;

      const startsAt = `${sessionDate}T${startTime}:00+08:00`;
      const endsAt = `${sessionDate}T${endTime}:00+08:00`;
      const startMs = new Date(startsAt).getTime();
      const endMs = new Date(endsAt).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
      const lesson: LessonSession = {
        id: `${template.id}@${sourceDate}`,
        title: template.title,
        subject: template.subject,
        className: template.className,
        startsAt,
        endsAt,
        room,
        preparation: template.preparation,
        status: Number.isFinite(endMs) && Number.isFinite(nowMs) && endMs <= nowMs ? "已完成" : "待上课",
        reminderMinutesBefore: template.reminderMinutesBefore,
      };
      result.set(lesson.id, lesson);
    }
  }

  return Array.from(result.values()).sort((left, right) => {
    const timeOrder = left.startsAt.localeCompare(right.startsAt);
    return timeOrder === 0 ? left.id.localeCompare(right.id) : timeOrder;
  });
}

/** Effective lessons on one date (concrete + expanded templates). */
export function expandLessonsOnDate(
  data: Pick<WorkbenchData, "lessons"> & Partial<Pick<WorkbenchData, "lessonTemplates" | "lessonExceptions">>,
  date: string,
  now: string,
): LessonSession[] {
  return expandLessonsForRange(data, date, date, now);
}
