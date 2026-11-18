# learnJCU MCP

[English](README.md) | **简体中文**

非官方的 LearnJCU 工具，包含一个 MCP 服务器和一个命令行工具。LearnJCU 是詹姆斯库克大学（James Cook University）的 Blackboard Learn Ultra 网站（`learn.jcu.edu.au`）。你在真实浏览器里自己登录，工具复用这个会话。数据来自 Blackboard 的 REST API。

它可以读取你的科目、公告、课程内容、成绩、截止日期和日历。唯一会改动数据的操作，是向 Ultra 作业提交文件或文字。

## 安全性

- 登录在系统默认浏览器里进行，支持 Edge、Chrome、Brave 等 Chromium 内核的浏览器，用的是 JCU 自己的登录页。密码由你自己在浏览器里输入，代码接触不到。
- 每个已保存的账号都有自己的专用浏览器配置（`~/.learnjcu-mcp/accounts/<账号>/browser-profile`），和你日常用的配置分开。工具不会读取你平时浏览器里的 cookie 或保存的密码。
- 会话按账号保存在 `~/.learnjcu-mcp/accounts/<账号>/session.json`，多个人的登录状态不会混在一起，也都不在项目目录里。
- 请求只发往 `learn.jcu.edu.au`。文件下载跳转到 Blackboard 的文件域名时，会去掉 cookie。唯一的例外是更新检查：每次启动向 `api.github.com` 发一个请求，不带 cookie，也不带账号信息（见[更新](#更新)）。
- 只发 GET 请求，例外只有作业提交：
  - 在 CLI 里，`submit` 会先显示要发送的内容，问你 `[y/N]`，确认后才发送。加 `--dry-run` 则只显示计划。
  - 在 MCP 里，`learnjcu_submit` 必须带 `confirm: true`，不带就不会发送。工具说明里要求 Agent 先给你看 dry-run 的结果，得到你的同意后才能发送。
- 没有任何遥测。

## 使用

在这个目录里运行：

```bash
npm install
npm run login     # 打开浏览器，登录 LearnJCU，完成后窗口会自动关闭
npm run check     # 显示你的名字和当前科目
```

登录会在默认浏览器里打开 LearnJCU，它会跳转到 JCU 的登录页。

会话几个小时后会过期，但一般不需要重新登录：

- **静默续期**：每次登录都会先在后台的隐藏窗口里尝试。只要登录页还记得你，几秒内就能续上，不会弹出窗口。
- **CLI**：`learnjcu` 命令发现会话过期时，会先静默续期，再自动重试。如果需要你亲自登录，会先问你要不要打开登录页。
- **Agent**：MCP 工具发现会话过期时，服务器会先用该账号的浏览器配置静默续期，再把这次调用重跑一遍，你通常察觉不到。提交作业不会自动重跑，由 Agent 再调用一次。只有静默续期不成功时，工具才会报告会话过期，Agent（任何 MCP 客户端）再调用 `learnjcu_login`，它会打开登录页并提示你完成登录。

### 多个账号

每个账号单独保存：它的会话和专用浏览器配置都放在 `~/.learnjcu-mcp/accounts/<用户名>/` 里。

```bash
npm run login                              # 第一个账号（以你的 LearnJCU 用户名命名）
npm run login -- --new-account             # 登录另一个人，保存为新账号
learnjcu accounts                          # 列出已保存的账号
learnjcu upcoming --account jc123456       # 某条命令用指定账号（也可以设置 LEARNJCU_ACCOUNT）
```

- 只保存了一个账号时，所有操作都用它。
- 保存了多个账号又没指定时，在终端里运行的命令会问你用哪个；没有终端时会停下，要求加 `--account`。
- 在 MCP 里，服务器会通过客户端自己的询问框问你（客户端需支持 MCP elicitation），你的选择在本次会话内一直有效。客户端不支持时，Agent 会被要求先问你，再带上 `account` 调用。`learnjcu_list_accounts` 和 `learnjcu_select_account` 用来列出和切换账号。
- 给已有账号登录时，如果登进去的是另一个人，会被拒绝，所以一个账号的目录里不会混进别人的会话。

## LearnJCU 命令行

运行一次 `npm link` 后，就可以在任何地方使用 `learnjcu` 命令。也可以直接运行 `node src/learnjcu-cli.js`。

```bash
learnjcu login                                     # 登录（等同于 npm run login）
learnjcu upcoming --days 14                        # 所有科目里近期要交的项目
learnjcu submissions BU2001 Essay                  # 作业的提交设置，以及你的每次提交
learnjcu submit BU2001 Essay report.pdf --dry-run  # 只显示要发送的内容
learnjcu submit BU2001 Essay report.pdf            # 作为一次新提交发送（会先确认）
learnjcu submit BU2001 Reflection -m "我的回答"     # 只交文字
```

- `<course>` 可以写科目代码，如 `BU2001`，会匹配这个代码最新的科目网站；也可以写完整代码，如 `26-BU2001-SIN-CAM-TR3`，或课程 ID，如 `_123456_1`。
- `<assignment>` 可以写作业标题里唯一的一段文字，也可以写内容 ID 或成绩列 ID。
- `submit` 适用于没有题目的 Ultra 作业（就是网页上添加文件或文字、再点“提交”的那种）。每运行一次就是一次新提交，所以先用 `submissions` 看看作业允许交几次。
- 文件按原样上传。带题目的作业、小组作业、需要密码或安全浏览器的作业都会被拒绝，请在浏览器里交。链接到外部工具（如 Turnitin）的作业也一样。
- 提交后，命令会检查回执里确实包含上传的文件。

## 更新

MCP 服务器每次启动时，会检查一次 GitHub 上 `main` 分支有没有比当前副本更新的版本。有的话，第一次工具调用的结果里会告诉 Agent 新增了哪些改动，Agent 会向你解释这些改动，并问你要不要更新。只有你同意后才会更新：`learnjcu_update` 先显示 dry run，再拉取 `main`、切换过去并运行 `npm install`。更新完要重启 MCP 客户端。

- 检查只向 `api.github.com` 发一个请求，带上当前副本的提交 ID，不发送任何 cookie 或账号信息。
- 需要是从 GitHub 仓库 git 检出的副本。其他副本不会提示更新。
- 设置 `LEARNJCU_NO_UPDATE_CHECK=1` 可以关闭检查。

## 注册到 MCP 客户端

大多数 MCP 客户端都支持下面这种 stdio 服务器配置（写在客户端的 MCP 配置文件，或项目的 `.mcp.json` 里）：

```json
{
  "mcpServers": {
    "learnjcu": {
      "command": "node",
      "args": ["<这个目录的绝对路径>/src/server.js"]
    }
  }
}
```

改完后重启客户端。

## 注册到 Codex

```bash
codex mcp add learnjcu -- node "<这个目录的绝对路径>/src/server.js"
```

或者写进 `~/.codex/config.toml`：

```toml
[mcp_servers.learnjcu]
command = "node"
args = ["<绝对路径>/src/server.js"]
tool_timeout_sec = 300   # 等你登录可能超过 Codex 默认的 60 秒
```

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `learnjcu_list_accounts` | 列出已保存的账号，以及本次会话用的是哪个 |
| `learnjcu_select_account` | 选定本次会话之后都用的账号（先问过用户） |
| `learnjcu_status` | 检查是否已登录，以及会话何时过期（没选定账号时列出所有账号） |
| `learnjcu_login` | 续期或重新登录；需要你操作时会打开默认浏览器 |
| `learnjcu_whoami` | 当前用户 |
| `learnjcu_list_courses` | 你的科目和其他网站，科目网站排在前面 |
| `learnjcu_list_announcements` | 某个科目的公告 |
| `learnjcu_list_contents` | 科目大纲 / 文件夹内容 |
| `learnjcu_get_content` | 单个内容的全文、附件和页面内嵌文件列表 |
| `learnjcu_download_attachment` | 下载附件或内嵌文件到 `~/Downloads/learnjcu` |
| `learnjcu_my_grades` | 成绩册：截止日期、提交状态、分数、反馈 |
| `learnjcu_upcoming_deadlines` | 扫描所有当前科目，列出 N 天内的截止项 |
| `learnjcu_calendar` | 日历事件 |
| `learnjcu_list_submissions` | 作业的提交设置，以及你的每次提交（含回执和文件） |
| `learnjcu_submit` | 向 Ultra 作业提交文件或文字（需要 `confirm: true`） |
| `learnjcu_api_get` | 直接 GET 任意 `/learn/api/public/` 接口 |
| `learnjcu_check_update` | 检查 GitHub 上有没有新版本，并列出新增的改动 |
| `learnjcu_update` | 把当前副本更新到最新版（需要 `confirm: true`） |

## 环境变量

- `LEARNJCU_BROWSER`：登录用的浏览器，可以填可执行文件路径，也可以填通道名（`msedge`、`chrome`）。默认用系统默认浏览器。如果默认浏览器是无法自动化的 Firefox 或 Safari，会改用已安装的 Edge 或 Chrome。
- `LEARNJCU_MCP_HOME`：会话目录，默认 `~/.learnjcu-mcp`
- `LEARNJCU_DOWNLOAD_DIR`：下载目录，默认 `~/Downloads/learnjcu`
- `LEARNJCU_ACCOUNT`：要用的已保存账号，设置后不再询问。等同于 `--account`。
- `LEARNJCU_NO_AUTO_LOGIN`：设为 `1` 后，CLI 和 MCP 服务器都不会在会话过期时自动续期。
- `LEARNJCU_NO_UPDATE_CHECK`：设为 `1` 后，MCP 服务器启动时不再去 GitHub 检查新版本。

## 已知限制

- 本项目改编自 [minerva-mcp](https://github.com/BxnIceLemon/minerva-mcp)，后者用于利兹大学同样基于 Blackboard Learn Ultra 的 Minerva。LearnJCU 的接口已经用学生账号核对过：个人资料、已选科目、成绩册、课程内容、公告和日历的返回格式都一样。
- 登录需要一台有屏幕的电脑，没有纯终端的登录方式。
- 作业提交还没在 LearnJCU 上真正发送过。它发的是 Minerva 上 Blackboard Ultra 网页本身发的那套请求，在 Minerva 上真实测试过；LearnJCU 用的是同一系列的 Ultra 版本，但提交前请先用 dry run 检查。
- Turnitin、Echo360 等第三方 LTI 工具里的内容拿不到。
- 请合理使用，遵守 JCU 的 IT 使用政策和学术诚信规定。

## 参与贡献

欢迎提 issue 和 pull request，动手前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 报告。

## 许可证

[ISC](LICENSE)
