# 教师个人工作台｜项目记忆包

> 这是一份给新 Agent、开发者或未来自己的续作入口。它记录产品决策、P0 实现状态、验证证据和下一步边界，不包含源码副本，也不代表生产发布包。

## 快照信息

| 项目 | 当前值 |
|---|---|
| 记忆包版本 | `memory-pack-p0-2026-08-04.1` |
| 整理时间 | 2026-08-04 21:18 CST |
| 项目根目录 | `/Users/hao/Documents/Codex/2026-08-03/new-chat` |
| 应用版本 | `teacher-personal-workbench@0.1.0` |
| 当前阶段 | P0 核心闭环已完成，尚未进入销售交付工程 |
| Git 状态 | 当前目录不是 Git 仓库，没有提交号、分支或远程仓库 |
| 桌面测试地址 | `http://localhost:3002/`，仅本机有效 |
| 手机查看地址 | `http://localhost:3002/?mode=mobile`，仅本机有效 |
| 演示数据 | 代码内置 8 名虚构学生、5 个课次、7 个事项、5 份资料 |

## 先记住四件事

1. 产品卖给老师个人，不是学校管理后台，也不是机构 SaaS。
2. 老师在电脑端维护数据；手机只查询和查看最近一次更新的内容，不能编辑。
3. 当前 P0 使用浏览器设备本地存储，不是 SQLite、云数据库或已加密的数据文件。
4. 当前根目录的 `README.md` 是 P0 前的旧文档，包含已被隐藏的演示入口，不能作为当前实现依据。

## 权威顺序

续作时按以下顺序判断状态：

1. 用户最新明确要求。
2. 当前工作区源码、测试和实际运行结果。
3. 本记忆包。
4. 根目录旧 `README.md`、旧审计报告、旧截图和旧 ZIP。

旧资料可以说明历史，但不能证明当前功能、部署或销售就绪。

## 阅读顺序

1. [01-产品与商业决策.md](01-产品与商业决策.md)
2. [02-P0当前实现状态.md](02-P0当前实现状态.md)
3. [03-技术架构与数据模型.md](03-技术架构与数据模型.md)
4. [04-验证证据与已知限制.md](04-验证证据与已知限制.md)
5. [05-后续工作优先级.md](05-后续工作优先级.md)
6. [06-Agent只读重启指令.md](06-Agent只读重启指令.md)

## 只读恢复现场

下面的命令只读取项目状态，不安装依赖、不启动服务、不创建 Git 仓库：

```bash
cd /Users/hao/Documents/Codex/2026-08-03/new-chat
pwd
test -f app/TeacherWorkbench.tsx
test -f app/workbench-data.ts
sed -n '1,180p' package.json
rg -n '^export (const|type|interface|function)' app/workbench-data.ts
rg -n '^function |^export default' app/TeacherWorkbench.tsx
git rev-parse --show-toplevel
lsof -nP -iTCP:3002 -sTCP:LISTEN
```

预期：前六项能读取项目；`git rev-parse` 当前会报告“不是 Git 仓库”；如果开发服务仍在运行，最后一项会显示 3002 端口监听。

## 受控验证与启动

验证会重新生成 `dist/`，不属于严格只读操作：

```bash
cd /Users/hao/Documents/Codex/2026-08-03/new-chat
npm run lint
npm test
```

需要重新启动测试服务时：

```bash
cd /Users/hao/Documents/Codex/2026-08-03/new-chat
npm run dev -- --port 3002
```

不要只相信请求的端口；必须用启动日志、`lsof` 或 HTTP 请求确认实际监听地址。

## 续作安全边界

- 不要因为看见 `.openai/hosting.json` 就宣称已经公开部署。
- 不要创建、提交、推送 Git 仓库，除非用户明确要求进入交付阶段。
- 不要把虚构演示数据写成真实客户规模或真实运营数据。
- 不要恢复已经隐藏的假按钮；可见控件必须有可验证结果。
- 不要把“本地部署”表述成“不涉及个人信息”。
- 不要把 AI 判断写成学生或家庭的固定负面标签。

## 这个包不包含什么

- 不包含源代码副本、`node_modules/`、`dist/` 或浏览器内的业务数据。
- 不包含 Git 历史，因为当前项目没有 Git 仓库。
- 不包含客户授权协议、安装器、生产部署凭据或 AI 密钥。
- 不证明 Windows/macOS、真实导入、系统日历、备份恢复或生产发布已经完成。

文件完整性请查阅 [SHA256SUMS.txt](SHA256SUMS.txt)。
