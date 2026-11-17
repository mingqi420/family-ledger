# 家庭记账 · family-ledger

一个适合本机使用的轻量家庭账本：Vue 页面 + Python 标准库 HTTP 服务 + SQLite。无需安装 npm 包或 Python 第三方依赖，前端框架已放在项目中，正常使用不依赖互联网。

## 项目目录

```text
family-ledger/
├── backend/
│   └── server.py              # HTTP 接口、校验、SQLite 存储
├── frontend/
│   ├── index.html             # 入口、状态栏与组件组合
│   ├── pages/
│   │   ├── detail.js          # 明细页组件
│   │   ├── stats.js           # 统计页组件
│   │   ├── invest.js          # 理财页组件
│   │   └── settings.js        # 设置页组件、备份文件选择
│   ├── components/
│   │   ├── tab-bar.js         # 底部导航
│   │   ├── record-drawer.js   # 记账抽屉、金额输入框
│   │   └── confirm-dialog.js  # 删除、清空和恢复确认
│   ├── styles/app.css         # 页面样式、响应式布局
│   ├── js/
│   │   ├── app.js            # 应用初始化、共享状态与业务操作
│   │   └── view-context.js   # 组件上下文与依赖绑定
│   └── vendor/vue.global.prod.js
├── scripts/
│   ├── 启动记账.command       # macOS 一键启动并打开浏览器
│   ├── start.bat              # Windows 前台启动
│   └── start.sh               # Linux／macOS 前台启动
├── tests/
│   ├── test_server.py         # 接口、启动与目录路径回归测试
│   ├── test_frontend.cjs      # 前端逻辑与组件交互回归测试
│   └── helpers/vue-renderer.cjs # Vue 组件测试的内存宿主
├── data/
│   ├── .gitignore             # 保留目录，但不提交个人数据
│   └── ledger.db              # 正式账本，首次启动自动创建
├── .gitattributes             # 跨平台脚本换行规则
├── .gitignore
└── README.md
```

运行时可能在 `data/` 下出现 `ledger.db-wal` 和 `ledger.db-shm`，它们属于数据库，不是源码。IDE 自己使用的 `.idea/` 等配置仍留在项目根目录。以下命令除特别说明外，都在项目根目录执行。

## 功能与记账口径

- 支出、收入、理财买入／赎回／收益、家庭内部转账。
- 按月份及类型筛选明细，按日汇总；长列表每次显示 100 笔，可继续加载。
- 月度／年度收支统计、每日趋势、分类占比、理财平台汇总。
- 家庭成员管理，JSON 备份与恢复，CSV 导出。
- 适配窄屏与桌面布局，支持键盘焦点、Escape 关闭弹窗。

计算规则：

```text
结余 = 收入 + 理财收益 − 支出
在投本金 = 累计买入 − 累计赎回
```

理财本金流转和内部转账不计入收支。每日汇总中的“收”包含理财收益；年度趋势中的收入也包含理财收益。分类占比只统计对应类型，柱条长度按该类型最大分类归一化，文字百分比表示真实占比。

金额最多两位小数，以整数“分”参与汇总。当前仅支持人民币正金额，不支持负收益／多币种；在投本金是历史现金流计算值，不是实时市值。删除成员不影响历史记录中的名字。

## 环境要求

- Python **3.9 或更新版本**，自带 SQLite **3.24 或更新版本**。
- 支持 Vue 3 的现代浏览器，例如最新版 Safari、Chrome、Edge、Firefox。
- macOS、Windows 和 Linux 均提供启动脚本，也可以直接运行后端入口。
- 数据库所在目录需要写权限，并应保留足够磁盘空间。

检查环境：

```bash
python3 --version
python3 -c "import sqlite3; print(sqlite3.sqlite_version)"
```

未安装 Python 时，可从 [python.org](https://www.python.org/downloads/) 安装；已使用 Homebrew 的用户也可以执行 `brew install python`。macOS 的命令行开发者工具不保证提供满足版本要求的 Python，请以检查结果为准。

## macOS 部署与启动

### 1. 准备项目文件

可以复制已有项目目录，也可以克隆：

```bash
git clone https://github.com/mingqi420/family-ledger.git
cd family-ledger
```

部署时保留完整的 `backend/`、`frontend/`、`scripts/` 目录；`data/` 用于存放账本，首次运行时会自动创建。已有数据需要按后文的迁移步骤处理。

`tests/` 不参与日常运行。不要直接双击 `frontend/index.html`，也不要用普通静态服务器代替后端，必须通过记账服务访问。

### 2. 启动服务

在 Finder 中进入 `scripts/`，双击 **启动记账.command**。脚本会检查 Python、服务身份及就绪状态，再打开浏览器：

**http://127.0.0.1:8899**

首次启动可能遇到：

- **没有执行权限**：在项目目录运行 `chmod +x scripts/启动记账.command`，或直接执行 `bash scripts/启动记账.command`。
- **无法验证开发者**：确认文件来源可信后，右键脚本选择“打开”；必要时在“系统设置 → 隐私与安全性”中允许打开。
- **提示安装命令行开发者工具**：完成安装后重新检查 Python 版本；不满足要求时单独安装 Python。

也可以手动启动：

```bash
python3 backend/server.py
```

看到“服务已启动”后，在浏览器输入上面的地址。页面顶部显示“已连接本机数据库”才可以写入。

### 3. 停止服务

保留运行服务的终端窗口；不用时在该窗口按 **Control+C**，等待“服务已停止”。关闭浏览器不会停止服务。

一键脚本不再使用 `nohup` 隐藏运行。重复打开脚本只会复用已运行的新版本服务；要停止它，请使用最初启动服务的终端。备份或搬迁前请显式停止并确认端口已释放，不要只根据窗口是否关闭判断。

```bash
lsof -nP -iTCP:8899 -sTCP:LISTEN
```

没有输出说明该端口没有监听进程。若存在其他服务，应先核对进程身份，不要直接终止不认识的进程。

### 4. 自定义端口或独立账本

```bash
python3 backend/server.py --port 8900 --db /绝对路径/另一本账.db
```

然后访问 `http://127.0.0.1:8900`。自定义数据库的父目录必须已经存在。默认数据库固定为项目下的 `data/ledger.db`，默认前端目录固定为 `frontend/`，不受当前工作目录影响；`--db` 的相对路径则相对于进程工作目录解析，因此推荐使用绝对路径。

macOS 一键脚本固定使用默认端口与默认账本；自定义参数请用终端启动。Windows／Linux 脚本支持转发 `--port`、`--db` 参数。请固定使用同一个地址，`localhost` 与 `127.0.0.1`、不同端口拥有各自的浏览器缓存。

## Windows 部署与启动

### 1. 安装 Python 和获取项目

适用于 Windows 10／11。到 [Python 官网](https://www.python.org/downloads/windows/) 安装 Python 3.9 或更新版本，安装时勾选 **Add python.exe to PATH**。安装后重新打开 PowerShell，检查：

```powershell
py -3 --version
py -3 -c "import sqlite3; print(sqlite3.sqlite_version)"
```

如果没有 `py` 命令，使用 `python` 替代。若输入 `python` 打开 Microsoft Store，请检查 Python 安装路径及 Windows 的应用执行别名。SQLite 随 Python 提供，不需要另装数据库服务。

可以在 GitHub 下载 ZIP 并解压，或安装 Git 后运行：

```powershell
git clone https://github.com/mingqi420/family-ledger.git
Set-Location .\family-ledger
```

建议放在当前用户可写目录，例如 `C:\Users\你的用户名\Projects\family-ledger`，不要放在 `Program Files` 等受保护目录，也不要直接在 ZIP 压缩包里运行。

### 2. 启动与访问

双击 `scripts\start.bat`，或在 PowerShell 执行：

```powershell
.\scripts\start.bat
```

脚本会优先使用 `py -3`，没有时尝试 PATH 中的 `python`。也可以直接运行：

```powershell
py -3 .\backend\server.py
```

看到服务已启动后，手动打开 **http://127.0.0.1:8899**。Windows 脚本在前台运行，不自动打开浏览器；请保留终端窗口。正常使用不需要管理员权限，也不需要开放防火墙入站端口。

### 3. 停止、端口检查与独立账本

在运行服务的窗口按 **Ctrl+C**，等待服务停止；批处理若询问是否终止，请确认。关闭浏览器不会停止服务。

```powershell
# 查看监听者，再到任务管理器按 PID 核对身份；不要盲目结束进程
Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue

# 也可以在 CMD 使用
netstat -ano | findstr :8899

# 自定义端口与数据库，数据库父目录须已存在
.\scripts\start.bat --port 8900 --db "C:\Users\你的用户名\Documents\家庭账本.db"
```

自定义端口后使用 `http://127.0.0.1:8900`。脚本会切换到项目根目录，所以 `--db` 推荐传绝对路径。若从 macOS／Linux 拷贝目录，请保留全部前端子目录，不要只复制 HTML 文件。

## Linux 部署与启动

### 1. 安装环境

以 Debian／Ubuntu 为例：

```bash
sudo apt update
sudo apt install python3 git
python3 --version
python3 -c "import sqlite3; print(sqlite3.sqlite_version)"
```

Fedora 可以使用 `sudo dnf install python3 git`。要求仍为 Python 3.9+ 和 SQLite 3.24+；旧发行版自带版本不足时，请先升级到受支持的 Python。无需 pip、npm 或单独安装 SQLite 命令行工具。

```bash
git clone https://github.com/mingqi420/family-ledger.git
cd family-ledger
```

也可以把项目目录复制到 Linux。确保运行用户对项目的 `data/` 目录具有写权限；不要为了绕过权限问题而使用 root 运行服务。

### 2. 前台启动与停止

```bash
bash scripts/start.sh
# 或直接启动
python3 backend/server.py
```

浏览器访问 **http://127.0.0.1:8899**。Linux 脚本不会自动打开浏览器，也不会隐藏到后台。按 **Ctrl+C** 停止服务。

```bash
# 检查端口，核对进程后再处理占用
ss -ltnp 'sport = :8899'

# 自定义启动参数
bash scripts/start.sh --port 8900 --db "$HOME/家庭账本.db"
```

也可运行 `chmod +x scripts/start.sh` 后使用 `./scripts/start.sh`。如果出现 `/usr/bin/env: bash\r` 等错误，说明脚本被转换成了 CRLF，请恢复 LF 换行；仓库的 `.gitattributes` 已声明相应换行规则。

### 3. 可选：用户级 systemd 服务

需要登录后自动运行时，可在支持 systemd 的发行版创建 `~/.config/systemd/user/family-ledger.service`。先创建父目录，并将下例中的用户名和路径替换成实际值：

```ini
[Unit]
Description=Family Ledger

[Service]
Type=simple
WorkingDirectory=/home/yourname/family-ledger
ExecStart=/usr/bin/python3 -u /home/yourname/family-ledger/backend/server.py
Restart=on-failure
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=15

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now family-ledger
systemctl --user status family-ledger
journalctl --user -u family-ledger -f

# 停止服务（后续复制数据库前必须确认已停止）
systemctl --user stop family-ledger
```

使用 systemd 时不要再同时启动同端口的前台实例。默认是用户登录会话级服务，不保证退出登录后继续运行；需要无人值守运行时，应由管理员另外评估服务账户、权限及备份策略。

### 4. 无桌面的 Linux 主机

本项目只监听回环地址，浏览器中的 `127.0.0.1` 指的是浏览器所在设备。在可信 Linux 主机运行服务后，可以从自己的电脑建立 SSH 隧道：

```bash
ssh -N -L 8899:127.0.0.1:8899 yourname@linux-host
```

保持 SSH 连接，再在自己电脑打开 `http://127.0.0.1:8899`。本地与远端服务端口需要一致，以通过 Host 校验；本地端口已占用时，可以把远端服务与隧道两端统一改为 8900。此方式不需要公开记账端口，不要直接改为 `0.0.0.0`。

## 从旧版本升级

1. 在旧页面“设置 → 导出备份（JSON）”中导出当前账本。如果多个浏览器可能存有未同步记录，请分别导出后核对。
2. 停止旧服务。**旧 macOS 脚本使用 `nohup`，关闭终端不代表已经停止**；macOS 用 `lsof`、Windows 用 `Get-NetTCPConnection`、Linux 用 `ss` 检查端口，确认进程身份后再退出。systemd 管理的服务应通过 `systemctl --user stop family-ledger` 停止。
3. 本版本使用分目录结构。建议准备一个新的项目目录，再把 JSON 备份导入新服务；不要只更新 `backend/server.py` 而遗漏 `frontend/` 子目录。
4. 如果直接搬库，确认源、目标均已停服，将旧根目录的 `ledger.db` 及仍存在的同名 `-wal`、`-shm` 文件作为一组迁移到新项目 `data/` 下，不要覆盖已有目标账本。正常停服并完成 checkpoint 后，通常只需主库；不确定时使用 JSON 迁移。
5. 首次启动会为现有数据库添加版本元数据，不主动替换原记录。如果根目录仍有旧的 `ledger.db`，默认启动会拒绝继续并提示迁移，防止误把新建空账本当成原账本；可使用 `--db` 明确指定其他账本。
6. 从 `scripts/` 中选择对应平台入口，或运行 `python3 backend/server.py`（Windows 用 `py -3`），然后刷新浏览器。若仍提示旧版服务，说明端口上运行的还是旧进程。

旧版浏览器缓存不会自动写入数据库，即使数据库为空也不会自动恢复，避免已清空的账本被旧缓存复活。页面检测到旧缓存后会提示，可在设置中**导出旧版浏览器备份**，与数据库备份核对后再决定是否恢复。原缓存会保留，不自动删除。

如果历史数据存在非法日期、金额或缺失字段，新版可能以只读状态提示错误；请保留原库和备份，修复副本后再恢复，不要直接清空正式数据库。

## 保存、冲突与离线行为

- **SQLite 是正式数据源**。每次新增、删除、成员修改或恢复都等待服务确认成功后才更新页面；失败不会提示保存成功。
- 页面保留浏览器只读缓存。服务断开时可以查看和导出缓存，但不能离线记账；缓存可能不是最新数据。
- 两个页面同时编辑时，服务校验账本版本。过期页面会收到冲突提示，不会覆盖另一页面的新记录。点击“重新加载账本”后核对再操作。
- 网络断开或请求超时意味着“保存未确认”，不一定代表服务完全没有写入。重新加载、核对记录后再操作；未关闭的记账表单保留同一记录 ID，避免同一表单重试产生重复记录。
- 服务重启后旧写入令牌失效，页面需要重新加载账本。
- 浏览器缓存空间不足不会阻止数据库保存，但会提示缓存不可用，此时更应及时导出备份。

当前每本账本最多 **50,000 条记录**，最多 **50 位成员**；单笔金额不超过 **99,999,999.99 元**；备份文件及写入请求上限 **32 MiB**。JSON 会验证成员、唯一 ID、类型、日期、金额及各类必填字段。导入前必须全部通过校验，恢复操作在单个事务中完成。

## 数据备份、恢复与迁移

### 推荐：JSON 备份

1. 页面顶部确认已连接数据库；如有其他页面操作过，先点击“重新加载账本”。
2. “设置 → 导出备份（JSON）”，将文件保存到另一块磁盘或可信的备份位置。
3. 新电脑安装并启动项目，在“设置 → 从备份文件恢复”选择 JSON。
4. 核对记录数量并确认覆盖，看到恢复成功后再刷新检查。

**恢复会覆盖目标账本，不会自动合并。恢复／清空前请先导出目标账本。** JSON 备份包含家庭成员和全部记录；CSV 用于表格查看，不支持作为恢复文件。CSV 导出会对可能被表格软件执行的公式文本添加前导单引号。

备份与数据库均未加密，可能包含敏感的家庭财务信息，请妥善保管，不要公开上传。

### 可选：停服后复制数据库

在源电脑停止服务并确认没有其他进程连接该数据库，再复制 `data/ledger.db`；目标电脑也必须先停服，将数据库放入新项目的 `data/` 目录。为避免与目标旧的 WAL 文件混用，建议复制到一个新的项目目录后再启动。Windows、macOS 和 Linux 的 SQLite 文件及 JSON 备份格式相同，可按此流程跨平台迁移。

`ledger.db-wal` 和 `ledger.db-shm` 是 SQLite 运行时文件。**运行中不要单独复制或删除这些文件，也不要只拷主库当作一致性备份**。若停服后仍不确定 WAL 是否已合并，优先使用 JSON 导出，或请熟悉 SQLite 的人员使用其在线备份接口。

## 安全边界

- 服务固定监听 `127.0.0.1`，不是公网产品，也不是多人在线系统。
- 不提供用户登录、权限隔离、数据加密或云同步；同一电脑上有访问权限的用户仍可能读到数据。
- 静态文件只通过明确白名单开放 `frontend/` 中的页面、样式、应用脚本和 Vue；`data/`、`backend/`、`scripts/`、`tests/` 及 `.git` 不通过 HTTP 暴露。
- 写接口要求同源访问、合法 Host、JSON 类型及当前服务令牌，并有请求大小限制和版本冲突检测。令牌用于跨站请求防护，**不等于用户身份认证**。
- 不要直接改成 `0.0.0.0` 或做端口转发。手机跨设备访问／公网部署需要额外设计认证、HTTPS、权限和备份策略，本版本不提供该部署方式。
- `.gitignore` 排除数据库、运行日志、浏览器导出备份及 IDE 文件。**已被 Git 跟踪或暂存的文件不会因新增忽略规则而自动移除**；发布前务必检查暂存区，真实账本不要提交。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 页面打不开 | 检查终端启动错误、Python 版本和端口占用；确认使用 HTTP 地址，而不是直接打开 HTML。 |
| 端口已被占用 | 按对应平台章节使用 `lsof`、`Get-NetTCPConnection` 或 `ss` 核对进程；停止确认过的旧服务，或用 `--port` 换端口。 |
| 保存未确认／只读 | 保留表单和备份，检查服务、磁盘空间及权限；重新加载核对结果，避免盲目重复记账。 |
| 换浏览器后数据不同 | 确认访问的是同一服务、同一数据库；断线时显示的只是各浏览器的旧缓存。 |
| 清空缓存会丢账吗 | 不会删除已成功保存的 SQLite 数据，但会失去该浏览器的缓存及旧版未同步记录；先备份更安全。 |
| 删除／恢复操作出错 | 校验失败及数据库事务失败会保留原数据；不要手动删除库文件，先检查错误提示。 |
| 去哪里看日志 | 新版本直接输出在运行服务的终端；旧脚本日志可能位于 `~/Library/Logs/family-ledger.log`。 |

## 开发与回归测试

### 前端组件组织

`index.html` 仅组合四个页面、底部导航、记账抽屉和确认弹窗。`pages/`、`components/` 中的 `.js` 文件包含 Vue 组件模板及绑定，使用项目自带的 Vue 编译模板，无需 npm、Vite 或构建步骤；现有三平台启动入口和数据库路径不变。

共享账本状态与业务操作只在 `js/app.js` 初始化一次，通过 `provide/inject` 传递。组件使用 `LedgerContext.use([...])` 显式声明依赖并保留原始 ref，切换页面不会重复读取或写入数据库。金额输入框及备份文件选择框由所属组件管理，挂载／卸载时更新引用。

添加页面或组件时，需要同时更新入口的脚本加载顺序（Vue → 上下文 → 组件 → 应用）、根应用的组件注册及 `backend/server.py` 的静态资源白名单。白名单逐文件开放，不开放整个目录。更新本版本后请重启后端再刷新页面，让新增资源白名单生效。

### 测试命令

```bash
# Python 标准库接口测试，使用独立临时数据库
python3 -B -m unittest discover -s tests -p 'test_*.py' -v

# Node.js 18+：真实 Vue 响应式运行时 + 浏览器替身，无 npm 依赖
node --test tests/test_frontend.cjs

# macOS 启动脚本语法检查
bash -n scripts/启动记账.command
bash -n scripts/start.sh
```

Windows PowerShell 对应测试命令：

```powershell
py -3 -B -m unittest discover -s tests -p "test_*.py" -v
node --test .\tests\test_frontend.cjs
```

后端根据自身文件位置定位前端与默认数据目录，前端资源通过服务根地址加载，移动整个项目目录不需要修改源码。自动化测试包含从含空格／中文的路径、无关工作目录启动服务的检查；Windows 批处理仍建议在目标 Windows 系统上做一次实际启动验证。

覆盖保存与清空、旧库迁移、非法备份、原子回滚、并发版本冲突、跨源请求与静态文件保护、缓存失败、响应丢失重试、统计金额和占比、年度导航、CSV 安全及万条记录分页。测试不会使用项目内的真实 `data/ledger.db`。新增组件测试会实际编译模板并在内存宿主上挂载，覆盖四页切换、共享筛选状态、双向输入绑定、抽屉焦点、保存失败、删除确认、成员管理及导入引用重建；接口测试覆盖全部入口资源、GET／HEAD／ETag、目录越界和未列入白名单的文件。内存宿主不替代真实浏览器视觉和交互检查。

### 性能与实现说明

- 使用 `shallowRef` 和显式保存操作，移除了对整本记录的深度监听及初始化写回。
- 建立按月／年的计算索引，日趋势单次聚合，年趋势复用月份分组，避免反复扫描完整账本。
- 明细分批渲染，统计始终使用当前筛选下的全量数据。
- SQLite 使用 WAL、短连接、原子事务和版本检查，只新增／更新／删除有变化的记录，避免每次全表重建。
- 静态资源使用 ETag 条件缓存，数据接口禁止缓存。
- 写接口仍传送整个账本快照，校验和比对仍是线性开销；大量数据、高频多人写入不属于本版本目标。
