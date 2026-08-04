# Agent 只读重启指令

下面这段可以直接复制给新的 Agent。它要求先恢复事实，不会自动创建仓库、部署或修改代码。

```text
你正在续作“教师个人工作台”。项目根目录是：
/Users/hao/Documents/Codex/2026-08-03/new-chat

先阅读这个唯一入口：
/Users/hao/Documents/Codex/2026-08-03/new-chat/outputs/教师个人工作台-项目记忆包-P0-2026-08-04/README-从这里开始.md

然后依次阅读同目录 01—05 文档。恢复状态时遵守以下规则：

1. 先只读检查项目根目录、关键文件、package.json、当前 Git 边界和 3002 端口，不要先修改。
2. 当前目录不是 Git 仓库；不要自行 git init、commit、push、部署或建立远程仓库。
3. 当前根目录 README.md 是 P0 前旧文档，不能作为当前实现依据。以用户最新要求、当前源码/测试和项目记忆包为准。
4. 产品面向老师个人、本地优先；电脑可编辑，手机只查询查看最近一次更新内容。
5. 不增加一级功能板块。继续深化学生、课表、事项、资料和手机查看。
6. 学生重点是成绩、排名、真实进退步、近期问题和家校协同；不恢复“学习证据”“事实时间线”。
7. 家校等级必须由老师手动选择，不作为学生或家庭的固定标签。
8. 老师界面不出现 Agent、写入、快照、仓库、密钥、令牌、配对、档案编号等后台术语。
9. 没有闭环的按钮保持隐藏；可见控件必须有可验证结果。
10. 本地部署不等于不涉及个人信息，不得扩大隐私承诺。
11. 当前 P0 使用浏览器设备本地存储；不得称为已完成的 SQLite、加密数据库或永久备份。
12. 不要把 .openai/hosting.json、构建成功或本机端口当成公网部署证据。
13. 当前汇总日期仍固定为 2026-09-16；进入真实初始化前必须改成用户本地日期和学期配置。

只读恢复命令：

cd /Users/hao/Documents/Codex/2026-08-03/new-chat
pwd
test -f app/TeacherWorkbench.tsx
test -f app/workbench-data.ts
sed -n '1,180p' package.json
rg -n '^export (const|type|interface|function)' app/workbench-data.ts
rg -n '^function |^export default' app/TeacherWorkbench.tsx
git rev-parse --show-toplevel
lsof -nP -iTCP:3002 -sTCP:LISTEN

完成只读检查后，先向用户报告：
- 实际项目根目录；
- Git 是否存在；
- 当前测试服务实际端口；
- 当前源码和记忆包是否一致；
- 这次用户请求将修改哪些文件；
- 哪些结论是已验证事实，哪些只是产品决策或待验证项。

如果用户要求继续开发，再在不扩大范围的前提下执行。修改后至少运行：
npm run lint
npm test

涉及响应式界面时，还要实际检查桌面和 390px 手机的 scrollWidth。涉及手机时，必须确认没有新增、编辑、完成、保存或发布入口，并验证数据层写入拒绝。
```

## 当前最安全的续作任务

如果用户没有指定下一项，先建议从以下一项中选择，不要同时铺开：

1. 真实导入闭环。
2. 数据备份与恢复。
3. 本地提醒和系统日历导出。
4. 首次初始化配置。
5. Windows/macOS 启动与销售交付包。

不要默认进入 AI 集成；数据恢复和交付边界应优先稳定。
