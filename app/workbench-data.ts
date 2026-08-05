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

export type SchoolStage = "小学" | "初中" | "高中" | "教培";
export type AssessmentStatus = "已核对" | "待核对";
export type AssessmentSource = "手工录入" | "表格导入" | "图片识别";
export type StudentIssueStatus = "待处理" | "观察中" | "已缓解";
export type TaskCategory = "教学" | "学生" | "行政" | "论文";
export type TaskStatus = "待开始" | "进行中" | "已完成";
export type ResourceKind = "教案" | "课件" | "练习" | "模板" | "参考资料";

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
  communicationDifficulty: 1 | 2 | 3 | 4 | 5;
  communicationNote: string;
  supportWillingness: 1 | 2 | 3 | 4 | 5;
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
  mobileSnapshot: MobileReadOnlySnapshot | null;
}

export type WorkbenchData = WorkbenchDataV1;

export interface AssessmentChange {
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
  "",
  "畅通",
  "可沟通",
  "需解释",
  "需多次跟进",
  "暂难推进",
] as const;

export const SUPPORT_WILLINGNESS_LABELS = [
  "",
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

function createSeedStudents(): StudentRecord[] {
  return [
    {
      id: "S08403",
      name: "李明澈",
      className: "八年级4班",
      initials: "明澈",
      color: "sage",
      assessments: createSeedAssessments("S08403", [79, 81, 82, 85], [19, 17, 14, 10], 43, 79),
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
      assessments: createSeedAssessments("S08412", [78, 82, 83, 81], [22, 17, 15, 19], 43, 79),
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
      assessments: createSeedAssessments("S08207", [78, 81, 84, 87], [21, 17, 12, 9], 44, 80),
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
      assessments: createSeedAssessments("S08219", [86, 88, 90, 92], [8, 6, 4, 3], 44, 80),
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
      assessments: createSeedAssessments("S08231", [77, 79, 80, 76], [25, 23, 21, 28], 44, 80),
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
      assessments: createSeedAssessments("S08427", [83, 85, 87, 89], [13, 10, 7, 5], 43, 79),
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
      assessments: createSeedAssessments("S08605", [84, 86, 88, 91], [12, 10, 7, 4], 42, 78),
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
      assessments: createSeedAssessments("S08616", [71, 73, 75, 78], [34, 31, 28, 24], 42, 78),
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

function isWorkbenchDataV1(value: unknown): value is WorkbenchDataV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== WORKBENCH_SCHEMA_VERSION) return false;
  if (value.storageKind !== WORKBENCH_STORAGE_KIND) return false;
  if (!isRecord(value.meta) || !isRecord(value.user)) return false;
  if (!Array.isArray(value.students) || !Array.isArray(value.lessons)) return false;
  if (!Array.isArray(value.tasks) || !Array.isArray(value.resources)) return false;
  return (
    typeof value.meta.revision === "number" &&
    typeof value.meta.createdAt === "string" &&
    typeof value.meta.updatedAt === "string"
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
  return normalized;
}

/**
 * Migrates the previous unversioned prototype shape into the current schema.
 * Unknown or missing fields are replaced with a complete seed value while
 * recognizable user configuration and flat score/task data are retained.
 */
function migrateLegacyV0(value: Record<string, unknown>, now: string): WorkbenchDataV1 {
  const seed = createSeedWorkbenchData({ includeMobileSnapshot: false });
  const legacyUser = isRecord(value.user) ? value.user : isRecord(value.profile) ? value.profile : null;

  if (legacyUser) {
    seed.user.workbenchName = toStringValue(
      legacyUser.workbenchName ?? legacyUser.workspaceName,
      seed.user.workbenchName,
    );
    seed.user.teacherName = toStringValue(
      legacyUser.teacherName ?? legacyUser.name,
      seed.user.teacherName,
    );
    seed.user.roleLabel = toStringValue(legacyUser.roleLabel ?? legacyUser.role, seed.user.roleLabel);
  }

  if (Array.isArray(value.students)) {
    const studentsById = new Map(seed.students.map((student) => [student.id, student]));
    for (const rawStudent of value.students) {
      if (!isRecord(rawStudent)) continue;
      const id = toStringValue(rawStudent.id, "");
      const student = studentsById.get(id);
      if (!student) continue;

      student.name = toStringValue(rawStudent.name, student.name);
      student.className = toStringValue(rawStudent.className, student.className);

      const latest = student.assessments.at(-1);
      const previous = student.assessments.at(-2);
      if (latest) {
        latest.score = toFiniteNumber(rawStudent.score, latest.score);
        latest.rank = toFiniteNumber(rawStudent.rank, latest.rank);
        latest.cohortSize = toFiniteNumber(rawStudent.classSize, latest.cohortSize);
        latest.classAverage = toFiniteNumber(rawStudent.classAverage, latest.classAverage);
      }
      if (previous) {
        previous.score = toFiniteNumber(rawStudent.previousScore, previous.score);
        previous.rank = toFiniteNumber(rawStudent.previousRank, previous.rank);
      }

      if (typeof rawStudent.recentIssue === "string" && student.recentIssue) {
        student.recentIssue.detail = rawStudent.recentIssue;
      }
      if (typeof rawStudent.issueNext === "string" && student.recentIssue) {
        student.recentIssue.nextAction = rawStudent.issueNext;
      }
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
    if (migratedTasks.length > 0) seed.tasks = migratedTasks;
  }

  seed.meta.revision = 1;
  seed.meta.updatedAt = now;
  seed.mobileSnapshot = null;
  return seed;
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
  options: { confirmedOnly?: boolean } = {},
): AssessmentChange {
  const confirmedOnly = options.confirmedOnly !== false;
  const ordered = student.assessments
    .filter((assessment) => !confirmedOnly || assessment.status === "已核对")
    .slice()
    .sort((left, right) => {
      const dateOrder = left.occurredOn.localeCompare(right.occurredOn);
      return dateOrder === 0 ? left.id.localeCompare(right.id) : dateOrder;
    });
  const latest = ordered.at(-1) ?? null;
  const previous = ordered.at(-2) ?? null;

  if (!latest || !previous) {
    return {
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
    latest,
    previous,
    scoreDelta: latest.score - previous.score,
    scoreRateDelta:
      latestRate === null || previousRate === null ? null : roundTo(latestRate - previousRate, 1),
    rankDelta: previous.rank - latest.rank,
  };
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
      if (progress.scoreRateDelta !== null && progress.scoreRateDelta < 0) {
        reasons.push("成绩下降");
        priorityScore += 16 + Math.min(Math.abs(progress.scoreRateDelta) * 2, 14);
      }
      if (student.homeSchool.communicationDifficulty >= 4) {
        reasons.push("家长沟通需跟进");
        priorityScore += 14;
      }
      if (student.homeSchool.supportWillingness <= 2) {
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
  data: Pick<WorkbenchData, "students" | "tasks" | "lessons">,
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
        student.homeSchool.supportWillingness <= 2,
    ).length,
    openTasks: taskDuration.openTaskCount,
    openTaskMinutes: taskDuration.openMinutes,
    lessonsOnDate: data.lessons.filter(
      (lesson) => lesson.startsAt.slice(0, 10) === localDate && lesson.status !== "已取消",
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
    summary: summarizeWorkbench(data, localDate),
    priorityStudents,
    upcomingLessons: data.lessons
      .filter((lesson) => lesson.status === "待上课" && lesson.startsAt >= generatedAt)
      .slice()
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
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
    if (version === 0) {
      return {
        data: migrateLegacyV0(unpacked, now),
        source: "migrated",
        migratedFrom: 0,
        warnings: ["已将早期本地数据转换为当前版本，请核对成绩日期和事项截止时间。"],
      };
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
    rotateDeviceLocalBackup(storage, storage.getItem(WORKBENCH_STORAGE_KEY), savedAt);
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
