import type { Metadata } from "next";
import TeacherWorkbench from "./TeacherWorkbench";

export const metadata: Metadata = {
  title: "教师个人工作台",
  description: "面向老师个人的学生档案、教学课表、事项提醒与手机查看工作台。",
};

export default function Home() {
  return <TeacherWorkbench />;
}
