# 项目协作约定

- 每次完成代码修改后，重新构建并重启 DedsiWork 桌面客户端，并确认客户端与内嵌服务成功启动。前端、服务或共享代码均内嵌在 sidecar 中，不能仅刷新页面。
- 重启应沿用当前环境的数据目录，开发版与正式版不得共用。Windows 开发版固定使用 `%LOCALAPPDATA%\DedsiWork-dev`，正式版保留 `%LOCALAPPDATA%\DedsiWork`；不得将正式版数据复制或迁移到开发目录。已有客户端运行时先正常退出，再启动更新后的客户端。开发启动命令为在 src 目录执行 bun run desktop:dev。

## 路由传参规范

- 全系统页面路由、HTTP API、MCP 地址和分享链接统一遵循：用于定位资源的标识放入路径，不新增 `?id=…`、`?workspace=…`、`?thread=…` 等资源定位查询参数。
- 工作空间、工作项、AI 对话、提案、冲刺、远程需求快照及研发任务来源等标识均使用路径参数。例如：`/mcp/workspace/:workspaceId`、`/workspace/:workspaceId/development-tasks/:id`、`/assistant/thread/:threadId`、`/development-tasks/new/remote/:snapshotId`；HTTP 资源接口使用 `/api/v1/work-items/:id` 等形式。
- 查询参数仅用于搜索、筛选、排序、分页等查询条件，例如 `?q=关键词&page=2`。创建、修改等操作的业务数据放入请求体，不为消除查询参数而把正文或完整配置塞进 URL；认证凭据沿用认证请求头或会话机制。
- 前端资源路由的生成与解析优先复用 `src/web/route-inputs.ts`，路由声明集中在 `src/web/router.tsx`。动态路径段正确编码、解析和校验；明确指定的工作空间必须优先于当前会话空间，加载完成前不得展示其他空间的数据。
- 调整路由时同步更新页面跳转、分享与复制链接、通知入口、服务端解析、文档及相关验证。旧查询参数链接可作为兼容入口读取，但新生成的地址必须使用路径形式；兼容入口不能绕过认证、权限校验或工作空间隔离。

## UI 配色规范

- 全站采用白底、近黑文字与同色系交互的配色体系。后续新增页面、组件及修改的样式必须复用现有语义化主题变量，不得自行硬编码十六进制、RGB、HSL 等颜色，也不得使用固定色值的 Tailwind 色板类。
- 主色统一由 `src/styles/globals.css` 的 `--theme-base` 定义，文字与主按钮使用主色，辅助文字、页面底色、边框及交互背景采用全局配套色；阴影与焦点轮廓沿用主色透明度。主题变量以 `src/web/index.css` 为主；基础组件映射在 `src/styles/globals.css`，桌面表面覆盖在 `src/web/surfaces.css`。页面应使用 `var(--变量名)` 或对应的语义化 Tailwind 类（如 `bg-card`、`text-foreground`、`border-border`）。下表中的色值仅说明当前主题，不能复制到页面样式中。

| 用途 | 主题变量 | 当前配色 |
| --- | --- | --- |
| 页面背景 | `--background` | 冷灰白 `#F7F7F9` |
| 卡片背景 / 文字 | `--card` / `--card-foreground` | 白色 / 近黑主色 |
| 弹窗背景 / 文字 | `--popover` / `--popover-foreground` | 白色 / 近黑主色 |
| 正文与标题 | `--foreground` | 主色 `#080616` |
| 主按钮背景 / 文字 | `--primary` / `--primary-foreground` | 近黑主色 / 白色 |
| 次要文字与辅助图标 | `--muted-foreground` | 冷灰 `#777581` |
| 轻微背景强调 | `--muted` | 冷灰白 `#F7F7F9` |
| 次要按钮背景 / 文字 | `--secondary` / `--secondary-foreground` | 浅冷灰 `#F0EFF3` / 近黑主色 |
| 悬停、选中强调背景 / 文字 | `--accent` / `--accent-foreground` | 浅冷灰 `#F0EFF3` / 近黑主色；侧栏选中 `#E8E6EE` |
| 普通边框 | `--border` | 淡冷灰 `#E3E1E8` |
| 输入框边框 | `--input` | 近黑主色的 16% 不透明度 |
| 键盘焦点轮廓 | `--ring` | 近黑主色的 30% 不透明度 |
| 侧栏背景 | `--sidebar` | 白色 |

- 默认、悬停、选中、禁用、焦点等状态均须遵循同一主题；不得为单个业务模块另设紫色或其他品牌色。侧栏和图表使用现有 `--sidebar-*`、`--chart-*` 变量。
- 优先复用已有 UI 组件及其语义化样式。需要新的语义颜色或阴影时，先在全局主题中统一定义，再由页面引用；不得通过页面私有变量变相引入独立色板。
- 用户明确指定的特殊视觉效果（例如语音球体的彩色流光）仅限该效果本身，不得扩散到普通业务页面、按钮、卡片或弹窗。

## UI 圆角规范

- 全站遵循 [UI 规范](docs/UI规范.md)，圆角变量定义在 `src/web/index.css`，Tailwind 映射在 `src/styles/globals.css`。
- 表单控件与菜单项 8px，紧凑面板与看板卡片 12px，主要卡片和弹窗 20px；使用 `--ui-radius-*` 变量，不在业务页面新增独立圆角数值。
- 操作按钮（包括卡片进入按钮）统一采用胶囊形，使用 `--ui-radius-button`；等宽高的图标按钮呈圆形；保留悬浮侧栏与圆形图标的语义形态；页面保持开放布局，卡片内优先通过留白分组，避免嵌套小卡片。
- 基础控件外观统一由 `src/web/ui.css` 管理：普通控件高 36px、小号 32px，使用全局 `--ui-*` 变量；按钮复用 `Button` 的 `size` 与 `variant`，避免在业务页面重设同类控件外观。
- 空数据与搜索无结果统一复用 `EmptyState`，结构为图标、标题、一句二级说明；内部面板使用 `compact`，不在空状态重复放新建按钮。
- 已有分页统一为每页 12 条，复用 `src/shared/pagination.ts` 的 `PAGE_SIZE`，前后端、选择弹窗和活动记录使用同一配置。

<!-- trail:start -->
## Trail — repo context graph

This repo is indexed in `.trail/cache/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `trail map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `trail ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `trail grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `trail skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `trail callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `.trail/cache/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `trail ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `trail build` (deterministic,
no API key, $0).
<!-- trail:end -->

- 主色 RGB 通道统一定义为 `--theme-base-rgb: 8 6 22`（`#080616`），`--theme-base` 从其生成。透明色使用 `rgb(var(--theme-base-rgb) / 透明度)`，避免构建压缩器错误折叠与 transparent 的 color-mix；更换主色时只修改 RGB 通道。

- 配套浅色统一定义在 globals.css：页面 `--theme-page: #F7F7F9`、辅助文字 `--theme-subtle: #777581`、悬停 `--theme-hover: #F0EFF3`、选中 `--theme-selected: #E8E6EE`、边框 `--theme-line: #E3E1E8`。这些语义配套色独立定义，不随主色机械套用透明度；白色卡片保持不变。
