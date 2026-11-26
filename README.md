# 羽球课时账本 PWA 2.1.0

起始余额 22 节，由购课与消课流水实时计算。支持正常上课、补课、赠送课、快捷课时及两位小数的自定义课时。续购可填写金额。历史可搜索、撤销，并提供重复确认、低余额和超课提醒。

## 在线访问

尚待开通 GitHub Pages。启用后的地址格式为 `https://<GitHub 用户名>.github.io/badminton-tracker/`。

## 本地运行

在项目目录执行 `python3 -m http.server 8000 --bind 127.0.0.1`，访问 `http://localhost:8000/`。首次在线打开并等待 Service Worker 安装后，可以离线使用。

## iPhone Chrome 添加到主屏幕

用 Chrome 打开正式 HTTPS 地址，点地址栏的分享按钮，选择「添加到主屏幕」，再点「添加」。如系统显示「作为网页 App 打开」，启用后再添加。随后从主屏幕图标启动。 [Google Chrome 帮助](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS)

## 保存与备份

流水保存在当前浏览器的本地存储。网页域名、浏览器、设备或主屏幕安装环境变化时，请先导出 JSON，再到新环境恢复并核对余额。清除网站数据会移除本地账本。恢复备份需要确认，完成后会替换当前流水。CSV 用于查看和分析，恢复请使用 JSON。

## 更新与重新部署

让 Codex 在本目录修改并测试，保留旧数据兼容性，同时更新 Service Worker 缓存版本。经授权提交并推送至 `main`。GitHub 仓库 Settings → Pages 中选择 Deploy from a branch、`main`、`/(root)`，启用 Enforce HTTPS。后续推送会触发 Pages 构建。

## 常见问题

- 页面或资源 404 时，查看 Pages 构建结果、发布分支和路径，并检查资源链接是否使用相对路径。
- 界面仍是旧版本时，联网打开页面，等待 Service Worker 更新后再重新打开。保留站点数据以保留流水。
- 离线打不开时，恢复网络，重新访问页面并等待缓存安装，再测试离线启动。
- 显示保存失败时，检查浏览器存储权限或空间，导出已有记录后再处理。
