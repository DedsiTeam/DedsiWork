# DedsiWork

## Tauri 桌面版（Windows x64）

现有 React + TypeScript、Bun、SQLite、REST API 与 MCP 保留。Rust 只负责原生窗口、单实例管理、启动和关闭服务。Bun 和 React 资源编译进附带的 `dedsiwork-service.exe`，安装成品不要求用户安装 Bun 或 Rust。

### 开发与打包

开发电脑需要 rustup（管理 rustc/cargo）、Visual Studio C++ Build Tools + Windows SDK、WebView2，以及 Bun。当前电脑已安装这些工具；Rust 安装在当前用户标准目录 `%USERPROFILE%\.cargo` 和 `%USERPROFILE%\.rustup`，其他项目可以复用。新开终端后可执行 `rustc --version` 和 `cargo --version`。

```powershell
cd C:\Githubs\DedsiWork\src
bun run desktop:dev
```

```powershell
# 生成 Windows 安装包
bun run desktop:build
# 查看桌面构建环境
bun run desktop:info
```

桌面命令会自动先编译内嵌 React 资源的 Bun 服务，再启动/打包 Tauri。桌面开发启动不依赖单独的 `bun run dev`；修改前端或服务后需重新启动桌面开发命令以重新打包 sidecar。需要网页热更新时仍可单独使用 `bun run dev`。

### 运行行为

- 打开应用时启动附带服务；服务就绪后，窗口自动连接网页并建立桌面会话，无需手动输入配对码。
- 默认网页 `http://127.0.0.1:3210`、API `/api/v1`、MCP `/mcp` 同时可用。外部浏览器仍使用配对码；MCP 仍要求 Bearer Token。
- 桌面自动登录使用短时、一次性的随机启动令牌，不写入日志，不暴露 MCP 令牌。网页没有 shell、文件系统等 Tauri IPC 权限。
- 点击窗口关闭按钮或按 Alt+F4 时，窗口隐藏到系统托盘，网页、API 和 MCP 继续运行，窗口会话保留。点击托盘图标可重新打开窗口。
- 只有选择托盘“退出 DedsiWork”才正常退出应用：Rust 通过专用 stdin 管道通知服务关闭 SQLite，并等待退出；超时后只终止自己启动的子进程。父进程意外退出造成管道断开时，服务也会自行退出。
- 重复打开应用会聚焦已有窗口，不重复启动服务。端口被其他程序占用时显示启动错误，不接管或停止其他进程。
- 系统托盘使用品牌图标：左键打开主窗口，右键可选择“打开主窗口”或“退出 DedsiWork”；退出时会同时关闭本地服务。
- **启动桌面版前先停止原有 `bun run dev`**，避免同时占用 3210 端口。可以通过 `DEDSIWORK_PORT` 指定其他端口。

### 数据和日志

桌面默认数据在 `%LOCALAPPDATA%\DedsiWork`：`dedsiwork.sqlite`、`access.json`、`desktop-service.log`。可用 `DEDSIWORK_DATA_DIR` 覆盖。升级程序不覆盖这些数据。

已有网页开发数据默认在 `src/data`，不会自动搬移。若要先沿用这些数据，可在启动桌面前设置：

```powershell
$env:DEDSIWORK_DATA_DIR = 'C:\Githubs\DedsiWork\src\data'
bun run desktop:dev
```

如需迁移，先关闭所有服务，备份后复制完整数据目录；不要在 SQLite 仍运行时只复制主数据库文件。

### 目录

- `src-tauri/`：Rust 桌面外壳、Tauri 配置、图标与 Cargo 锁文件。
- `server/desktop.ts`：桌面用 Bun 服务入口，复用现有业务层。
- `desktop-ui/`：服务启动等待页与图标源文件。
- 左上角品牌图来自 `../logo/DedsiWork-black.svg`（复制至 `web/assets/`）；桌面和托盘图标来自 `../logo/DedsiWork-icon.svg`。更新图标后运行 `bun node_modules/@tauri-apps/cli/tauri.js icon ../logo/DedsiWork-icon.svg -o src-tauri/icons`，再重新打包。
- `scripts/build-sidecar.ts`：将服务及 React 资源编译为独立 EXE。
- `scripts/desktop.ts`：桌面命令入口，为当前进程补充 Rust PATH。
- `src-tauri/target/release/bundle/nsis/`：Windows 安装包输出。

首次 Rust 构建需要联网下载依赖，之后使用 Cargo 缓存。Windows 安装包目前未配置代码签名。


React + TypeScript + shadcn/ui + Bun + SQLite 实现的本地工作项管理工具。网页和 MCP Server 使用同一业务层与数据库。

项目根目录为 `C:\Githubs\DedsiWork\src`，以下命令均在此目录执行。已使用 Bun 1.4.2 验证。

## 启动

```powershell
cd C:\Githubs\DedsiWork\src
bun install --frozen-lockfile
bun run dev
```

打开 [本地工作空间](http://127.0.0.1:3210)。首次启动会自动创建 SQLite 数据库和本地凭据文件。打开启动日志显示的 `access.json`，将其中的 `pairingCode` 粘贴到网页，即可建立有效期为 24 小时的浏览器会话。服务重启后需要重新配对。

开发模式默认数据目录为本项目的 `data`，不会自动填充演示数据。可使用 PowerShell 读取配对码：

```powershell
(Get-Content .\data\access.json | ConvertFrom-Json).pairingCode
```

`access.json` 包含本地配对码、只读 MCP 令牌 `readToken`、读写 MCP 令牌 `writeToken`。文件只保存于本机并已加入忽略规则。不要将它复制进源码或发布文件。

## 第一版功能

- 工作项创建、查看、编辑，状态、类型、优先级和截止时间管理。
- 关键词搜索、组合筛选、分页及工作项统计。
- 软删除、回收站与恢复，操作历史包含网页或 MCP 来源。
- 每 5 秒刷新可见列表；详情检测新版本，保留未保存的输入。
- 乐观并发控制：旧版本写入返回 409，不覆盖其他入口的修改。
- 创建请求幂等处理：相同身份和请求键不会重复创建。
- 7 个 MCP 工具，共用工作项业务规则。
- 本地浏览器配对、CSRF 检查、MCP 只读或读写令牌、Host 与 Origin 校验。

界面使用浅色主题：`#091540` 为标题和导航主色，`#1B2CC1` 为操作色，`#7692FF` 与 `#ABD2FA` 为辅助色，其余为黑白灰及蓝色透明度变化。shadcn/ui 组件源码位于 `web/components/ui`，主题位于 `web/index.css`。

## MCP 接入

连接类型为 **Streamable HTTP**，地址为 `http://127.0.0.1:3210/mcp`。客户端需要发送：

```http
Authorization: Bearer <access.json 中的 writeToken 或 readToken>
```

网页“服务与 MCP”页面提供连接参数示意。各 MCP 客户端配置文件的字段不同，请将 URL 和请求头填入相应位置。服务只监听本机回环地址，远端云客户端不能直接访问此地址。

| 工具                | 用途                             |
| ------------------- | -------------------------------- |
| `work_item_list`    | 搜索、筛选、分页和回收站查询     |
| `work_item_get`     | 读取详情与版本                   |
| `work_item_create`  | 创建，可携带 requestKey          |
| `work_item_update`  | 修改，必须携带 expectedVersion   |
| `work_item_delete`  | 软删除，必须携带 expectedVersion |
| `work_item_restore` | 恢复，必须携带 expectedVersion   |
| `work_item_events`  | 分页读取活动记录                 |

例如，客户端可以调用：

```json
{
  "name": "work_item_create",
  "arguments": {
    "title": "完善项目说明",
    "description": "补充启动流程与 MCP 接入方法",
    "priority": "normal",
    "requestKey": "unique-request-key"
  }
}
```

更新前调用 `work_item_get`，读取当前 `version`，随后将它作为 `expectedVersion` 提交。遇到 `VERSION_CONFLICT` 后重新读取并决定如何合并，不能直接覆盖。只读凭据调用写工具会被业务层拒绝。

项目附带真实 SDK 客户端示例。服务启动后，可在另一个终端执行：

```powershell
bun run mcp:check
```

示例默认读取开发数据目录中的 `readToken`，只列出工具和前 5 个工作项。若数据目录或端口不同，请在两个终端中设置相同的 `DEDSIWORK_DATA_DIR`、`DEDSIWORK_PORT`。

## 构建与正式运行

```powershell
bun run build
bun run start
```

构建输出前端静态文件至 `dist`，正式服务提供这些文件并运行 TypeScript 后端。正式模式默认数据目录为 `%LOCALAPPDATA%\DedsiWork`，与开发数据分开。若希望两个模式访问同一数据库，显式设置相同的数据目录：

```powershell
$env:DEDSIWORK_DATA_DIR = 'C:\Githubs\DedsiWork\src\data'
$env:DEDSIWORK_PORT = '3210'
bun run start
```

同一端口同时只能启动一个服务。源码修改使用 `bun run dev`；正式模式修改前端后需要重新构建。按 Ctrl+C 关闭服务，浏览器窗口关闭不会停止服务。

## 验证

```powershell
bun run typecheck
bun test tests
bun run build
```

也可以运行 `bun run check`。测试会启动临时回环 HTTP 服务，因此执行环境必须允许本机网络连接。

自动化测试覆盖：字段与状态规则、局部更新、冲突、幂等、回收站、权限、事务回滚、重启持久化、离线备份恢复、网页与 MCP 交叉读写、请求体大小限制和 MCP 新旧协议协商。测试只使用内存数据库或 `.qa` 下临时数据库。

浏览器验收已检查配对、创建、修改状态、删除和恢复流程。`docs/ui-preview.jpg` 为独立演示数据库的界面截图，示例记录不会进入日常使用的数据目录。

## 代码结构

```text
src/                       本项目根目录
  web/                     React 页面、shadcn/ui 组件和样式
  shared/                  前后端共享类型、校验和错误
  server/
    api 由 app.ts 提供      REST、认证与 MCP 入口分发
    services/              工作项业务规则与事务
    repositories/          SQL 与字段映射
    db/                    SQLite 初始化及版本迁移
    mcp/                   MCP 工具注册
    main.ts                本地服务启动
  tests/                   业务测试及真实 HTTP MCP 集成测试
  examples/                MCP 只读连接示例
  styles/                  Tailwind 与 shadcn 基础主题映射
  docs/                    界面截图
  data/                    开发数据与凭据，已忽略
  dist/                    构建产物，已忽略
```

数据库迁移目前内置于 `server/db/database.ts`，由 `schema_migrations` 记录版本。只有服务进程访问 SQLite。创建、修改和活动记录在同一事务中完成。

## 数据备份与当前边界

先停止服务，复制完整数据目录到备份位置。恢复时先停止服务并保留当前目录副本，再替换数据目录并重新启动。备份包括凭据文件，恢复数据库时可选择保留现有凭据；凭据变化后需要更新客户端配置。

第一版面向单用户本机使用，创建和修改使用同一个独立编辑页面，移入回收站前需要二次确认。描述支持富文本、格式工具及本地图片选择、粘贴和拖入。暂不包含自动执行器、在线备份、多用户或远程访问。MCP 提供工作项管理能力，创建工作项不会自动运行 AI 任务。


### 富文本描述

网页编辑使用 Tiptap。新富文本描述在原有 `description` 字符串中以 `<!--dedsiwork-richtext-v1-->` 开头，后面是 HTML；没有此前缀的历史描述按纯文本显示，不会自动解释 HTML。无需数据库迁移。MCP 读取和更新继续使用同一字段，修改其他字段时应省略 description，避免覆盖已有图文。

图片以 Base64 嵌入描述并随工作项及历史记录保存在 SQLite 中，不上传外部服务。支持 PNG/JPEG/GIF/WebP，选择、粘贴和拖入的单张文件最多 1 MiB；描述整体最多 2,000,000 字符（含图片编码和 HTML）。HTTP/MCP 请求上限 8 MiB。网页展示前清洗 HTML，只保留支持的格式和内嵌位图图片，外部图片不加载。

图片会增加数据库及活动记录体积，备份时仍需备份完整数据目录。旧 Markdown 源文本保持原样显示，暂不自动转换格式。


### 回收站永久删除

回收站列表支持每行永久删除、勾选批量永久删除、全选当前页。切换页面或筛选条件会清空勾选；后台刷新时，已变更版本的勾选会取消。确认弹窗列出目标并提示不可恢复，取消不会发送删除请求。

`POST /api/v1/trash/purge` 接收 `{ "items": [{ "id": "工作项 UUID", "expectedVersion": 2 }] }`，单项与批量使用同一接口，每次 1–100 项且不能重复。遵循原有写权限与浏览器 CSRF 校验。仅能删除仍在回收站且版本匹配的项目；任一项失败时整批回滚。

永久删除会移除工作项（包括图文描述）及关联活动记录，创建请求缓存只保留删除标记，旧幂等键重试返回 410，避免重新创建或返回已删除内容。不涉及磁盘安全擦除或既有备份文件清理。现有 MCP 的 `work_item_delete` 仍为移入回收站。

### Web 页面与路由

使用 React Router 的 `createBrowserRouter` 和嵌套 `Outlet`。`web/App.tsx` 负责配对、公共布局和工作空间统计，具体业务页面位于 `web/pages/`。

| 页面 | 地址 |
| --- | --- |
| 全部工作项 | `/work-items` |
| 进行中 | `/work-items/in-progress` |
| 已完成 | `/work-items/completed` |
| 回收站 | `/work-items/trash` |
| 创建工作项 | `/work-items/new` |
| 查看与修改工作项 | `/work-items/:id` |
| 服务与 MCP | `/settings/service` |

根地址自动跳转到全部工作项。页面支持直接打开、刷新和浏览器前进后退；编辑页根据地址中的 ID 从服务读取数据，配对后仍保留原目标地址。未保存时，通过菜单、返回按钮或浏览器后退离开会出现确认框；刷新、关闭页面仍使用浏览器的未保存提醒。

左侧菜单按功能模块分组，可折叠。新增功能时，在 `web/pages/` 添加页面，在 `web/router.tsx` 注册带 `handle.title` 的路由，再在 `web/navigation.ts` 添加菜单分组或子项；公共布局不必改动。菜单使用 `NavLink`，支持高亮和在新标签页打开。保留原有浅色主题与品牌配色。

开发服务使用 Bun HTML 路由回退，生产服务对页面导航返回构建后的入口 HTML；`api`、`auth`、`mcp`、`healthz` 保留服务端处理。入口使用根路径 base，确保深层页面刷新后的资源加载正确。部署到其他服务器时也需要配置对应的 SPA 回退。

本次验证：18 项既有测试通过；开发和生产模式各验证 8 个页面地址及 API/认证/健康检查边界；浏览器验证了配对保留目标地址、新建后跳转编辑地址、刷新编辑页、返回列表、菜单折叠、未保存时取消导航与后退保护。
