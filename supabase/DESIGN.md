# 羽球日记云端同步设计

## 结构与权限

`diary_profiles` 是管理员明确加入的 Auth UUID 白名单和同步版本。用户登录后只能读取自己的档案、课时、独立支出、设置和历史。客户端写入通过 `diary_apply`，该事务以调用者 Auth UUID 锁定对应档案，检查版本，按操作 UUID 幂等提交。关联购课支出由 `diary_spending` 投影，因此同一笔购课只计一次。软删除保留 UUID 和版本。期初保存在用户档案里，迁移保留原有账号的 22 节，新账号默认 0 节，校准只允许一条有效流水。

关闭公开注册，由管理员在 Authentication → Users 创建个人邮箱账号。在已核对项目的 SQL Editor 以管理员身份登记其现有 Auth UUID，语句为 `insert into public.diary_profiles(user_id) values ('<Auth UUID>')`。只给前端 Project URL 与 publishable key。生产启用前用匿名、未授权登录用户和已授权用户分别测试，验证 RLS 与 RPC 拒绝跨账号访问。

版本化建表脚本位于 `supabase/migrations`。权限回归脚本 `supabase/tests/diary_permissions.sql` 在隔离的 PostgreSQL 环境创建合成账号和流水，结束时回滚。它覆盖匿名 RPC 与消费视图拒绝、跨账号隔离、禁止直接写入、重复提交、版本冲突和软删除。使用生产 API 测试时，另行检查实际 Auth 会话与 Realtime。

## 合并与离线

IndexedDB 按 Auth UUID 持久化最近的云端快照、本地草稿和在途操作。Realtime 监听档案版本，回到页面、恢复联网或点击立即同步时额外主动读取。连接失败保留草稿。不同记录允许自动合并。同条记录的竞争修改、同日跨设备新增训练及不兼容的期初校准停止同步，保留两端数据。先导出本地 JSON，再由用户选择云端版本，或核对后重新登记所需变更。

历史导入先生成合并预览并要求确认。同 ID 的不同内容作为冲突。同内容但不同 ID 的历史记录按业务字段去重。旧 localStorage 和已有备份保留。若两笔确为同日同内容的独立历史交易，应在导入前核对其备注以区分。

## SQL 备份

`scripts/backup-supabase.sh` 可独立运行。为个人项目创建 `~/.config/badminton-diary/pg_service.conf` 的 `[badminton_diary]` 服务项及权限为 0600 的 `pgpass`，使用 Supabase 提供的连接参数和受信任 CA。脚本通过本机 PostgreSQL 对应版本的 `pg_dump` 导出业务数据到 `~/Library/Application Support/BadmintonDiary/Backups`。可在个人 LaunchAgent 的 ProgramArguments 中填写脚本绝对路径并设置 StartCalendarInterval。如有需要用 `PG_DUMP_BIN` 指定绝对路径，避免 launchd 的 PATH 差异。

恢复应先在隔离环境应用相同 SQL migration，准备对应 Auth 用户 UUID，再以管理员身份向空表导入 SQL 并核对流水和关联费用。SQL 备份不含 Auth 密码或平台内部表。若更换项目后 Auth UUID 不同，优先在应用中用 JSON 导入。生产恢复须先确认目标与备份。


## 10 人邀请试点

应用 `20261127000200_multi_user_pilot.sql` 时保留原档案的旧账本导入权限与最新一份旧审计快照。后续 RPC 从数据库变更生成审计，每次操作只追加本次记录差异，已有操作 UUID 继续用作幂等回执。设置仍保留在当前快照。每个请求的输入上限为 2 MiB，每类至多 3,000 条流水。客户端不上传审计历史。旧备份中的历史审计仍留在原文件，导入的记录由云端记为新增或修改。旧版写 RPC 的执行权限已撤销，部署客户端和数据库迁移后须刷新旧 PWA 实例。

停用账号请更新该档案的 `enabled=false`。直接删除 Auth 用户或档案会级联删除数据，有保留需求时使用停用。离线冷启动默认锁定。用户在私人设备选择信任后，只有 SDK 能确认本机会话仍属于最后一次在线验证的账号时才显示缓存；离线时无法立即得知管理员停用，恢复联网后会重新核对。共享设备应在使用后退出登录。

管理员可手工创建、确认邮箱并登记 Auth UUID。默认 SMTP 不能承担向普通球友发送邀请或密码重置邮件。需要自动邮件邀请时，再配置受信任的发信路径或由管理员私下分发一次性链接，并验收接受邀请流程。

在隔离数据库按顺序应用两份迁移后运行 `supabase/tests/diary_multi_user.sql`。原 `diary_permissions.sql` 用于验证第一份迁移。试点前还须用两个真实 Auth 会话和合成流水验证应用界面、Realtime 以及离线恢复。保留全量快照用于当前试点，人数增加前按实测决定增量同步和订阅策略。


## V3.1 羽球生活

| 逻辑模型 | 实际对象 |
| --- | --- |
| 用户档案、角色、设置 | `diary_profiles`、`diary_settings` |
| 课时、独立消费 | `diary_records`、`diary_expenses` |
| 运动 | `diary_activities` 保存日常打球，`diary_activity` 以稳定课时 ID 投影培训 |
| 装备、穿线 | `diary_equipment`、`diary_stringings` |
| 对账 | `diary_reconciliations`，调整继续使用课时流水 |
| 消费净流量 | `diary_cashflow`，保留支出与业务日期上的退款 |
| 审计、幂等 | `diary_history` 的版本、操作 UUID 与实际记录差异 |

业务表仅开放同账号读取。业务写入由 `diary_life_apply` 检查 Auth UID、档案状态和预期版本后，在一次事务内校验关联、更新账本、登记对账及审计。球线和对账调整使用同用户复合外键。装备、日常打球、穿线与消费的归属及独占关系在可信事务内验证。所有者的应用入口只返回启用账号和总账号数，邀请及账号状态仍由控制台管理。数据库项目所有者拥有基础设施权限，账本未采用端到端加密。装备暂存文字，不使用 Storage Bucket。

首次同步或旧客户端缓存升级使用完整快照。已同步客户端调用 `diary_life_changes`，从已确认版本开始按服务器版本和稳定条目键分页，每页最多 100 项。版本窗口在翻页中发生变化时重新获取完整一致快照。删除以墓碑传播。写入仍发送当前完整有效账本，由现有版本检查事务提交。每用户和版本字段有索引用于变动查询。

数据库备份脚本包含新增业务表，生产升级前应先用旧版对应的表清单备份。已有 Auth 用户由项目管理，业务 SQL 备份不导出认证密码。旧 JSON 可读取。含已确认对账的云端备份通过原账号核对已确认记录，空数据库的完整恢复使用管理员 SQL 备份。对账更正须重新提交确认。

依次执行基础、试点与六份羽球生活迁移。隔离环境在相应阶段执行 `diary_permissions.sql`、`diary_multi_user.sql` 和 `diary_life.sql`。发布前检查实际迁移历史和备份恢复。旧写入 RPC 已撤销，生产应用和迁移要协调切换。回滚先暂停写入，保留新增表和业务数据，使用兼容当前数据库的前端版本。

生产预检查时 Auth 的 Site URL 仍指向 `http://localhost:3000`，额外重定向白名单为空。控制台手动创建账号配合邮箱密码登录可继续使用。如以后启用邮件邀请，应先将生产 Pages 地址加入允许列表并用合成账号验收回跳。
