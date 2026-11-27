# 羽球日记云端同步设计

## 结构与权限

`diary_profiles` 是管理员明确加入的 Auth UUID 白名单和同步版本。用户登录后只能读取自己的档案、课时、独立支出、设置和历史。客户端写入通过 `diary_apply`，该事务以调用者 Auth UUID 锁定对应档案，检查版本，按操作 UUID 幂等提交。关联购课支出由 `diary_spending` 投影，因此同一笔购课只计一次。软删除保留 UUID 和版本。期初 22 节是公式常数，校准只允许一条有效流水。

关闭公开注册，由管理员在 Authentication → Users 创建个人邮箱账号。在已核对项目的 SQL Editor 以管理员身份登记其现有 Auth UUID，语句为 `insert into public.diary_profiles(user_id) values ('<Auth UUID>')`。只给前端 Project URL 与 publishable key。生产启用前用匿名、未授权登录用户和已授权用户分别测试，验证 RLS 与 RPC 拒绝跨账号访问。

版本化建表脚本位于 `supabase/migrations`。权限回归脚本 `supabase/tests/diary_permissions.sql` 在隔离的 PostgreSQL 环境创建合成账号和流水，结束时回滚。它覆盖匿名 RPC 与消费视图拒绝、跨账号隔离、禁止直接写入、重复提交、版本冲突和软删除。使用生产 API 测试时，另行检查实际 Auth 会话与 Realtime。

## 合并与离线

IndexedDB 按 Auth UUID 持久化最近的云端快照、本地草稿和在途操作。Realtime 监听档案版本，回到页面、恢复联网或点击立即同步时额外主动读取。连接失败保留草稿。不同记录允许自动合并。同条记录的竞争修改、同日跨设备新增训练及不兼容的期初校准停止同步，保留两端数据。先导出本地 JSON，再由用户选择云端版本，或核对后重新登记所需变更。

历史导入先生成合并预览并要求确认。同 ID 的不同内容作为冲突。同内容但不同 ID 的历史记录按业务字段去重。旧 localStorage 和已有备份保留。若两笔确为同日同内容的独立历史交易，应在导入前核对其备注以区分。

## SQL 备份

`scripts/backup-supabase.sh` 可独立运行。为个人项目创建 `~/.config/badminton-diary/pg_service.conf` 的 `[badminton_diary]` 服务项及权限为 0600 的 `pgpass`，使用 Supabase 提供的连接参数和受信任 CA。脚本通过本机 PostgreSQL 对应版本的 `pg_dump` 导出业务数据到 `~/Library/Application Support/BadmintonDiary/Backups`。可在个人 LaunchAgent 的 ProgramArguments 中填写脚本绝对路径并设置 StartCalendarInterval。如有需要用 `PG_DUMP_BIN` 指定绝对路径，避免 launchd 的 PATH 差异。

恢复应先在隔离环境应用相同 SQL migration，准备对应 Auth 用户 UUID，再以管理员身份向空表导入 SQL 并核对流水和关联费用。SQL 备份不含 Auth 密码或平台内部表。若更换项目后 Auth UUID 不同，优先在应用中用 JSON 导入。生产恢复须先确认目标与备份。
