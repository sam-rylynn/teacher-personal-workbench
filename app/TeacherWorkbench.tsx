"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  COMMUNICATION_DIFFICULTY_LABELS,
  DESKTOP_DEVICE_LOCAL_ACCESS,
  MOBILE_READ_ONLY_ACCESS,
  SUPPORT_WILLINGNESS_LABELS,
  applyWorkbenchUpdate,
  createEmptyWorkbenchData,
  createMobileReadOnlySnapshot,
  createSeedWorkbenchData,
  getAssessmentChange,
  getDeviceLocalDate,
  listDeviceLocalBackups,
  loadDeviceLocalWorkbench,
  rankPriorityStudents,
  saveDeviceLocalWorkbench,
  summarizeTaskDuration,
  summarizeWorkbench,
  type AssessmentRecord,
  type AssessmentSource,
  type LessonSession,
  type MobileReadOnlySnapshot,
  type SchoolStage,
  type StudentIssueStatus,
  type StudentRecord,
  type TaskCategory,
  type WorkbenchBackupEntry,
  type WorkbenchData,
  type WorkbenchTask,
} from "./workbench-data";
import {
  applyAssessmentImportPlan,
  applyLessonImportPlan,
  buildIcsCalendar,
  computeDueReminders,
  parseWorkbenchImportText,
  planAssessmentImport,
  planLessonImport,
  readBackupEntry,
  serializeWorkbenchExport,
  type AssessmentImportPlan,
  type LessonImportPlan,
} from "./workbench-transfer";

type ViewKey = "today" | "teaching" | "students" | "tasks" | "resources";
type TaskFilter = "全部" | TaskCategory;
type AccessMode = "checking" | "desktop" | "mobile";
type StudentChartMode = "score" | "rank";
type SearchResult = {
  type: "学生" | "事项" | "课次" | "资料";
  title: string;
  meta: string;
  id: string;
};

type StudentUpdateInput =
  | {
      kind: "assessment";
      studentId: string;
      record: Omit<AssessmentRecord, "id" | "verifiedAt">;
    }
  | {
      kind: "issue";
      studentId: string;
      title: string;
      detail: string;
      status: StudentIssueStatus;
      observedOn: string;
      nextAction: string;
      followUpOn?: string;
    }
  | {
      kind: "homeSchool";
      studentId: string;
      communicationDifficulty: 1 | 2 | 3 | 4 | 5;
      communicationNote: string;
      supportWillingness: 1 | 2 | 3 | 4 | 5;
      supportNote: string;
    };

type NewTaskInput = {
  category: TaskCategory;
  title: string;
  dueAt: string;
  estimatedMinutes: number;
  relatedLabel?: string;
  reminderAt: string | null;
};

const navItems: Array<{ key: ViewKey; label: string; icon: string }> = [
  { key: "today", label: "今日", icon: "⌂" },
  { key: "students", label: "学生", icon: "◎" },
  { key: "teaching", label: "课表", icon: "▦" },
  { key: "tasks", label: "事项", icon: "✓" },
  { key: "resources", label: "资料", icon: "◇" },
];

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Avatar({ student, size = "normal" }: { student: StudentRecord; size?: "small" | "normal" | "large" }) {
  return <span className={`avatar avatar-${student.color} avatar-${size}`}>{student.initials}</span>;
}

function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="section-description">{description}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatFullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
}

function formatChange(value: number | null, unit: string) {
  if (value === null || value === 0) return "—";
  return `${value > 0 ? "↑" : "↓"} ${Math.abs(value)}${unit}`;
}

function localInputToIso(value: string) {
  return value ? `${value}:00+08:00` : "";
}

function toneForTask(category: TaskCategory) {
  if (category === "教学") return "sage";
  if (category === "学生") return "blue";
  if (category === "行政") return "apricot";
  return "violet";
}

function toneForIssue(status: StudentIssueStatus | null | undefined) {
  if (status === "待处理") return "apricot";
  if (status === "已缓解") return "sage";
  return "blue";
}

function addDays(dateString: string, amount: number) {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function getWeekDates(lessons: readonly LessonSession[]) {
  const anchor = lessons.map((lesson) => lesson.startsAt.slice(0, 10)).sort()[0] ?? new Date().toISOString().slice(0, 10);
  const anchorDate = new Date(`${anchor}T12:00:00+08:00`);
  const day = anchorDate.getUTCDay();
  const monday = addDays(anchor, -((day + 6) % 7));
  return Array.from({ length: 5 }, (_, index) => addDays(monday, index));
}

export default function TeacherWorkbench() {
  const [accessMode, setAccessMode] = useState<AccessMode>("checking");
  const [workspace, setWorkspace] = useState<WorkbenchData>(() => createSeedWorkbenchData());
  const [mobileContent, setMobileContent] = useState<MobileReadOnlySnapshot | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("today");
  const [selectedStudentId, setSelectedStudentId] = useState("S08403");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentClass, setStudentClass] = useState("全部班级");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("全部");
  const [globalQuery, setGlobalQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [studentEditorOpen, setStudentEditorOpen] = useState(false);
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishComplete, setPublishComplete] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [importKind, setImportKind] = useState<"assessments" | "lessons" | null>(null);
  const [dataManageOpen, setDataManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [keyboardShortcut, setKeyboardShortcut] = useState("⌘ K");
  const [locationSearch, setLocationSearch] = useState("");
  const deliveredReminders = useRef<Set<string>>(new Set());

  const readOnly = accessMode !== "desktop";
  const deviceToday = useMemo(
    () => getDeviceLocalDate(new Date(), workspace.user.timeZone),
    [workspace.user.timeZone],
  );
  // Demo data is anchored to its fictional date; real data follows the device.
  const displayDate = workspace.meta.containsDemoData ? "2026-09-16" : deviceToday;
  const summary = useMemo(() => summarizeWorkbench(workspace, displayDate), [workspace, displayDate]);
  const taskSummary = useMemo(() => summarizeTaskDuration(workspace.tasks), [workspace.tasks]);
  const selectedStudent = workspace.students.find((student) => student.id === selectedStudentId) ?? workspace.students[0];
  const selectedLesson = workspace.lessons.find((lesson) => lesson.id === selectedLessonId) ?? null;

  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim();
    return workspace.students.filter((student) => {
      const issueText = student.recentIssue ? `${student.recentIssue.title}${student.recentIssue.detail}` : "";
      const matchesQuery = !query || `${student.name}${student.className}${issueText}`.includes(query);
      const matchesClass = studentClass === "全部班级" || student.className === studentClass;
      return matchesQuery && matchesClass;
    });
  }, [studentClass, studentQuery, workspace.students]);

  const filteredTasks = useMemo(
    () => workspace.tasks
      .filter((task) => taskFilter === "全部" || task.category === taskFilter)
      .slice()
      .sort((left, right) => {
        if (left.status === "已完成" && right.status !== "已完成") return 1;
        if (left.status !== "已完成" && right.status === "已完成") return -1;
        return left.dueAt.localeCompare(right.dueAt);
      }),
    [taskFilter, workspace.tasks],
  );

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = globalQuery.trim();
    if (!query) return [];
    const studentResults: SearchResult[] = workspace.students
      .filter((student) => `${student.name}${student.className}${student.recentIssue?.title ?? ""}`.includes(query))
      .map((student) => {
        const latest = getAssessmentChange(student).latest;
        return {
          type: "学生",
          title: student.name,
          meta: latest ? `${student.className} · ${latest.score}分 · 第${latest.rank}名` : student.className,
          id: student.id,
        };
      });
    const taskResults: SearchResult[] = workspace.tasks
      .filter((task) => `${task.title}${task.category}${task.relatedLabel ?? ""}`.includes(query))
      .map((task) => ({ type: "事项", title: task.title, meta: `${formatDateTime(task.dueAt)} · ${task.relatedLabel ?? "未关联对象"}`, id: task.id }));
    const lessonResults: SearchResult[] = workspace.lessons
      .filter((lesson) => `${lesson.title}${lesson.className}${lesson.subject}${lesson.room}`.includes(query))
      .map((lesson) => ({ type: "课次", title: lesson.title, meta: `${lesson.className} · ${formatDateTime(lesson.startsAt)}`, id: lesson.id }));
    const resourceResults: SearchResult[] = workspace.resources
      .filter((resource) => `${resource.title}${resource.kind}${resource.subject}${resource.gradeOrClass}`.includes(query))
      .map((resource) => ({ type: "资料", title: resource.title, meta: `${resource.kind} · ${resource.gradeOrClass}`, id: resource.id }));
    return [...studentResults, ...taskResults, ...lessonResults, ...resourceResults].slice(0, 8);
  }, [globalQuery, workspace]);

  // Track URL changes (including SPA soft navigations) so switching between
  // the desktop and mobile links always re-evaluates the access mode instead
  // of keeping the previous view.
  useEffect(() => {
    const update = () => setLocationSearch(window.location.search);
    update();
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      update();
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      update();
      return result;
    };
    window.addEventListener("popstate", update);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", update);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadDeviceLocalWorkbench({ now: new Date().toISOString() });
      const params = new URLSearchParams(locationSearch);
      const isMobileView = params.get("mode") === "mobile" || window.matchMedia("(max-width: 680px)").matches;
      setKeyboardShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K");

      if (isMobileView) {
        setMobileContent(loaded.data.mobileSnapshot ?? createMobileReadOnlySnapshot(loaded.data, loaded.data.meta.updatedAt));
        setAccessMode("mobile");
      } else {
        setWorkspace(loaded.data);
        setMobileContent(loaded.data.mobileSnapshot);
        setAccessMode("desktop");
      }

      if (loaded.warnings.length) setToast(loaded.warnings[0]);
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [locationSearch]);

  // 首次运行：演示数据尚未清除时，自动弹出图文首装向导。
  useEffect(() => {
    if (!loaded || accessMode !== "desktop" || !workspace.meta.containsDemoData) return;
    try {
      if (window.localStorage.getItem("tw-onboarded")) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => setOnboardingOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [loaded, accessMode, workspace.meta.containsDemoData]);

  // Local reminders: while the desktop page is open, surface due lesson and
  // task reminders as toasts (and system notifications when permitted).
  useEffect(() => {
    if (accessMode !== "desktop") return;
    const check = () => {
      const due = computeDueReminders(workspace, new Date().toISOString(), deliveredReminders.current);
      if (!due.length) return;
      for (const reminder of due) {
        deliveredReminders.current.add(reminder.key);
        setToast(`${reminder.kind}提醒 · ${reminder.title}:${reminder.message}`);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(`${reminder.kind}提醒 · ${reminder.title}`, { body: reminder.message });
          } catch {
            // Notification construction can fail in some browsers; toast already covers it.
          }
        }
      }
    };
    const interval = window.setInterval(check, 30_000);
    check();
    return () => window.clearInterval(interval);
  }, [accessMode, workspace]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function commitWorkspace(updater: (draft: WorkbenchData) => WorkbenchData | void, successMessage: string) {
    const access = accessMode === "desktop" ? DESKTOP_DEVICE_LOCAL_ACCESS : MOBILE_READ_ONLY_ACCESS;
    try {
      const now = new Date().toISOString();
      const next = applyWorkbenchUpdate(workspace, access, updater, now);
      const saved = saveDeviceLocalWorkbench(next, { access, savedAt: now });
      if (!saved.ok) {
        setToast(saved.message);
        return null;
      }
      setWorkspace(next);
      setToast(successMessage);
      return next;
    } catch (error) {
      setToast(error instanceof Error && error.message.includes("READ_ONLY") ? "手机看板仅供查看，请回到电脑更新。" : "本次修改未能保存，请稍后重试。");
      return null;
    }
  }

  function selectSearchResult(result: SearchResult) {
    if (result.type === "学生") {
      setSelectedStudentId(result.id);
      setActiveView("students");
    } else if (result.type === "事项") {
      setActiveView("tasks");
    } else if (result.type === "课次") {
      setSelectedLessonId(result.id);
      setActiveView("teaching");
    } else {
      setActiveView("resources");
    }
    setSearchOpen(false);
    setGlobalQuery("");
  }

  function openStudent(id: string) {
    setSelectedStudentId(id);
    setStudentQuery("");
    setStudentClass("全部班级");
    setActiveView("students");
  }

  function toggleTask(id: string) {
    commitWorkspace((draft) => {
      const task = draft.tasks.find((item) => item.id === id);
      if (!task) return;
      const completing = task.status !== "已完成";
      task.status = completing ? "已完成" : "待开始";
      task.completedAt = completing ? new Date().toISOString() : undefined;
    }, "事项状态已保存");
  }

  function updateParentRating(studentId: string, key: "communication" | "support", value: 1 | 2 | 3 | 4 | 5) {
    commitWorkspace((draft) => {
      const student = draft.students.find((item) => item.id === studentId);
      if (!student) return;
      if (key === "communication") student.homeSchool.communicationDifficulty = value;
      else student.homeSchool.supportWillingness = value;
      student.homeSchool.updatedAt = new Date().toISOString();
    }, "家校协同情况已保存");
  }

  function saveStudentUpdate(input: StudentUpdateInput) {
    const success = commitWorkspace((draft) => {
      const student = draft.students.find((item) => item.id === input.studentId);
      if (!student) return;
      const now = new Date().toISOString();
      if (input.kind === "assessment") {
        student.assessments.push({
          ...input.record,
          id: `${student.id}-A-${Date.now()}`,
          verifiedAt: input.record.status === "已核对" ? now : undefined,
        });
      } else if (input.kind === "issue") {
        student.recentIssue = {
          id: student.recentIssue?.id ?? `${student.id}-I-${Date.now()}`,
          title: input.title,
          detail: input.detail,
          status: input.status,
          observedOn: input.observedOn,
          nextAction: input.nextAction,
          followUpOn: input.followUpOn,
        };
      } else {
        student.homeSchool = {
          communicationDifficulty: input.communicationDifficulty,
          communicationNote: input.communicationNote,
          supportWillingness: input.supportWillingness,
          supportNote: input.supportNote,
          updatedAt: now,
        };
      }
    }, input.kind === "assessment" ? "成绩与排名已保存" : input.kind === "issue" ? "近期问题已保存" : "家校协同情况已保存");
    if (success) setStudentEditorOpen(false);
    return Boolean(success);
  }

  function saveTask(input: NewTaskInput) {
    const success = commitWorkspace((draft) => {
      draft.tasks.push({
        id: `T-${Date.now()}`,
        category: input.category,
        title: input.title,
        dueAt: input.dueAt,
        estimatedMinutes: input.estimatedMinutes,
        status: "待开始",
        reminderAt: input.reminderAt,
        relatedLabel: input.relatedLabel,
      });
    }, "新事项已保存");
    if (success) setTaskEditorOpen(false);
    return Boolean(success);
  }

  function updateMobileContent() {
    if (accessMode !== "desktop") {
      setToast("手机看板仅供查看，请回到电脑更新。");
      return;
    }
    try {
      const now = new Date().toISOString();
      const next = applyWorkbenchUpdate(workspace, DESKTOP_DEVICE_LOCAL_ACCESS, (draft) => draft, now);
      next.mobileSnapshot = createMobileReadOnlySnapshot(next, now);
      const saved = saveDeviceLocalWorkbench(next, { access: DESKTOP_DEVICE_LOCAL_ACCESS, savedAt: now });
      if (!saved.ok) {
        setToast(saved.message);
        return;
      }
      setWorkspace(next);
      setMobileContent(next.mobileSnapshot);
      setPublishComplete(true);
      setToast("手机看板已更新");
    } catch {
      setToast("手机看板暂时无法更新，请稍后重试。");
    }
  }

  function confirmAssessmentImport(plan: AssessmentImportPlan) {
    const success = commitWorkspace((draft) => {
      applyAssessmentImportPlan(draft, plan, new Date().toISOString());
    }, `已导入 ${plan.entries.length} 条测评记录${plan.newStudentCount ? `，新增 ${plan.newStudentCount} 名学生` : ""}，请逐条核对。`);
    if (success) setImportKind(null);
    return Boolean(success);
  }

  function confirmLessonImport(plan: LessonImportPlan) {
    const success = commitWorkspace((draft) => {
      applyLessonImportPlan(draft, plan, new Date().toISOString());
    }, `已导入 ${plan.entries.length} 节真实课次。`);
    if (success) setImportKind(null);
    return Boolean(success);
  }

  function downloadTextFile(filename: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportDataFile() {
    const now = new Date().toISOString();
    downloadTextFile(
      `教师工作台-数据备份-${getDeviceLocalDate(now, workspace.user.timeZone)}.json`,
      serializeWorkbenchExport(workspace, now),
      "application/json",
    );
    setToast("数据文件已导出，请妥善保存。");
  }

  function exportCalendarFile() {
    const now = new Date().toISOString();
    downloadTextFile(
      `教师工作台-课表与事项-${getDeviceLocalDate(now, workspace.user.timeZone)}.ics`,
      buildIcsCalendar(workspace, now),
      "text/calendar",
    );
    setToast("日历文件已导出，可用系统日历打开。");
  }

  function restoreFromText(text: string, sourceLabel: string) {
    const now = new Date().toISOString();
    try {
      const result = parseWorkbenchImportText(text, now);
      const success = commitWorkspace(
        () => result.data,
        `已从${sourceLabel}恢复，包含 ${result.data.students.length} 名学生、${result.data.lessons.length} 节课次、${result.data.tasks.length} 件事项。`,
      );
      if (success) {
        setDataManageOpen(false);
        setSelectedStudentId(result.data.students[0]?.id ?? "");
      }
      return Boolean(success);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "文件无法识别。");
      return false;
    }
  }

  function restoreFromBackup(entry: WorkbenchBackupEntry) {
    const now = new Date().toISOString();
    const result = readBackupEntry(entry, now);
    const success = commitWorkspace(
      () => result.data,
      `已恢复到 ${formatDateTime(entry.savedAt)} 的自动备份。`,
    );
    if (success) {
      setDataManageOpen(false);
      setSelectedStudentId(result.data.students[0]?.id ?? "");
    }
    return Boolean(success);
  }

  function clearDemoData() {
    const success = commitWorkspace(
      () => createEmptyWorkbenchData(workspace.user, new Date().toISOString()),
      "演示数据已清除，可以开始导入真实内容。",
    );
    if (success) {
      setDataManageOpen(false);
      setSelectedStudentId("");
    }
    return Boolean(success);
  }

  function saveSettings(input: { workbenchName: string; teacherName: string; roleLabel: string; schoolStage: SchoolStage; subjects: string[]; avatarMark: string }) {
    const success = commitWorkspace((draft) => {
      draft.user.workbenchName = input.workbenchName;
      draft.user.teacherName = input.teacherName;
      draft.user.roleLabel = input.roleLabel;
      draft.user.schoolStage = input.schoolStage;
      draft.user.subjects = input.subjects;
      draft.user.appearance.avatarMark = input.avatarMark || input.workbenchName.slice(0, 1) || "禾";
    }, "工作台信息已保存。");
    if (success) setSettingsOpen(false);
    return Boolean(success);
  }

  function requestNotificationPermission() {
    if (typeof Notification === "undefined") {
      setToast("当前浏览器不支持系统通知，页面内提醒仍然有效。");
      return;
    }
    if (Notification.permission === "granted") {
      setToast("系统通知已开启。");
      return;
    }
    void Notification.requestPermission().then((permission) => {
      setToast(permission === "granted" ? "系统通知已开启。" : "未开启系统通知，页面内提醒仍然有效。");
    });
  }

  function finishOnboarding(config: { workbenchName: string; teacherName: string; roleLabel: string; schoolStage: SchoolStage; subjects: string[]; avatarMark: string }) {
    const now = new Date().toISOString();
    const success = commitWorkspace(() => {
      const newUser = {
        ...workspace.user,
        workbenchName: config.workbenchName,
        teacherName: config.teacherName,
        roleLabel: config.roleLabel,
        schoolStage: config.schoolStage,
        subjects: config.subjects,
        appearance: { ...workspace.user.appearance, avatarMark: config.avatarMark },
      };
      return createEmptyWorkbenchData(newUser, now);
    }, "工作台已配置好，演示数据已清空，开始导入名单与课表吧。");
    if (success) {
      try {
        window.localStorage.setItem("tw-onboarded", "1");
      } catch {
        // 标记写入失败不影响配置完成。
      }
      setOnboardingOpen(false);
      setSelectedStudentId("");
      setActiveView("students");
    }
  }

  if (accessMode === "mobile") {
    return <MobileReadOnlyWorkbench content={mobileContent ?? createSeedWorkbenchData().mobileSnapshot!} />;
  }

  return (
    <div className={`workbench-shell ${readOnly ? "is-read-only" : ""}`}>
      <aside className="sidebar" aria-label="主要导航">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">{workspace.user.appearance.avatarMark}</span>
          <span>
            <strong>{workspace.user.workbenchName}</strong>
            <small>{workspace.user.teacherName} · {workspace.user.roleLabel.split(" · ")[0]}</small>
          </span>
        </div>

        {workspace.meta.containsDemoData ? (
          <div className="demo-chip-block">
            <div className="demo-chip"><span aria-hidden="true">●</span> 全部为虚构演示数据</div>
            {!readOnly ? <button type="button" className="text-button" onClick={() => setOnboardingOpen(true)}>开始配置我的工作台 <span>→</span></button> : null}
          </div>
        ) : null}

        <nav className="main-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activeView === item.key ? "active" : ""}
              onClick={() => setActiveView(item.key)}
              aria-current={activeView === item.key ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.key === "tasks" ? <span className="nav-count">{summary.openTasks}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="local-status-card">
          <div className="status-heading"><span className="status-dot" /> 内容已保存</div>
          <p>{mobileContent ? `手机内容更新于 ${formatDateTime(mobileContent.generatedAt)}` : "手机看板还没有更新"}</p>
          <button type="button" className="text-button" onClick={() => setMobilePreviewOpen(true)}>查看手机内容 <span>→</span></button>
          {!readOnly ? <button type="button" className="text-button" onClick={() => setDataManageOpen(true)}>数据与备份 <span>→</span></button> : null}
        </div>

        <div className="profile-row" aria-label="当前老师">
          <span className="teacher-avatar">{workspace.user.teacherName.slice(0, 1) || "师"}</span>
          <span><strong>{workspace.user.teacherName}</strong><small>{workspace.user.schoolStage} · {workspace.user.subjects.join("、")}</small></span>
          {!readOnly ? <button type="button" className="profile-settings" aria-label="工作台设置" onClick={() => setSettingsOpen(true)}>⚙</button> : null}
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button type="button" className="mobile-brand" onClick={() => setActiveView("today")}>
            <span className="brand-mark" aria-hidden="true">{workspace.user.appearance.avatarMark}</span>
            <strong>教师工作台</strong>
          </button>

          <div className="search-wrap">
            <button type="button" className="global-search" onClick={() => setSearchOpen(true)} aria-label="打开全局搜索">
              <span aria-hidden="true">⌕</span>
              <span>搜索学生、课次、事项和资料</span>
              <kbd>{keyboardShortcut}</kbd>
            </button>
          </div>

          <div className="topbar-actions">
            {!readOnly ? (
              <>
                <button type="button" className="button button-ghost" onClick={() => setMobilePreviewOpen(true)}>查看手机内容</button>
                <button type="button" className="button button-primary" onClick={() => { setPublishComplete(false); setPublishOpen(true); }}>
                  <span aria-hidden="true">↻</span> 更新手机看板
                </button>
              </>
            ) : <span className="readonly-badge">正在读取此设备的数据…</span>}
          </div>
        </header>

        <div className="page-content">
          {activeView === "today" ? (
            <TodayView
              data={workspace}
              summary={summary}
              onToggleTask={toggleTask}
              onOpenLesson={setSelectedLessonId}
              onOpenQuickAdd={() => setStudentEditorOpen(true)}
              onGoTasks={() => setActiveView("tasks")}
              onGoStudents={() => setActiveView("students")}
              onOpenStudent={openStudent}
              readOnly={readOnly}
            />
          ) : null}
          {activeView === "teaching" ? (
            <TeachingView
              data={workspace}
              summary={summary}
              onOpenLesson={setSelectedLessonId}
              onImportLessons={() => setImportKind("lessons")}
              onExportCalendar={exportCalendarFile}
              readOnly={readOnly}
            />
          ) : null}
          {activeView === "students" ? (
            <StudentsView
              filteredStudents={filteredStudents}
              selectedStudent={selectedStudent ?? null}
              summary={summary}
              studentQuery={studentQuery}
              studentClass={studentClass}
              onQuery={setStudentQuery}
              onClass={setStudentClass}
              onSelect={setSelectedStudentId}
              onQuickAdd={() => setStudentEditorOpen(true)}
              onImportAssessments={() => setImportKind("assessments")}
              onParentCommunication={(value) => selectedStudent && updateParentRating(selectedStudent.id, "communication", value)}
              onParentSupport={(value) => selectedStudent && updateParentRating(selectedStudent.id, "support", value)}
              readOnly={readOnly}
            />
          ) : null}
          {activeView === "tasks" ? (
            <TasksView
              tasks={filteredTasks}
              allTasks={workspace.tasks}
              taskSummary={taskSummary}
              taskFilter={taskFilter}
              onFilter={setTaskFilter}
              onToggleTask={toggleTask}
              onQuickAdd={() => setTaskEditorOpen(true)}
              readOnly={readOnly}
            />
          ) : null}
          {activeView === "resources" ? <ResourcesView resources={workspace.resources} /> : null}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="手机导航">
        {navItems.map((item) => (
          <button key={item.key} type="button" className={activeView === item.key ? "active" : ""} onClick={() => setActiveView(item.key)}>
            <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>

      {searchOpen ? (
        <div className="modal-backdrop modal-top" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <section className="search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" onMouseDown={(event) => event.stopPropagation()}>
            <div className="search-input-row">
              <span aria-hidden="true">⌕</span>
              <input autoFocus value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="输入姓名、班级、事项或资料名称" aria-label="搜索关键词" />
              <button type="button" onClick={() => setSearchOpen(false)}>关闭</button>
            </div>
            <div className="search-results">
              {!globalQuery ? (
                <div className="search-hint"><strong>可以试试</strong><span>“赵清禾”</span><span>“运动会”</span><span>“课件”</span></div>
              ) : searchResults.length ? searchResults.map((result) => (
                <button key={`${result.type}-${result.id}`} type="button" onClick={() => selectSearchResult(result)}>
                  <Pill tone={result.type === "学生" ? "sage" : result.type === "事项" ? "apricot" : result.type === "课次" ? "blue" : "violet"}>{result.type}</Pill>
                  <span><strong>{result.title}</strong><small>{result.meta}</small></span>
                  <span aria-hidden="true">→</span>
                </button>
              )) : <div className="empty-search">没有找到相关内容</div>}
            </div>
          </section>
        </div>
      ) : null}

      {studentEditorOpen && selectedStudent ? (
        <StudentUpdateModal
          student={selectedStudent}
          defaultDate={workspace.meta.containsDemoData ? "2026-09-16" : new Date().toISOString().slice(0, 10)}
          onClose={() => setStudentEditorOpen(false)}
          onSave={saveStudentUpdate}
        />
      ) : null}
      {taskEditorOpen ? (
        <NewTaskModal
          demoMode={workspace.meta.containsDemoData}
          onClose={() => setTaskEditorOpen(false)}
          onSave={saveTask}
        />
      ) : null}
      {selectedLesson ? <LessonModal lesson={selectedLesson} onClose={() => setSelectedLessonId(null)} /> : null}
      {publishOpen ? (
        <MobileUpdateModal
          data={workspace}
          complete={publishComplete}
          content={mobileContent}
          localDate={displayDate}
          onClose={() => setPublishOpen(false)}
          onUpdate={updateMobileContent}
          onPreview={() => { setPublishOpen(false); setMobilePreviewOpen(true); }}
        />
      ) : null}
      {mobilePreviewOpen ? <MobilePreview content={mobileContent} onClose={() => setMobilePreviewOpen(false)} /> : null}
      {importKind ? (
        <ImportModal
          kind={importKind}
          data={workspace}
          onClose={() => setImportKind(null)}
          onConfirmAssessments={confirmAssessmentImport}
          onConfirmLessons={confirmLessonImport}
        />
      ) : null}
      {dataManageOpen ? (
        <DataManageModal
          data={workspace}
          onClose={() => setDataManageOpen(false)}
          onExportData={exportDataFile}
          onExportCalendar={exportCalendarFile}
          onRestoreFile={restoreFromText}
          onRestoreBackup={restoreFromBackup}
          onClearDemo={clearDemoData}
          onEnableNotifications={requestNotificationPermission}
        />
      ) : null}
      {settingsOpen ? <SettingsModal data={workspace} onClose={() => setSettingsOpen(false)} onSave={saveSettings} /> : null}
      {onboardingOpen ? (
        <OnboardingWizard
          data={workspace}
          onClose={() => setOnboardingOpen(false)}
          onFinish={finishOnboarding}
        />
      ) : null}

      {toast ? <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div> : null}
    </div>
  );
}

function TodayView({
  data,
  summary,
  onToggleTask,
  onOpenLesson,
  onOpenQuickAdd,
  onGoTasks,
  onGoStudents,
  onOpenStudent,
  readOnly,
}: {
  data: WorkbenchData;
  summary: ReturnType<typeof summarizeWorkbench>;
  onToggleTask: (id: string) => void;
  onOpenLesson: (id: string) => void;
  onOpenQuickAdd: () => void;
  onGoTasks: () => void;
  onGoStudents: () => void;
  onOpenStudent: (id: string) => void;
  readOnly: boolean;
}) {
  const openTasks = data.tasks.filter((task) => task.status !== "已完成").slice().sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const focusTasks = openTasks.slice(0, 3);
  const focusMinutes = focusTasks.reduce((total, task) => total + task.estimatedMinutes, 0);
  const priorityStudents = rankPriorityStudents(data.students).slice(0, 4);
  const nextLesson = data.lessons.filter((lesson) => lesson.status === "待上课").slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];

  return (
    <>
      <SectionHeader
        eyebrow={formatFullDate(nextLesson?.startsAt ?? data.meta.updatedAt)}
        title={`下午好，${data.user.teacherName}`}
        description={`还有 ${summary.openTasks} 件未完成事项，先处理最临近的三件。`}
        actions={!readOnly ? <button type="button" className="button button-soft" onClick={onOpenQuickAdd}><span aria-hidden="true">＋</span> 更新学生情况</button> : undefined}
      />

      <div className="today-grid">
        {nextLesson ? (
          <button type="button" className="next-lesson-card" onClick={() => onOpenLesson(nextLesson.id)}>
            <div className="next-lesson-top"><Pill tone="dark">下一节</Pill><span>{formatFullDate(nextLesson.startsAt)}</span></div>
            <div className="lesson-time-block"><span className="time-large">{formatTime(nextLesson.startsAt)}—{formatTime(nextLesson.endsAt)}</span><span className="time-duration">课前 {nextLesson.reminderMinutesBefore ?? 0} 分钟提醒</span></div>
            <div className="lesson-main-copy">
              <p>{nextLesson.className} · {nextLesson.subject}</p>
              <h2>{nextLesson.title}</h2>
              <span>{nextLesson.room} · 查看备课内容</span>
            </div>
            <div className="lesson-checks">
              <span><i className="check-done">✓</i>{nextLesson.preparation}</span>
            </div>
            <span className="card-arrow" aria-hidden="true">↗</span>
          </button>
        ) : null}

        <section className="card focus-card">
          <div className="card-heading"><div><p className="eyebrow">今天最值得先做</p><h2>收口清单</h2></div><Pill tone="apricot">约 {formatMinutes(focusMinutes)}</Pill></div>
          <div className="focus-list">
            {focusTasks.map((task, index) => (
              <div key={task.id} className="focus-item">
                {!readOnly ? <button type="button" className="task-check" onClick={() => onToggleTask(task.id)} aria-label={`完成${task.title}`}>{index + 1}</button> : <span className="task-check readonly">{index + 1}</span>}
                <button type="button" className="focus-copy" onClick={onGoTasks}><strong>{task.title}</strong><span>{formatDateTime(task.dueAt)} · 约 {formatMinutes(task.estimatedMinutes)}</span></button>
              </div>
            ))}
          </div>
          <button type="button" className="text-button wide" onClick={onGoTasks}>查看全部事项 <span>→</span></button>
        </section>

        <section className="card student-priority-card">
          <div className="card-heading student-priority-heading">
            <div><p className="eyebrow">第二板块 · 学生重点</p><h2>成绩、排名与近期动态</h2><span>按待处理问题和近期变化排序。</span></div>
            <button type="button" className="button button-soft" onClick={onGoStudents}>进入学生看板 →</button>
          </div>
          <div className="student-priority-table">
            <div className="student-priority-head"><span>学生</span><span>最新成绩</span><span>班级排名</span><span>名次变化</span><span>近期问题</span><span>家校协同</span></div>
            {priorityStudents.map(({ student, progress }) => (
              <button type="button" key={student.id} className="student-priority-row" onClick={() => onOpenStudent(student.id)}>
                <span className="priority-student"><Avatar student={student} size="small" /><span><strong>{student.name}</strong><small>{student.className.replace("年级", "")}</small></span></span>
                <strong className="priority-score">{progress.latest?.score ?? "—"}<small>{progress.latest ? ` / ${progress.latest.maxScore}` : ""}</small></strong>
                <strong>{progress.latest ? `第 ${progress.latest.rank} / ${progress.latest.cohortSize}` : "暂无"}</strong>
                <span className={`rank-change ${(progress.rankDelta ?? 0) >= 0 ? "up" : "down"}`}>{formatChange(progress.rankDelta, "名")}</span>
                <span className="priority-issue"><Pill tone={toneForIssue(student.recentIssue?.status)}>{student.recentIssue?.status ?? "暂无"}</Pill><small>{student.recentIssue?.title ?? "暂无近期问题"}</small></span>
                <span className="priority-parent"><small>沟通：{COMMUNICATION_DIFFICULTY_LABELS[student.homeSchool.communicationDifficulty]}</small><small>支持：{SUPPORT_WILLINGNESS_LABELS[student.homeSchool.supportWillingness]}</small></span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function TeachingView({ data, summary, onOpenLesson, onImportLessons, onExportCalendar, readOnly }: { data: WorkbenchData; summary: ReturnType<typeof summarizeWorkbench>; onOpenLesson: (id: string) => void; onImportLessons: () => void; onExportCalendar: () => void; readOnly: boolean }) {
  const weekDates = getWeekDates(data.lessons);
  const timeRows = Array.from(new Set(data.lessons.map((lesson) => lesson.startsAt.slice(11, 16)))).sort();
  const classCount = new Set(data.lessons.map((lesson) => lesson.className)).size;
  const completedLessons = data.lessons.filter((lesson) => lesson.status === "已完成").length;
  const weekLabel = `${Number(weekDates[0].slice(5, 7))}月${Number(weekDates[0].slice(8, 10))}日—${Number(weekDates[4].slice(5, 7))}月${Number(weekDates[4].slice(8, 10))}日`;

  return (
    <>
      <SectionHeader
        eyebrow="本周安排"
        title="教学课表"
        description="按真实课次查看班级、时间、地点、备课内容和课前提醒。"
        actions={!readOnly ? (
          <div className="section-actions">
            <button type="button" className="button button-ghost" onClick={onExportCalendar}>导出日历 (.ics)</button>
            <button type="button" className="button button-soft" onClick={onImportLessons}>＋ 导入课表</button>
          </div>
        ) : undefined}
      />
      <div className="metric-row">
        <div className="metric-card"><span className="metric-icon sage">课</span><p>本周课次<strong>{data.lessons.length}</strong><small>已完成 {completedLessons} 节</small></p></div>
        <div className="metric-card"><span className="metric-icon apricot">班</span><p>任教班级<strong>{classCount}</strong><small>当前档案 {summary.totalStudents} 人</small></p></div>
        <div className="metric-card"><span className="metric-icon blue">今</span><p>当日课次<strong>{summary.lessonsOnDate}</strong><small>以课表记录为准</small></p></div>
        <div className="metric-card"><span className="metric-icon violet">醒</span><p>已设课前提醒<strong>{data.lessons.filter((lesson) => lesson.reminderMinutesBefore !== null).length}</strong><small>打开课次查看详情</small></p></div>
      </div>

      <section className="card schedule-card">
        <div className="schedule-toolbar"><div><span className="date-button static-control">{weekLabel}</span></div><Pill tone="sage">周课表</Pill></div>
        <div className="schedule-table" role="table" aria-label="本周课表">
          <div className="schedule-row schedule-head" role="row"><span role="columnheader">时间</span>{weekDates.map((date) => { const day = new Date(`${date}T12:00:00+08:00`).getUTCDay(); return <span key={date} role="columnheader">{weekdayLabels[day]} {Number(date.slice(8, 10))}</span>; })}</div>
          {timeRows.map((time) => (
            <div className="schedule-row" role="row" key={time}>
              <span className="schedule-time" role="cell">{time}</span>
              {weekDates.map((date) => {
                const lesson = data.lessons.find((item) => item.startsAt.slice(0, 10) === date && item.startsAt.slice(11, 16) === time);
                return lesson ? (
                  <button type="button" role="cell" key={`${date}-${time}`} onClick={() => onOpenLesson(lesson.id)}>
                    <strong>{lesson.className}</strong><small>{lesson.subject} · {lesson.room}</small>
                  </button>
                ) : <span className="schedule-empty" role="cell" key={`${date}-${time}`}>—</span>;
              })}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function StudentsView({
  filteredStudents,
  selectedStudent,
  summary,
  studentQuery,
  studentClass,
  onQuery,
  onClass,
  onSelect,
  onQuickAdd,
  onImportAssessments,
  onParentCommunication,
  onParentSupport,
  readOnly,
}: {
  filteredStudents: StudentRecord[];
  selectedStudent: StudentRecord | null;
  summary: ReturnType<typeof summarizeWorkbench>;
  studentQuery: string;
  studentClass: string;
  onQuery: (value: string) => void;
  onClass: (value: string) => void;
  onSelect: (id: string) => void;
  onQuickAdd: () => void;
  onImportAssessments: () => void;
  onParentCommunication: (value: 1 | 2 | 3 | 4 | 5) => void;
  onParentSupport: (value: 1 | 2 | 3 | 4 | 5) => void;
  readOnly: boolean;
}) {
  const [chartMode, setChartMode] = useState<StudentChartMode>("score");
  const progress = selectedStudent ? getAssessmentChange(selectedStudent) : null;
  const assessments = selectedStudent ? selectedStudent.assessments.slice().sort((a, b) => a.occurredOn.localeCompare(b.occurredOn)) : [];
  const latest = progress?.latest ?? null;
  const classes = Array.from(new Set(filteredStudents.map((student) => student.className)));

  return (
    <>
      <SectionHeader
        eyebrow="成绩、变化与家校协同"
        title="学生档案"
        description="每次测评独立记录，进退步由相邻的已核对测评自动计算。"
        actions={!readOnly ? (
          <div className="section-actions">
            <button type="button" className="button button-ghost" onClick={onImportAssessments}>导入名单与测评</button>
            {selectedStudent ? <button type="button" className="button button-primary" onClick={onQuickAdd}>＋ 更新学生情况</button> : null}
          </div>
        ) : undefined}
      />

      <div className="student-summary-row">
        <div className="summary-chip active"><span>{summary.totalStudents}</span><small>全部学生</small></div>
        <div className="summary-chip"><span>{summary.rankImproved}</span><small>本次排名上升</small></div>
        <div className="summary-chip"><span>{summary.issuesPending}</span><small>近期问题待处理</small></div>
        <div className="summary-chip"><span>{summary.homeSchoolFollowUps}</span><small>家校沟通待推进</small></div>
      </div>

      <div className="students-layout">
        <section className="card student-list-card">
          <div className="list-controls">
            <label className="inline-search"><span aria-hidden="true">⌕</span><input value={studentQuery} onChange={(event) => onQuery(event.target.value)} placeholder="搜索姓名或近期问题" /></label>
            <select value={studentClass} onChange={(event) => onClass(event.target.value)} aria-label="筛选班级">
              <option>全部班级</option>
              {classes.sort().map((className) => <option key={className}>{className}</option>)}
            </select>
          </div>
          <div className="student-list">
            {filteredStudents.map((student) => {
              const change = getAssessmentChange(student);
              return (
                <button type="button" key={student.id} className={selectedStudent.id === student.id ? "active" : ""} onClick={() => onSelect(student.id)}>
                  <Avatar student={student} size="small" />
                  <span><strong>{student.name}</strong><small>{student.className} · {change.latest ? `${change.latest.score}分` : "暂无成绩"}</small></span>
                  <span className={`list-rank-change ${(change.rankDelta ?? 0) >= 0 ? "up" : "down"}`}><strong>{change.latest ? `第${change.latest.rank}` : "—"}</strong><small>{formatChange(change.rankDelta, "")}</small></span>
                </button>
              );
            })}
            {!filteredStudents.length ? <div className="empty-list">没有符合条件的学生</div> : null}
          </div>
        </section>

        {!selectedStudent ? (
          <section className="card student-detail-card student-empty-state">
            <div className="upload-zone">
              <span className="upload-mark">◎</span>
              <h3>{filteredStudents.length === 0 && studentQuery ? "没有符合条件的学生" : "还没有学生档案"}</h3>
              <p>{filteredStudents.length === 0 && studentQuery ? "换个关键词或班级再试。" : "从表格中粘贴名单与测评记录，核对无误后开始建立真实学生档案。"}</p>
              {!readOnly && !(filteredStudents.length === 0 && studentQuery) ? <button type="button" className="button button-primary" onClick={onImportAssessments}>导入名单与测评</button> : null}
            </div>
          </section>
        ) : (
        <section className="card student-detail-card">
          <div className="student-profile-head">
            <Avatar student={selectedStudent} size="large" />
            <div><div className="name-line"><h2>{selectedStudent.name}</h2><Pill tone="sage">{selectedStudent.className}</Pill></div><p>最近一次测评：{latest ? `${latest.title} · ${latest.occurredOn}` : "暂无"}</p></div>
            {!readOnly ? <button type="button" className="button button-soft" onClick={onQuickAdd}>更新成绩或问题</button> : null}
          </div>

          <div className="student-performance-grid">
            <div className="performance-metric"><small>最新成绩 · {latest?.title ?? "暂无"}</small><strong>{latest?.score ?? "—"}<em>{latest ? `/${latest.maxScore}` : ""}</em></strong><span>{latest ? `班级均分 ${latest.classAverage}` : "尚未记录测评"}</span></div>
            <div className="performance-metric"><small>当前班级排名</small><strong>{latest?.rank ?? "—"}<em>{latest ? `/${latest.cohortSize}` : ""}</em></strong><span>{progress.previous ? `上次第 ${progress.previous.rank} 名` : "暂无上次记录"}</span></div>
            <div className={`performance-metric ${(progress.rankDelta ?? 0) >= 0 ? "positive" : "negative"}`}><small>较上次变化</small><strong>{formatChange(progress.rankDelta, "")}<em> 名</em></strong><span>{progress.scoreDelta === null ? "暂无可比测评" : progress.scoreDelta > 0 ? `分数增加 ${progress.scoreDelta} 分` : progress.scoreDelta < 0 ? `分数减少 ${Math.abs(progress.scoreDelta)} 分` : "分数持平"}</span></div>
            <div className="performance-metric issue-metric"><small>近期问题</small><Pill tone={toneForIssue(selectedStudent.recentIssue?.status)}>{selectedStudent.recentIssue?.status ?? "暂无"}</Pill><span>{selectedStudent.recentIssue?.title ?? "当前没有待跟进问题"}</span></div>
          </div>

          <div className="student-dashboard-body">
            <section className="performance-panel">
              <div className="subheading"><div><h3>成绩与排名动态</h3><p>只展示真实保存的测评记录</p></div><div className="segmented-control compact two-options"><button type="button" className={chartMode === "score" ? "active" : ""} onClick={() => setChartMode("score")}>成绩</button><button type="button" className={chartMode === "rank" ? "active" : ""} onClick={() => setChartMode("rank")}>排名</button></div></div>
              <div className="score-chart" aria-label={`最近${assessments.length}次${chartMode === "score" ? "成绩" : "排名"}变化`}>
                {chartMode === "score" && latest ? <div className="average-line" style={{ bottom: `${Math.max(12, Math.min(92, latest.classAverage))}%` }}><span>班均 {latest.classAverage}</span></div> : null}
                {assessments.map((assessment) => {
                  const value = chartMode === "score" ? assessment.score : assessment.rank;
                  const height = chartMode === "score" ? (assessment.score / assessment.maxScore) * 100 : ((assessment.cohortSize - assessment.rank + 1) / assessment.cohortSize) * 100;
                  return <div className="score-column" key={assessment.id}><span className="score-value">{chartMode === "score" ? value : `第${value}`}</span><i style={{ height: `${Math.max(18, height)}%` }} /><small>{assessment.title}</small></div>;
                })}
              </div>
              <div className="exam-table">
                <div><span>测评</span><span>成绩</span><span>班级排名</span><span>变化</span></div>
                {assessments.map((assessment, index) => {
                  const previous = index > 0 ? assessments[index - 1] : null;
                  const scoreChange = previous ? assessment.score - previous.score : null;
                  const rankChange = previous ? previous.rank - assessment.rank : null;
                  return <div key={assessment.id}><strong>{assessment.title}<small>{assessment.occurredOn} · {assessment.source}</small></strong><span>{assessment.score}/{assessment.maxScore}</span><span>第 {assessment.rank} / {assessment.cohortSize}</span><span className={(rankChange ?? 0) >= 0 ? "trend-up" : "trend-down"}>{previous ? `${scoreChange! >= 0 ? "+" : ""}${scoreChange}分 · ${formatChange(rankChange, "名")}` : "首次记录"}</span></div>;
                })}
              </div>
            </section>

            <aside className="student-context-column">
              <section className="recent-issue-card">
                <div className="subheading"><h3>近期问题</h3><Pill tone={toneForIssue(selectedStudent.recentIssue?.status)}>{selectedStudent.recentIssue?.status ?? "暂无"}</Pill></div>
                <p>{selectedStudent.recentIssue?.detail ?? "当前没有待跟进问题。"}</p>
                <div className="issue-next"><small>下一步</small><strong>{selectedStudent.recentIssue?.nextAction ?? "暂无安排"}</strong>{selectedStudent.recentIssue?.followUpOn ? <span>复核日期：{selectedStudent.recentIssue.followUpOn}</span> : null}</div>
              </section>

              <section className="parent-cooperation-card">
                <div className="subheading"><div><h3>家校协同</h3><p>由老师手动选择，可随时更新</p></div></div>
                <div className="rating-block">
                  <div className="rating-title"><span>沟通难度</span><strong>{COMMUNICATION_DIFFICULTY_LABELS[selectedStudent.homeSchool.communicationDifficulty]}</strong></div>
                  <div className="rating-options" role="group" aria-label="家长沟通难度">
                    {COMMUNICATION_DIFFICULTY_LABELS.slice(1).map((label, index) => <button type="button" key={label} disabled={readOnly} className={selectedStudent.homeSchool.communicationDifficulty === index + 1 ? "active" : ""} onClick={() => onParentCommunication((index + 1) as 1 | 2 | 3 | 4 | 5)}><span>{index + 1}</span><small>{label}</small></button>)}
                  </div>
                  <p>{selectedStudent.homeSchool.communicationNote}</p>
                </div>
                <div className="rating-block">
                  <div className="rating-title"><span>家长辅助意愿</span><strong>{SUPPORT_WILLINGNESS_LABELS[selectedStudent.homeSchool.supportWillingness]}</strong></div>
                  <div className="rating-options support" role="group" aria-label="家长辅助意愿">
                    {SUPPORT_WILLINGNESS_LABELS.slice(1).map((label, index) => <button type="button" key={label} disabled={readOnly} className={selectedStudent.homeSchool.supportWillingness === index + 1 ? "active" : ""} onClick={() => onParentSupport((index + 1) as 1 | 2 | 3 | 4 | 5)}><span>{index + 1}</span><small>{label}</small></button>)}
                  </div>
                  <p>{selectedStudent.homeSchool.supportNote}</p>
                </div>
                <div className="rating-note"><span aria-hidden="true">i</span> 评价本次协同过程，不作为家庭的固定标签。</div>
              </section>
            </aside>
          </div>
        </section>
        )}
      </div>
    </>
  );
}

function TasksView({
  tasks,
  allTasks,
  taskSummary,
  taskFilter,
  onFilter,
  onToggleTask,
  onQuickAdd,
  readOnly,
}: {
  tasks: WorkbenchTask[];
  allTasks: WorkbenchTask[];
  taskSummary: ReturnType<typeof summarizeTaskDuration>;
  taskFilter: TaskFilter;
  onFilter: (filter: TaskFilter) => void;
  onToggleTask: (id: string) => void;
  onQuickAdd: () => void;
  readOnly: boolean;
}) {
  const filters: TaskFilter[] = ["全部", "教学", "学生", "行政", "论文"];
  const completionRate = taskSummary.totalMinutes ? Math.round((taskSummary.completedMinutes / taskSummary.totalMinutes) * 100) : 0;
  return (
    <>
      <SectionHeader
        eyebrow="所有工作回到一条时间线"
        title="事项中心"
        description="教学、学生、行政和论文事项统一按截止时间查看。"
        actions={!readOnly ? <button type="button" className="button button-primary" onClick={onQuickAdd}>＋ 新建事项</button> : undefined}
      />
      <div className="tasks-layout">
        <section className="card tasks-main-card">
          <div className="tasks-toolbar">
            <div className="filter-chips">{filters.map((filter) => <button key={filter} type="button" className={taskFilter === filter ? "active" : ""} onClick={() => onFilter(filter)}>{filter}{filter === "全部" ? <span>{allTasks.length}</span> : null}</button>)}</div>
            <span className="sort-label">已按截止时间排列</span>
          </div>
          <div className="task-list-full">
            {tasks.map((task) => {
              const done = task.status === "已完成";
              return (
                <article key={task.id} className={done ? "done" : ""}>
                  {!readOnly ? <button type="button" className="round-check" onClick={() => onToggleTask(task.id)} aria-label={`${done ? "恢复" : "完成"}${task.title}`}>{done ? "✓" : ""}</button> : <span className="round-check readonly">{done ? "✓" : ""}</span>}
                  <div className="task-body">
                    <div className="task-title-line"><Pill tone={toneForTask(task.category)}>{task.category}</Pill><Pill tone={done ? "sage" : task.status === "进行中" ? "blue" : "neutral"}>{task.status}</Pill></div>
                    <h3>{task.title}</h3>
                    <p><span>截止 {formatDateTime(task.dueAt)}</span><span>预计 {formatMinutes(task.estimatedMinutes)}</span><span>{task.relatedLabel ?? "未关联对象"}</span>{task.reminderAt ? <span>提醒 {formatDateTime(task.reminderAt)}</span> : null}</p>
                  </div>
                </article>
              );
            })}
            {!tasks.length ? <div className="empty-list">当前筛选下没有事项</div> : null}
          </div>
        </section>
        <aside className="tasks-aside">
          <section className="card workload-card"><p className="eyebrow">当前待办</p><h2>{taskSummary.openTaskCount} 件 · {formatMinutes(taskSummary.openMinutes)}</h2><p>所有时长都由未完成事项的预计用时相加得出。</p><div className="load-bar"><i style={{ width: `${completionRate}%` }} /></div><div className="load-legend"><span><i className="filled" />已完成 {formatMinutes(taskSummary.completedMinutes)}</span><span><i />待完成 {formatMinutes(taskSummary.openMinutes)}</span></div></section>
          <section className="card workload-card"><p className="eyebrow">按类别预计</p>{(["教学", "学生", "行政", "论文"] as TaskCategory[]).map((category) => <div className="category-duration" key={category}><span>{category}</span><strong>{formatMinutes(taskSummary.byCategory[category])}</strong></div>)}</section>
        </aside>
      </div>
    </>
  );
}

function ResourcesView({ resources }: { resources: WorkbenchData["resources"] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("全部");
  const filters = ["全部", ...Array.from(new Set(resources.map((resource) => resource.kind)))];
  const visible = resources.filter((resource) => {
    const matchesKind = kind === "全部" || resource.kind === kind;
    const matchesQuery = !query.trim() || `${resource.title}${resource.subject}${resource.gradeOrClass}${resource.location}`.includes(query.trim());
    return matchesKind && matchesQuery;
  });
  return (
    <>
      <SectionHeader eyebrow="一次整理，持续复用" title="教学资料" description="在已经整理好的教案、课件、练习、模板和参考资料中快速查找。" />
      <div className="resource-toolbar card"><label className="inline-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料名称、学科或班级" /></label><div className="filter-chips">{filters.map((filter) => <button type="button" key={filter} className={kind === filter ? "active" : ""} onClick={() => setKind(filter)}>{filter}</button>)}</div></div>
      <div className="resource-grid">
        {visible.map((resource, index) => <article className="resource-card card" key={resource.id}><span className={`file-mark ${["sage", "apricot", "blue", "violet", "rose"][index % 5]}`}>{resource.kind.slice(0, 1)}</span><span><Pill tone="sage">{resource.kind}</Pill><strong>{resource.title}</strong><small>{resource.gradeOrClass} · {resource.subject}</small><small>{resource.location}</small></span></article>)}
        {!visible.length ? <div className="empty-list card">没有找到符合条件的资料</div> : null}
      </div>
    </>
  );
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button></header>
        {children}
      </section>
    </div>
  );
}

function StudentUpdateModal({ student, defaultDate, onClose, onSave }: { student: StudentRecord; defaultDate: string; onClose: () => void; onSave: (input: StudentUpdateInput) => boolean }) {
  const [kind, setKind] = useState<"assessment" | "issue" | "homeSchool">("assessment");
  const [error, setError] = useState("");
  const progress = getAssessmentChange(student);
  const latest = progress.latest;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    if (kind === "assessment") {
      const maxScore = Number(form.get("maxScore"));
      const score = Number(form.get("score"));
      const rank = Number(form.get("rank"));
      const cohortSize = Number(form.get("cohortSize"));
      const classAverage = Number(form.get("classAverage"));
      if (!Number.isFinite(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) return setError("请检查成绩与满分：成绩应在 0 到满分之间。");
      if (!Number.isInteger(rank) || !Number.isInteger(cohortSize) || rank < 1 || rank > cohortSize) return setError("请检查排名与参考人数：排名不能大于参考人数。");
      if (classAverage < 0 || classAverage > maxScore) return setError("班级均分应在 0 到满分之间。");
      onSave({
        kind,
        studentId: student.id,
        record: {
          title: String(form.get("title") ?? "").trim(),
          subject: String(form.get("subject") ?? "").trim(),
          occurredOn: String(form.get("occurredOn") ?? ""),
          maxScore,
          score,
          rank,
          cohortSize,
          classAverage,
          status: String(form.get("status")) === "待核对" ? "待核对" : "已核对",
          source: String(form.get("source")) as AssessmentSource,
        },
      });
    } else if (kind === "issue") {
      const title = String(form.get("issueTitle") ?? "").trim();
      const detail = String(form.get("detail") ?? "").trim();
      const nextAction = String(form.get("nextAction") ?? "").trim();
      if (!title || !detail || !nextAction) return setError("请填写问题标题、具体情况和下一步。");
      onSave({
        kind,
        studentId: student.id,
        title,
        detail,
        status: String(form.get("issueStatus")) as StudentIssueStatus,
        observedOn: String(form.get("observedOn") ?? ""),
        nextAction,
        followUpOn: String(form.get("followUpOn") ?? "") || undefined,
      });
    } else {
      const communicationNote = String(form.get("communicationNote") ?? "").trim();
      const supportNote = String(form.get("supportNote") ?? "").trim();
      if (!communicationNote || !supportNote) return setError("请分别补充沟通情况和家庭辅助情况。");
      onSave({
        kind,
        studentId: student.id,
        communicationDifficulty: Number(form.get("communicationDifficulty")) as 1 | 2 | 3 | 4 | 5,
        communicationNote,
        supportWillingness: Number(form.get("supportWillingness")) as 1 | 2 | 3 | 4 | 5,
        supportNote,
      });
    }
  }

  return (
    <Modal title={`更新 ${student.name} 的情况`} subtitle="保存后，首页、学生看板和汇总数字会同步变化。" onClose={onClose} wide>
      <form className="quick-form" onSubmit={submit}>
        <div className="record-type-tabs" role="tablist" aria-label="更新类型">
          <button type="button" className={kind === "assessment" ? "active" : ""} onClick={() => setKind("assessment")}>成绩与排名</button>
          <button type="button" className={kind === "issue" ? "active" : ""} onClick={() => setKind("issue")}>近期问题</button>
          <button type="button" className={kind === "homeSchool" ? "active" : ""} onClick={() => setKind("homeSchool")}>家校协同</button>
        </div>

        {kind === "assessment" ? (
          <div className="form-grid">
            <label>测评名称<input name="title" required defaultValue="随堂测" /></label>
            <label>测评日期<input name="occurredOn" type="date" required defaultValue={defaultDate} /></label>
            <label>学科<input name="subject" required defaultValue={latest?.subject ?? "语文"} /></label>
            <label>满分<input name="maxScore" type="number" min="1" required defaultValue={latest?.maxScore ?? 100} /></label>
            <label>成绩<input name="score" type="number" min="0" step="0.5" required defaultValue={latest?.score ?? 0} /></label>
            <label>班级排名<input name="rank" type="number" min="1" required defaultValue={latest?.rank ?? 1} /></label>
            <label>参考人数<input name="cohortSize" type="number" min="1" required defaultValue={latest?.cohortSize ?? 1} /></label>
            <label>班级均分<input name="classAverage" type="number" min="0" step="0.1" required defaultValue={latest?.classAverage ?? 0} /></label>
            <label>记录来源<select name="source" defaultValue="手工录入"><option>手工录入</option><option>表格导入</option><option>图片识别</option></select></label>
            <label>核对状态<select name="status" defaultValue="已核对"><option>已核对</option><option>待核对</option></select></label>
          </div>
        ) : null}

        {kind === "issue" ? (
          <div className="form-grid">
            <label className="full-field">问题标题<input name="issueTitle" required defaultValue={student.recentIssue?.title ?? ""} /></label>
            <label>发现日期<input name="observedOn" type="date" required defaultValue={student.recentIssue?.observedOn ?? defaultDate} /></label>
            <label>处理状态<select name="issueStatus" defaultValue={student.recentIssue?.status ?? "待处理"}><option>待处理</option><option>观察中</option><option>已缓解</option></select></label>
            <label className="full-field">具体情况<textarea name="detail" required defaultValue={student.recentIssue?.detail ?? ""} /></label>
            <label className="full-field">下一步<textarea name="nextAction" required defaultValue={student.recentIssue?.nextAction ?? ""} /></label>
            <label>复核日期<input name="followUpOn" type="date" defaultValue={student.recentIssue?.followUpOn ?? ""} /></label>
          </div>
        ) : null}

        {kind === "homeSchool" ? (
          <div className="form-grid">
            <label>沟通难度<select name="communicationDifficulty" defaultValue={student.homeSchool.communicationDifficulty}>{COMMUNICATION_DIFFICULTY_LABELS.slice(1).map((label, index) => <option value={index + 1} key={label}>{index + 1} · {label}</option>)}</select></label>
            <label>家长辅助意愿<select name="supportWillingness" defaultValue={student.homeSchool.supportWillingness}>{SUPPORT_WILLINGNESS_LABELS.slice(1).map((label, index) => <option value={index + 1} key={label}>{index + 1} · {label}</option>)}</select></label>
            <label className="full-field">沟通情况<textarea name="communicationNote" required defaultValue={student.homeSchool.communicationNote} /></label>
            <label className="full-field">家庭辅助情况<textarea name="supportNote" required defaultValue={student.homeSchool.supportNote} /></label>
          </div>
        ) : null}

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <p className="form-note"><span aria-hidden="true">i</span> 家校等级由老师手动选择，只描述当前协同情况。</p>
        <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>取消</button><button type="submit" className="button button-primary">保存更新</button></div>
      </form>
    </Modal>
  );
}

function NewTaskModal({ demoMode, onClose, onSave }: { demoMode: boolean; onClose: () => void; onSave: (input: NewTaskInput) => boolean }) {
  const [error, setError] = useState("");
  const defaultDue = demoMode ? "2026-09-17T18:00" : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const dueAt = localInputToIso(String(form.get("dueAt") ?? ""));
    const estimatedMinutes = Number(form.get("estimatedMinutes"));
    const reminderValue = String(form.get("reminderAt") ?? "");
    if (!title || !dueAt) return setError("请填写事项标题和截止时间。");
    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 1440) return setError("预计用时请填写 1 到 1440 分钟。");
    if (reminderValue && reminderValue >= String(form.get("dueAt"))) return setError("提醒时间应早于截止时间。");
    onSave({
      category: String(form.get("category")) as TaskCategory,
      title,
      dueAt,
      estimatedMinutes,
      relatedLabel: String(form.get("relatedLabel") ?? "").trim() || undefined,
      reminderAt: reminderValue ? localInputToIso(reminderValue) : null,
    });
  }

  return (
    <Modal title="新建事项" subtitle="教学、学生、行政和论文任务都使用同一组时间与提醒规则。" onClose={onClose}>
      <form className="quick-form" onSubmit={submit}>
        <label>类别<select name="category" defaultValue="教学"><option>教学</option><option>学生</option><option>行政</option><option>论文</option></select></label>
        <label>事项标题<input name="title" required placeholder="例如：核对八4阅读问题单" /></label>
        <div className="form-grid">
          <label>截止时间<input name="dueAt" type="datetime-local" required defaultValue={defaultDue} /></label>
          <label>预计用时（分钟）<input name="estimatedMinutes" type="number" min="1" max="1440" required defaultValue="30" /></label>
          <label>提醒时间<input name="reminderAt" type="datetime-local" /></label>
          <label>关联学生或班级<input name="relatedLabel" placeholder="可选" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>取消</button><button type="submit" className="button button-primary">保存事项</button></div>
      </form>
    </Modal>
  );
}

function LessonModal({ lesson, onClose }: { lesson: LessonSession; onClose: () => void }) {
  return (
    <Modal title={`${lesson.className} · ${lesson.subject}`} subtitle={`${formatFullDate(lesson.startsAt)} ${formatTime(lesson.startsAt)}—${formatTime(lesson.endsAt)} · ${lesson.room}`} onClose={onClose} wide>
      <div className="lesson-readonly-detail">
        <div className="lesson-status-line"><Pill tone={lesson.status === "已完成" ? "sage" : "blue"}>{lesson.status}</Pill><span>{lesson.reminderMinutesBefore === null ? "未设置课前提醒" : `课前 ${lesson.reminderMinutesBefore} 分钟提醒`}</span></div>
        <section className="modal-section"><p className="eyebrow">本次内容</p><h3>{lesson.title}</h3></section>
        <section className="modal-section"><p className="eyebrow">备课清单</p><p>{lesson.preparation}</p></section>
      </div>
      <div className="modal-actions"><button type="button" className="button button-primary" onClick={onClose}>关闭</button></div>
    </Modal>
  );
}

function MobileUpdateModal({ data, complete, content, localDate, onClose, onUpdate, onPreview }: { data: WorkbenchData; complete: boolean; content: MobileReadOnlySnapshot | null; localDate: string; onClose: () => void; onUpdate: () => void; onPreview: () => void }) {
  const summary = summarizeWorkbench(data, localDate);
  return (
    <Modal title="更新手机看板" subtitle={content ? `手机当前内容更新于 ${formatDateTime(content.generatedAt)}` : "手机看板还没有内容"} onClose={onClose} wide>
      {!complete ? (
        <div className="publish-preview">
          <div className="snapshot-summary"><div><p className="eyebrow">本次更新内容</p><h3>老师选择过的摘要内容</h3><span>手机只用于查看，不能新增、修改或删除。</span></div><Pill tone="sage">仅供查看</Pill></div>
          <div className="preview-columns"><div><small>学生</small><strong>{Math.min(5, data.students.length)} 名重点学生</strong><strong>最新成绩与排名</strong><strong>近期问题状态</strong></div><div><small>课表与事项</small><strong>{data.lessons.filter((lesson) => lesson.status === "待上课").length} 节待上课课次</strong><strong>{summary.openTasks} 件未完成事项</strong><strong>不包含附件原文件</strong></div></div>
          <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>取消</button><button type="button" className="button button-primary" onClick={onUpdate}>确认更新</button></div>
        </div>
      ) : (
        <div className="success-state publish-success"><span className="success-mark">✓</span><h3>手机看板已更新</h3><p>手机刷新后即可看到新内容，仍然只能查看。</p><div className="success-buttons"><button type="button" className="button button-ghost" onClick={onClose}>完成</button><button type="button" className="button button-primary" onClick={onPreview}>查看手机内容</button></div></div>
      )}
    </Modal>
  );
}

function MobilePreview({ content, onClose }: { content: MobileReadOnlySnapshot | null; onClose: () => void }) {
  return (
    <div className="mobile-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="phone-demo-wrap" role="dialog" aria-modal="true" aria-label="手机内容预览" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="phone-close" onClick={onClose}>关闭预览 ×</button>
        <div className="phone-frame">
          <div className="phone-status"><span>16:48</span><span>◒ 5G ▰</span></div>
          <header><span className="brand-mark">禾</span><span><strong>{content?.workbenchName ?? "教师个人工作台"}</strong><small>仅供查看 · {content ? formatDateTime(content.generatedAt) : "尚未更新"}</small></span></header>
          <main>
            <section className="phone-hero"><Pill tone="dark">手机看板</Pill><h2>{content ? `还有 ${content.summary.openTasks} 件事\n需要关注` : "还没有可查看的内容"}</h2><p>修改请回到电脑工作台。</p></section>
            {content ? <><section><div className="phone-section-head"><h3>最近事项</h3><span>{content.openTasks.length} 件</span></div>{content.openTasks.slice(0, 3).map((task) => <div className="phone-task" key={task.id}><span className={`phone-task-dot ${task.category}`} /><span><strong>{task.title}</strong><small>{formatDateTime(task.dueAt)} · {task.relatedLabel ?? "未关联"}</small></span></div>)}</section><section><div className="phone-section-head"><h3>学生待跟进</h3><span>{content.priorityStudents.length} 人</span></div><div className="phone-students">{content.priorityStudents.slice(0, 4).map((student) => <span key={student.id}><span className="avatar avatar-sage avatar-small">{student.name.slice(-2)}</span><small>{student.name}</small></span>)}</div></section></> : null}
          </main>
          <div className="phone-static-nav"><span>今日</span><span>学生</span><span>课表</span><span>事项</span></div>
        </div>
        <div className="phone-preview-note"><strong>手机没有编辑入口</strong><p>这里只展示电脑端最近一次更新的内容。</p></div>
      </div>
    </div>
  );
}

function MobileReadOnlyWorkbench({ content }: { content: MobileReadOnlySnapshot }) {
  const [section, setSection] = useState<"today" | "students" | "teaching" | "tasks">("today");
  const [query, setQuery] = useState("");
  const normalized = query.trim();
  const students = content.priorityStudents.filter((student) => `${student.name}${student.className}${student.issueTitle ?? ""}`.includes(normalized));
  const lessons = content.upcomingLessons.filter((lesson) => `${lesson.title}${lesson.className}${lesson.subject}${lesson.room}`.includes(normalized));
  const tasks = content.openTasks.filter((task) => `${task.title}${task.category}${task.relatedLabel ?? ""}`.includes(normalized));
  return (
    <div className="mobile-readonly-workbench">
      <header className="mobile-readonly-header"><span className="brand-mark">禾</span><span><strong>{content.workbenchName}</strong><small>手机查看版 · 更新于 {formatDateTime(content.generatedAt)}</small></span><Pill tone="sage">仅供查看</Pill></header>
      <label className="mobile-readonly-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学生、课次或事项" /></label>
      {normalized ? (
        <section className="mobile-search-panel"><h2>搜索结果</h2>{students.map((student) => <button type="button" key={student.id} onClick={() => { setSection("students"); setQuery(""); }}><Pill tone="sage">学生</Pill><span><strong>{student.name}</strong><small>{student.className} · {student.issueTitle ?? "暂无近期问题"}</small></span></button>)}{lessons.map((lesson) => <button type="button" key={lesson.id} onClick={() => { setSection("teaching"); setQuery(""); }}><Pill tone="blue">课次</Pill><span><strong>{lesson.title}</strong><small>{lesson.className} · {formatDateTime(lesson.startsAt)}</small></span></button>)}{tasks.map((task) => <button type="button" key={task.id} onClick={() => { setSection("tasks"); setQuery(""); }}><Pill tone="apricot">事项</Pill><span><strong>{task.title}</strong><small>{formatDateTime(task.dueAt)}</small></span></button>)}{!students.length && !lessons.length && !tasks.length ? <p>没有找到相关内容</p> : null}</section>
      ) : (
        <main className="mobile-readonly-content">
          {section === "today" ? <><SectionHeader eyebrow="今日概览" title={`还有 ${content.summary.openTasks} 件事`} description={`预计需要 ${formatMinutes(content.summary.openTaskMinutes)}，手机仅供查询查看。`} /><div className="mobile-summary-grid"><div><small>重点学生</small><strong>{content.priorityStudents.length}</strong></div><div><small>待上课</small><strong>{content.upcomingLessons.length}</strong></div><div><small>近期问题</small><strong>{content.summary.issuesPending}</strong></div></div><section className="mobile-content-card"><h2>最近事项</h2>{content.openTasks.slice(0, 4).map((task) => <article key={task.id}><Pill tone={toneForTask(task.category)}>{task.category}</Pill><strong>{task.title}</strong><small>{formatDateTime(task.dueAt)} · {task.relatedLabel ?? "未关联"}</small></article>)}</section></> : null}
          {section === "students" ? <><SectionHeader eyebrow="重点关注" title="学生动态" description="查看最新成绩、排名变化和近期问题。" /><section className="mobile-content-card">{content.priorityStudents.map((student) => <article key={student.id}><div className="mobile-student-title"><span className="avatar avatar-sage avatar-small">{student.name.slice(-2)}</span><span><strong>{student.name}</strong><small>{student.className}</small></span></div><div className="mobile-student-metrics"><span><small>成绩</small><strong>{student.latestScore ?? "—"}/{student.latestMaxScore ?? "—"}</strong></span><span><small>排名</small><strong>{student.currentRank ? `第${student.currentRank}` : "—"}</strong></span><span><small>变化</small><strong>{formatChange(student.rankDelta, "名")}</strong></span></div><p>{student.issueStatus ?? "暂无"} · {student.issueTitle ?? "当前没有待跟进问题"}</p></article>)}</section></> : null}
          {section === "teaching" ? <><SectionHeader eyebrow="接下来" title="课表" description="查看时间、班级、地点与备课清单。" /><section className="mobile-content-card">{content.upcomingLessons.map((lesson) => <article key={lesson.id}><Pill tone="blue">{lesson.subject}</Pill><strong>{lesson.title}</strong><small>{formatDateTime(lesson.startsAt)}—{formatTime(lesson.endsAt)}</small><small>{lesson.className} · {lesson.room}</small><p>{lesson.preparation}</p></article>)}</section></> : null}
          {section === "tasks" ? <><SectionHeader eyebrow="按截止时间" title="事项" description="完成和修改请回到电脑。" /><section className="mobile-content-card">{content.openTasks.map((task) => <article key={task.id}><Pill tone={toneForTask(task.category)}>{task.category}</Pill><strong>{task.title}</strong><small>{formatDateTime(task.dueAt)} · 约 {formatMinutes(task.estimatedMinutes)}</small><small>{task.relatedLabel ?? "未关联"}</small></article>)}</section></> : null}
        </main>
      )}
      <nav className="mobile-readonly-nav" aria-label="手机查看导航"><button type="button" className={section === "today" ? "active" : ""} onClick={() => setSection("today")}><span>⌂</span><small>今日</small></button><button type="button" className={section === "students" ? "active" : ""} onClick={() => setSection("students")}><span>◎</span><small>学生</small></button><button type="button" className={section === "teaching" ? "active" : ""} onClick={() => setSection("teaching")}><span>▦</span><small>课表</small></button><button type="button" className={section === "tasks" ? "active" : ""} onClick={() => setSection("tasks")}><span>✓</span><small>事项</small></button></nav>
    </div>
  );
}

const ASSESSMENT_IMPORT_HINT = "姓名,班级,测评,日期,满分,成绩,排名,参考人数,班级均分";
const ASSESSMENT_IMPORT_EXAMPLE = "王小明,八年级1班,单元三,2026-10-12,100,87,6,45,79.5";
const LESSON_IMPORT_HINT = "标题,学科,班级,日期,开始,结束,地点,备课,提醒分钟";
const LESSON_IMPORT_EXAMPLE = "说明文阅读,语文,八年级1班,2026-10-13,08:55,09:40,教学楼 401,阅读材料,10";

function ImportModal({
  kind,
  data,
  onClose,
  onConfirmAssessments,
  onConfirmLessons,
}: {
  kind: "assessments" | "lessons";
  data: WorkbenchData;
  onClose: () => void;
  onConfirmAssessments: (plan: AssessmentImportPlan) => boolean;
  onConfirmLessons: (plan: LessonImportPlan) => boolean;
}) {
  const isAssessment = kind === "assessments";
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [text, setText] = useState("");
  const [assessmentPlan, setAssessmentPlan] = useState<AssessmentImportPlan | null>(null);
  const [lessonPlan, setLessonPlan] = useState<LessonImportPlan | null>(null);

  function parse() {
    if (isAssessment) {
      setAssessmentPlan(planAssessmentImport(text, data.students, { defaultSubject: data.user.subjects[0] ?? "语文" }));
      setLessonPlan(null);
    } else {
      setLessonPlan(planLessonImport(text, data.lessons));
      setAssessmentPlan(null);
    }
    setStep("review");
  }

  const issues = assessmentPlan?.issues ?? lessonPlan?.issues ?? [];
  const validCount = assessmentPlan?.entries.length ?? lessonPlan?.entries.length ?? 0;

  function confirm() {
    if (assessmentPlan && assessmentPlan.entries.length) onConfirmAssessments(assessmentPlan);
    else if (lessonPlan && lessonPlan.entries.length) onConfirmLessons(lessonPlan);
  }

  return (
    <Modal
      title={isAssessment ? "导入名单与测评" : "导入课表"}
      subtitle="粘贴表格内容，先核对再保存；导入失败的行不会影响现有数据。"
      onClose={onClose}
      wide
    >
      <div className="stepper" aria-label="导入步骤">
        <span className={step === "paste" ? "active" : ""}><i>1</i> 粘贴内容</span>
        <b />
        <span className={step === "review" ? "active" : ""}><i>2</i> 核对并保存</span>
      </div>

      {step === "paste" ? (
        <div className="import-paste">
          <p className="form-note"><span aria-hidden="true">i</span> 从 Excel 或表格中复制后直接粘贴，首行可以是表头。列顺序：{isAssessment ? ASSESSMENT_IMPORT_HINT : LESSON_IMPORT_HINT}</p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`${isAssessment ? ASSESSMENT_IMPORT_HINT : LESSON_IMPORT_HINT}\n${isAssessment ? ASSESSMENT_IMPORT_EXAMPLE : LESSON_IMPORT_EXAMPLE}`}
            aria-label="粘贴表格内容"
          />
          <div className="modal-actions">
            <button type="button" className="button button-ghost" onClick={onClose}>取消</button>
            <button type="button" className="button button-primary" disabled={!text.trim()} onClick={parse}>读取内容</button>
          </div>
        </div>
      ) : (
        <div className="import-review">
          <div className="review-banner">
            <span>✓</span>
            <div>
              <strong>识别到 {validCount} 条可导入记录{assessmentPlan?.newStudentCount ? `，其中 ${assessmentPlan.newStudentCount} 名新学生` : ""}</strong>
              <small>{issues.length ? `另有 ${issues.length} 行需要修正后才能导入` : "所有行都通过了检查"}</small>
            </div>
          </div>

          {issues.length ? (
            <div className="import-issues" role="alert">
              {issues.slice(0, 8).map((issue, index) => (
                <p key={`${issue.rowNumber}-${index}`}><strong>第 {issue.rowNumber} 行 · {issue.field}</strong>{issue.message}</p>
              ))}
              {issues.length > 8 ? <p><strong>…</strong>其余 {issues.length - 8} 行问题请在表格中一并修正。</p> : null}
            </div>
          ) : null}

          {validCount ? (
            <div className="import-preview-list">
              {assessmentPlan
                ? assessmentPlan.entries.slice(0, 5).map((entry, index) => (
                  <div key={`${entry.studentName}-${index}`} className="import-preview-row">
                    {entry.isNewStudent ? <Pill tone="blue">新学生</Pill> : <Pill tone="sage">已有学生</Pill>}
                    <span><strong>{entry.studentName}</strong><small>{entry.className}</small></span>
                    <span><strong>{entry.record.title}</strong><small>{entry.record.occurredOn}</small></span>
                    <span><strong>{entry.record.score}/{entry.record.maxScore}</strong><small>第 {entry.record.rank} / {entry.record.cohortSize}</small></span>
                    <Pill tone="apricot">待核对</Pill>
                  </div>
                ))
                : lessonPlan?.entries.slice(0, 5).map((entry, index) => (
                  <div key={`${entry.record.title}-${index}`} className="import-preview-row">
                    <Pill tone="blue">{entry.record.subject}</Pill>
                    <span><strong>{entry.record.title}</strong><small>{entry.record.className}</small></span>
                    <span><strong>{entry.record.startsAt.slice(0, 10)}</strong><small>{entry.record.startsAt.slice(11, 16)}—{entry.record.endsAt.slice(11, 16)}</small></span>
                    <span><strong>{entry.record.room}</strong><small>{entry.record.reminderMinutesBefore === null ? "不设提醒" : `课前 ${entry.record.reminderMinutesBefore} 分钟`}</small></span>
                  </div>
                ))}
              {validCount > 5 ? <p className="import-more">… 其余 {validCount - 5} 条同样按此格式保存。</p> : null}
            </div>
          ) : null}

          <p className="form-note"><span aria-hidden="true">i</span> 保存后{isAssessment ? "新测评标记为“待核对”，核对后才会计入进退步" : "新课次会进入本周课表与提醒"}；重复或越界的行不会被保存。</p>
          <div className="modal-actions">
            <button type="button" className="button button-ghost" onClick={() => setStep("paste")}>返回修改</button>
            <button type="button" className="button button-primary" disabled={!validCount} onClick={confirm}>确认导入 {validCount} 条</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DataManageModal({
  data,
  onClose,
  onExportData,
  onExportCalendar,
  onRestoreFile,
  onRestoreBackup,
  onClearDemo,
  onEnableNotifications,
}: {
  data: WorkbenchData;
  onClose: () => void;
  onExportData: () => void;
  onExportCalendar: () => void;
  onRestoreFile: (text: string, sourceLabel: string) => boolean;
  onRestoreBackup: (entry: WorkbenchBackupEntry) => boolean;
  onClearDemo: () => boolean;
  onEnableNotifications: () => void;
}) {
  const [backups] = useState<WorkbenchBackupEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return listDeviceLocalBackups(window.localStorage);
    } catch {
      return [];
    }
  });
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string; students: number; lessons: number; tasks: number } | null>(null);
  const [fileError, setFileError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  function pickFile(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setFileError("");
    setPendingFile(null);
    if (!file) return;
    void file.text().then((text) => {
      try {
        const result = parseWorkbenchImportText(text, new Date().toISOString());
        setPendingFile({
          name: file.name,
          text,
          students: result.data.students.length,
          lessons: result.data.lessons.length,
          tasks: result.data.tasks.length,
        });
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "文件无法识别。");
      }
    });
    input.value = "";
  }

  return (
    <Modal title="数据与备份" subtitle="数据保存在此设备的浏览器中，建议定期导出文件留档。" onClose={onClose} wide>
      <div className="data-manage">
        <section className="data-section">
          <div className="data-section-head"><h3>导出留档</h3><p>导出后可以拷贝到其他设备，或交给系统日历使用。</p></div>
          <div className="data-actions-row">
            <button type="button" className="button button-soft" onClick={onExportData}>导出数据文件 (.json)</button>
            <button type="button" className="button button-ghost" onClick={onExportCalendar}>导出日历 (.ics)</button>
          </div>
        </section>

        <section className="data-section">
          <div className="data-section-head"><h3>从文件恢复</h3><p>选择之前导出的数据文件，恢复前会先显示内容确认。</p></div>
          <div className="data-actions-row">
            <label className="button button-soft file-button">选择数据文件<input type="file" accept="application/json,.json" onChange={pickFile} /></label>
          </div>
          {fileError ? <p className="form-error" role="alert">{fileError}</p> : null}
          {pendingFile ? (
            <div className="restore-preview">
              <p><strong>{pendingFile.name}</strong></p>
              <p>包含 {pendingFile.students} 名学生、{pendingFile.lessons} 节课次、{pendingFile.tasks} 件事项。恢复会覆盖当前工作区，当前版本会自动存入备份。</p>
              <div className="data-actions-row">
                <button type="button" className="button button-primary" onClick={() => { if (onRestoreFile(pendingFile.text, pendingFile.name)) setPendingFile(null); }}>确认恢复</button>
                <button type="button" className="button button-ghost" onClick={() => setPendingFile(null)}>取消</button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="data-section">
          <div className="data-section-head"><h3>本机自动备份</h3><p>每次保存前自动保留上一版本，最多保留 3 份。</p></div>
          {backups.length ? (
            <div className="backup-list">
              {backups.map((entry) => (
                <div key={`${entry.savedAt}-${entry.revision}`} className="backup-row">
                  <span><strong>{formatDateTime(entry.savedAt)}</strong><small>第 {entry.revision} 版</small></span>
                  <button type="button" className="button button-ghost" onClick={() => onRestoreBackup(entry)}>恢复此版本</button>
                </div>
              ))}
            </div>
          ) : <p className="data-empty">还没有自动备份，保存一次修改后就会出现。</p>}
        </section>

        <section className="data-section">
          <div className="data-section-head"><h3>提醒</h3><p>页面打开时会弹出课次与事项提醒，也可以交给系统通知。</p></div>
          <div className="data-actions-row">
            <button type="button" className="button button-soft" onClick={onEnableNotifications}>开启系统通知</button>
          </div>
        </section>

        {data.meta.containsDemoData ? (
          <section className="data-section danger">
            <div className="data-section-head"><h3>清除演示数据</h3><p>开始使用真实数据前，先清空虚构的学生、课次、事项和资料。</p></div>
            {!confirmClear ? (
              <div className="data-actions-row">
                <button type="button" className="button button-ghost" onClick={() => setConfirmClear(true)}>我要清除演示数据…</button>
              </div>
            ) : (
              <div className="restore-preview danger-zone">
                <p><strong>清除后将得到一本空白工作台</strong></p>
                <p>学生、课次、事项和资料都会被清空，老师信息与工作台名称保留。当前版本会自动存入备份，可以随时恢复。</p>
                <div className="data-actions-row">
                  <button type="button" className="button button-primary" onClick={onClearDemo}>确认清除</button>
                  <button type="button" className="button button-ghost" onClick={() => setConfirmClear(false)}>再想想</button>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function SettingsModal({ data, onClose, onSave }: { data: WorkbenchData; onClose: () => void; onSave: (input: { workbenchName: string; teacherName: string; roleLabel: string; schoolStage: SchoolStage; subjects: string[]; avatarMark: string }) => boolean }) {
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const workbenchName = String(form.get("workbenchName") ?? "").trim();
    const teacherName = String(form.get("teacherName") ?? "").trim();
    const roleLabel = String(form.get("roleLabel") ?? "").trim();
    const subjects = String(form.get("subjects") ?? "").split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!workbenchName || !teacherName) return setError("请填写工作台名称和老师称呼。");
    if (!subjects.length) return setError("请至少填写一个任教学科。");
    onSave({
      workbenchName,
      teacherName,
      roleLabel: roleLabel || `${String(form.get("schoolStage"))}教师`,
      schoolStage: String(form.get("schoolStage")) as SchoolStage,
      subjects,
      avatarMark: String(form.get("avatarMark") ?? "").trim(),
    });
  }

  return (
    <Modal title="工作台设置" subtitle="这些信息只保存在此设备上，用于界面展示与导出文件。" onClose={onClose}>
      <form className="quick-form" onSubmit={submit}>
        <label>工作台名称<input name="workbenchName" required defaultValue={data.user.workbenchName} /></label>
        <div className="form-grid">
          <label>老师称呼<input name="teacherName" required defaultValue={data.user.teacherName} /></label>
          <label>身份说明<input name="roleLabel" defaultValue={data.user.roleLabel} placeholder="例如：初中语文教师 · 班主任" /></label>
          <label>学段<select name="schoolStage" defaultValue={data.user.schoolStage}><option>小学</option><option>初中</option><option>高中</option><option>教培</option></select></label>
          <label>任教学科<input name="subjects" required defaultValue={data.user.subjects.join("、")} placeholder="例如：语文、班会" /></label>
          <label>形象标记<input name="avatarMark" maxLength={2} defaultValue={data.user.appearance.avatarMark} placeholder="一个字" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>取消</button><button type="submit" className="button button-primary">保存设置</button></div>
      </form>
    </Modal>
  );
}

/* 首装向导的内联插图：线描风格，松柏绿主色 + 杏色点缀，与工作台视觉一致 */
function OnboardingIllustration({ step }: { step: "welcome" | "teacher" | "subjects" | "brand" | "ready" | "done" }) {
  const stroke = "#3d5a4a";
  const accent = "#c8895a";
  const soft = "#e8efe8";
  const common = { fill: "none", stroke, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 160 120" className="onboarding-art" aria-hidden="true">
      <rect x="0" y="0" width="160" height="120" rx="16" fill={soft} />
      {step === "welcome" && (
        <g {...common}>
          <path d="M40 86 L40 48 L80 30 L120 48 L120 86" />
          <path d="M40 86 L120 86" />
          <path d="M58 86 L58 62 L102 62 L102 86" />
          <circle cx="80" cy="50" r="5" fill={accent} stroke="none" />
          <path d="M70 86 L70 74 L90 74 L90 86" />
        </g>
      )}
      {step === "teacher" && (
        <g {...common}>
          <circle cx="80" cy="44" r="14" />
          <path d="M56 92 C56 74 64 66 80 66 C96 66 104 74 104 92" />
          <path d="M44 40 L44 28 M44 40 L44 52 M44 40 L32 40 M44 40 L56 40" stroke={accent} />
          <rect x="68" y="84" width="24" height="14" rx="3" />
        </g>
      )}
      {step === "subjects" && (
        <g {...common}>
          <rect x="44" y="40" width="26" height="34" rx="2" />
          <rect x="70" y="36" width="26" height="38" rx="2" fill="#fff" />
          <rect x="96" y="42" width="26" height="32" rx="2" />
          <path d="M76 50 L90 50 M76 58 L90 58 M76 66 L86 66" stroke={accent} />
          <path d="M50 90 L120 90" />
        </g>
      )}
      {step === "brand" && (
        <g {...common}>
          <circle cx="80" cy="60" r="26" />
          <circle cx="80" cy="60" r="9" fill={accent} stroke="none" />
          <path d="M80 34 L80 28 M80 92 L80 86 M106 60 L112 60 M48 60 L42 60" stroke={accent} />
          <path d="M98 42 L103 37 M62 78 L57 83 M98 78 L103 83 M62 42 L57 37" />
        </g>
      )}
      {step === "ready" && (
        <g {...common}>
          <path d="M50 64 L72 86 L112 44" stroke={accent} strokeWidth="3" />
          <circle cx="80" cy="60" r="34" />
        </g>
      )}
      {step === "done" && (
        <g {...common}>
          <path d="M80 30 L80 60 L100 72" />
          <circle cx="80" cy="60" r="30" />
          <path d="M70 60 L78 68 L92 52" stroke={accent} strokeWidth="2.5" />
        </g>
      )}
    </svg>
  );
}

const ONBOARDING_STEPS = [
  { key: "welcome", title: "把工作台变成你自己的", subtitle: "几分钟配置，之后每天打开就能直接用。" },
  { key: "teacher", title: "先认识一下", subtitle: "工作台名称和你的称呼，会显示在桌面与手机上。" },
  { key: "subjects", title: "你教什么", subtitle: "学段和学科决定默认值，之后可以改。" },
  { key: "brand", title: "选一个标记", subtitle: "一个字作为头像标记，出现在侧栏和导出文件里。" },
  { key: "ready", title: "准备就绪", subtitle: "完成配置后，演示数据会被清空，你可以导入真实名单与课表。" },
] as const;

function OnboardingWizard({
  data,
  onClose,
  onFinish,
}: {
  data: WorkbenchData;
  onClose: () => void;
  onFinish: (config: {
    workbenchName: string;
    teacherName: string;
    roleLabel: string;
    schoolStage: SchoolStage;
    subjects: string[];
    avatarMark: string;
  }) => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    workbenchName: data.user.workbenchName,
    teacherName: data.user.teacherName,
    roleLabel: data.user.roleLabel,
    schoolStage: data.user.schoolStage,
    subjects: data.user.subjects.join("、"),
    avatarMark: data.user.appearance.avatarMark,
  });
  const isLast = step === ONBOARDING_STEPS.length - 1;
  const current = ONBOARDING_STEPS[step];

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function next() {
    setError("");
    if (current.key === "teacher") {
      if (!form.workbenchName.trim() || !form.teacherName.trim()) return setError("请填写工作台名称和老师称呼。");
    }
    if (current.key === "subjects") {
      const subjects = form.subjects.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
      if (!subjects.length) return setError("请至少填写一个任教学科。");
    }
    setStep((s) => Math.min(s + 1, ONBOARDING_STEPS.length - 1));
  }

  function finish() {
    const subjects = form.subjects.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!subjects.length) return setError("请至少填写一个任教学科。");
    onFinish({
      workbenchName: form.workbenchName.trim(),
      teacherName: form.teacherName.trim(),
      roleLabel: form.roleLabel.trim() || `${form.schoolStage}教师`,
      schoolStage: form.schoolStage as SchoolStage,
      subjects,
      avatarMark: form.avatarMark.trim() || form.workbenchName.trim().slice(0, 1) || "师",
    });
  }

  return (
    <div className="onboarding-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="onboarding-card" role="dialog" aria-modal="true" aria-label="首次配置向导" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onboarding-art-panel">
          <OnboardingIllustration step={current.key} />
          <div className="onboarding-step-dots">
            {ONBOARDING_STEPS.map((s, i) => (
              <span key={s.key} className={i === step ? "active" : i < step ? "done" : ""} />
            ))}
          </div>
        </div>
        <div className="onboarding-form-panel">
          <header className="onboarding-header">
            <span className="onboarding-step-label">第 {step + 1} / {ONBOARDING_STEPS.length} 步</span>
            <button type="button" className="onboarding-skip" onClick={onClose}>稍后再说</button>
          </header>

          <div className="onboarding-body">
            <h2>{current.title}</h2>
            <p className="onboarding-subtitle">{current.subtitle}</p>

            {current.key === "welcome" ? (
              <div className="onboarding-welcome-points">
                <div><span>◎</span><div><strong>每天先做哪三件</strong><small>课次、事项、学生重点自动排好。</small></div></div>
                <div><span>▦</span><div><strong>课表与备课一站看</strong><small>真实课次对应真实备课清单。</small></div></div>
                <div><span>✓</span><div><strong>事项不再散落</strong><small>教学、学生、行政、论文一条时间线。</small></div></div>
                <div><span>↻</span><div><strong>手机只看不改</strong><small>更新一次，手机随时查阅。</small></div></div>
              </div>
            ) : null}

            {current.key === "teacher" ? (
              <div className="onboarding-fields">
                <label>工作台名称<input value={form.workbenchName} onChange={(e) => update("workbenchName", e.target.value)} placeholder="例如：林老师的工作台" /></label>
                <label>老师称呼<input value={form.teacherName} onChange={(e) => update("teacherName", e.target.value)} placeholder="例如：林老师" /></label>
                <label>身份说明<input value={form.roleLabel} onChange={(e) => update("roleLabel", e.target.value)} placeholder="例如：初中语文教师 · 班主任" /></label>
              </div>
            ) : null}

            {current.key === "subjects" ? (
              <div className="onboarding-fields">
                <label>学段<select value={form.schoolStage} onChange={(e) => update("schoolStage", e.target.value)}><option>小学</option><option>初中</option><option>高中</option><option>教培</option></select></label>
                <label>任教学科<input value={form.subjects} onChange={(e) => update("subjects", e.target.value)} placeholder="例如：语文、班会" /></label>
                <p className="onboarding-hint">多个学科用顿号或逗号隔开。</p>
              </div>
            ) : null}

            {current.key === "brand" ? (
              <div className="onboarding-fields">
                <label>头像标记<input value={form.avatarMark} maxLength={2} onChange={(e) => update("avatarMark", e.target.value)} placeholder="一个字" /></label>
                <div className="onboarding-avatar-preview">
                  <span className="teacher-avatar">{form.avatarMark.trim() || form.workbenchName.trim().slice(0, 1) || "师"}</span>
                  <span>预览：会显示在侧栏左下角与导出文件名。</span>
                </div>
              </div>
            ) : null}

            {current.key === "ready" ? (
              <div className="onboarding-ready-summary">
                <div className="ready-row"><span>工作台</span><strong>{form.workbenchName.trim() || "—"}</strong></div>
                <div className="ready-row"><span>老师</span><strong>{form.teacherName.trim() || "—"}</strong></div>
                <div className="ready-row"><span>学段学科</span><strong>{form.schoolStage} · {form.subjects || "—"}</strong></div>
                <div className="ready-row"><span>头像</span><strong>{form.avatarMark.trim() || "师"}</strong></div>
                <p className="onboarding-hint ready-note"><span aria-hidden="true">i</span> 完成后虚构演示数据会被清空，得到一本属于你的空白工作台。当前演示版本会自动存入备份，可随时恢复。</p>
              </div>
            ) : null}

            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>

          <footer className="onboarding-actions">
            {step > 0 ? <button type="button" className="button button-ghost" onClick={() => setStep((s) => s - 1)}>上一步</button> : <span />}
            {!isLast ? (
              <button type="button" className="button button-primary" onClick={next}>下一步</button>
            ) : (
              <button type="button" className="button button-primary" onClick={finish}>完成配置，清空演示数据</button>
            )}
          </footer>
        </div>
      </section>
    </div>
  );
}
