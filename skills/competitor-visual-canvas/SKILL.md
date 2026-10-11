---
name: competitor-visual-canvas
description: Collect Taobao or Tmall product main images, main videos, detail images and SKU images from IDs or links, then organize them into four regional Frames per product in SealSeek Infinite Canvas. Use for collecting competitor visual references into a canvas.
---

# 竞品视觉素材画板

## 契约与边界

输入：一个或多个商品 ID 或淘宝/天猫详情链接，可选画板名称。纯数字 ID 默认为淘宝，按输入顺序去重。输出：原始采集结果、可复用素材清单、排版计划、运行状态、核验报告和画板链接。

应用负责素材组织、命名、Frame 分组、排版和业务验收；tbcli 负责商品媒体采集；sealseek-media-cli 负责认证、媒体元信息和画板写入。采用 direct 方法：业务规则来自用户确认，服务限制来自运行时能力契约。无需私有知识库。此流程导入已有素材，无需生图或生视频。

每个商品建立四个 Frame，分别位于主图、主图视频、SKU、详情页四个大区；Frame 名称为商品所在店铺名称。四个大区从左到右依次为主图、主图视频、SKU、详情页，横向起点固定。前三个区域预留宽度，新增商品向下追加；最右侧详情页区向右追加。Frame 位置由实际尺寸和已保存区域边界确定，追加保持已有 Frame 和素材的坐标不变。单商品画板使用商品名称；多商品默认“首个商品名称 等N款”，用户指定名称优先。

| 区域 | Frame 内部 | 同类 Frame 之间 |
| --- | --- | --- |
| 主图 | 原顺序横排 | 商品输入顺序上下排 |
| 主图视频 | 原顺序横排 | 商品输入顺序上下排 |
| SKU | 原顺序网格，每行最多5张 | 商品输入顺序上下排 |
| 详情页 | 原顺序无间隙竖排，统一宽度、等比缩放 | 商品输入顺序左右排 |

每个大区顶部写入独立文字标题：主图区、主图视频区、SKU区、详情页区。标题属于画板文字元素，追加商品时复用。详情页图片首尾相接，图片间距为0，保留 Frame 外边距。图片按真实宽高等比展示；长详情图保持完整。SKU 同一区域相同链接归并，属性和 SKU 对应关系保留。空视频列表仍保留对应 Frame，并在报告中注明；未读到视频列表标 unavailable，不视为没有视频。

## 运行主线

1. 解析当前平台，加载对应 `adapters/codex.json` 、`adapters/sealseek.json` 或 `adapters/workbuddy.json`。发现 `competitor-visual-canvas version` 和 `doctor --json`。doctor 成功只是本地依赖检查。依赖不满足时停止受影响节点。
2. 解析精确依赖 Skill：分别执行 `competitor-visual-canvas tool run tbcli skill source --json` 和 `competitor-visual-canvas tool run sealseek-media skill source --json`，读取返回路径下完整当前 SKILL.md、当前主机适配与任务相关参考。通过同一 tool run 入口发现当前版本及 capabilities；要求 tbcli 支持 item media、SealSeek 支持 frame-batch、text-batch 和 media-inspect。认证和采集/写入安全规则遵循各自插件。依赖缺失返回 CAPABILITY_UNAVAILABLE，不能自行编写 API 替代。
3. 选择新的运行目录，执行 `competitor-visual-canvas collect --input ID_OR_URL [--input MORE] --run NEW_DIR --json`。应用逐商品调用 tbcli，先保存 raw 与 assets.manifest.json。已有 item media 原始结果可用重复 `--raw FILE` 导入；身份必须匹配。每个成功商品立即落盘。
4. 检查覆盖状态；登录、验证和访问异常按 tbcli 分支处理。采集错误不能据此继续请求下一个商品。返回主线第3步时使用新采集输出，保留既有结果。媒体缺失、unknown 和 absent 明确区分，部分交付须说明范围。
5. 执行 `competitor-visual-canvas plan --run DIR [--title TEXT] --json`。通过 SealSeek 通用媒体检查取得真实尺寸，保存 layout.plan.json 与 canvas.batch.json。确定性检查元素顺序、Frame 边界和无重叠。元信息失败停止规划，不用猜测尺寸冒充验证。
6. 执行 `competitor-visual-canvas canvas --run DIR --json` 预览数量与名称。在用户已授权收集到画板的范围内执行同命令加 `--submit`。首次创建一个画板；运行状态记录其 ID，恢复沿用该画板。新建和追加的 Frame 与媒体通过能力层 batch 保存，保存前保留服务内容备份。
7. 读回校验每个 Frame 的名称/位置/尺寸、素材数量/归属/位置/链接。检查 collection-report.json 的商品覆盖和缺口。向用户交付可点击画板链接、素材分类数量及中间文件位置。实际浏览器未查看时仅称读回验证通过。

依赖调用完成后分别返回采集节点3、规划节点5或写入节点6，最后回到第7步交付。依赖 Skill 的说明不复制到应用包，当前 CLI 改进通过运行时契约发现。

## 向已有画板追加商品

用户给出已有画板名称时，按完整名称精确查找：`competitor-visual-canvas find --title EXACT_TITLE --json`。唯一匹配时执行 `competitor-visual-canvas append --title EXACT_TITLE --run NEW_DIR --input ID_OR_URL [--input MORE] --json`，再按主线第6、7步预览、提交与核验。名称可包含空格与中文，作为完整参数传入。用户提供画板 ID 或链接时可使用 `append --canvas ID`。同名候选由用户选择，随后传 `--canvas ID`；也可同时传 `--title` 校验名称。CANVAS_NOT_FOUND 时报告未找到，不自动新建。

名称或 ID 追加从服务端读取当前内容，恢复本应用四区域 Frame、商品来源、已有素材及布局边界；无需旧对话或本地运行目录。恢复快照保存在本应用私有状态目录，输出 recovered_base_run。恢复依据元素的来源元数据及稳定 Frame 标识，支持空视频 Frame；保留已有元素的坐标、链接、归属和区域标题尺寸。原始采集证据、商品完整标题、SKU 属性等未保存在云端的信息标为 unavailable，不凭空补全。该方式适用于本应用当前四区域结构；缺少元数据、Frame 不完整或混入无法识别元素时返回 CANVAS_STATE_UNSUPPORTED，保留画板，使用可用的完整运行目录或交由用户决定如何整理。恢复和选择均只读，canvas --submit 才写入画板。

用户提出继续添加商品时，使用最新已完成运行目录 BASE，不新建画板。执行 `competitor-visual-canvas append --base-run BASE --run NEW_DIR --input ID_OR_URL [--input MORE] --json`，先采集并规划；预览 `canvas --run NEW_DIR --json`，再在用户授权范围内执行加 `--submit` 的同命令。可重复 `--raw FILE` 复用 item media 原始结果。

追加计划和素材清单为累计结果，沿用原画板 ID、标题、区域横向起点及旧元素 ID/位置；新商品主图、视频、SKU Frame 分别从对应区域底部继续向下，详情页 Frame 从最右侧继续向右。重复商品 ID 跳过；全部已存在时返回 changed:false。后续追加以 NEW_DIR 为最新基准，保留 BASE 作为恢复点。

默认主图/视频/SKU 区域宽度至少为2400/1600/1840画板单位，并以首批实际内容宽度扩展。既有区域的宽度固定；超宽新商品返回 REGION_CAPACITY_EXCEEDED。将限制交给用户或上层布局策略处理，不挪动旧内容，也不改变横排规则。扩展布局属于另一次明确调整。

写入前读回基准画板，保留区域标题当前的文字尺寸与字号，吸收不超过1e-6画板单位的浮点差异；标题内容和起点、素材归属与链接、实质坐标变化仍严格校验。检测手动移动和过期运行。CANVAS_CHANGED 时停止，读取最新完成的运行或由用户决定如何调整。允许未知结果恢复为同一累计计划；禁止从过期基准直接覆盖。

既有画板需要应用当前排版与标题时，先用 `competitor-visual-canvas reflow --run BASE --json` 预览迁移，再在用户明确要求调整布局时加 `--submit`。迁移通过插件通用 canvas place 执行，保持元素 ID、素材链接与归属，写前备份，读回后更新本地计划。普通追加保留既有坐标和区域标题。

## 分支与恢复

- 未知平台/短链接：通过 tbcli 支持的解析能力处理；缺失时报告 FEATURE_UNSUPPORTED，保留输入，返回第2步。
- 素材 URL 失效：用 tbcli 重新采集受影响商品到新文件，再建立新的规划；保留旧清单及来源。不能以视频封面替代视频。
- 规划失败：保留清单，修复元信息后返回第5步。已存在计划不覆盖，选择新的运行目录或保存可验证备份后开展授权修订。
- 创建结果未知：状态为 creating 时禁止再次创建。先用插件 canvas list/get 核对既有画板；确认匹配后 `competitor-visual-canvas recover --run DIR --canvas ID --submit --json` 绑定，再回到第6步。
- 保存结果未知：查询同一画板，复用同一批次和稳定 ID；再次执行 canvas 只恢复写入，不能新建另一个画板。ID 内容或布局冲突返回 IDEMPOTENCY_CONFLICT，交由应用决策。
- 目标文件已存在：保留现有文件，选新路径。应用运行文件为私有数据，不随 npm 包发布。

## 安装、维护与 QA

通过本包 CLI `skill source/status/install/update --agent codex|sealseek|workbuddy --json` 管理当前 Skill，source 是唯一来源。安装不授予淘宝或 SealSeek 服务访问权限。全局 npm 安装在业务命令启动时每日检查 latest 并自动下载安装、同步已管理 Skill 后重新执行原命令；离线沿用当前版本，更新失败保留备份，已有运行状态与服务凭证保持在包外。套件内部安装由 taobao-ai-ops 统一更新，源码由 Git 管理。手动更新使用 update install --yes；检查或开关自动更新使用 update check 和 update auto status/on/off。依赖 CLI 优先使用显式配置，其次解析本 npm 包安装的依赖，最后从 PATH 发现；开发或托管环境可用 `configure --tool TOOL --entry ABSOLUTE_CLI_PATH --submit --json` 配置外部私有工具入口，所有依赖发现和执行使用同一路径。WorkBuddy 目标支持显式安装；维护本机其他 Agent 的安装需遵循用户授权。

需要 Node.js22+、已安装的两个依赖 CLI、淘宝已登录浏览器和 SealSeek 已授权账户；视频元信息检查需要 ffprobe。平台支持以适配器证据为准。静态兼容不能代替真实 Agent 测试。

验收：每商品四个 Frame，店铺命名正确，四类覆盖明确，主图/详情顺序正确，SKU每行最多5张，元素无重叠、均在所属 Frame 内；恢复不重复创建或导入，追加前后旧元素坐标逐项保持一致。收藏清单与画板来源可追溯。生成任务质量、创意策略及竞品商业判断不在本应用范围内。
