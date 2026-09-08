# 原生能力盘点与消融验证

> 状态：Current audit · 2026-09-08 · 基线：v0.6.108 (`98b3ec7`)

本轮审查入口覆盖全部注册命令，而不是把“能编译”当成所有原生功能可用。运行
`node scripts/audit-native-capabilities.mjs --json` 可生成每个命令的源文件、位置和 sync/async
入口类型；默认输出领域计数。它已接入 `npm run check`，只验证清单覆盖，不证明调用链无阻塞。
本次快照为 324 个命令、42 个模块；当前数量以脚本输出为准。

## 审查范围

| 领域 / 模块 | 审查关注点 | 本轮证据与边界 |
|---|---|---|
| display、desktop_windows、apps | 设备身份、窗口目标、发现与控制分层 | 亮度重构、唯一 DDC 匹配；捕获/几何单测基线对照；外接多屏待真机 |
| clipboard、file_manager、file_preview | 原生文件语义、范围/路径、异步缩略图 | 全量 Rust 单测；未覆盖用户剪贴板做破坏性写入；100 MB 单独压力测试待单独运行 |
| screencap、ocr | 主线程窗口、后台图像/媒体工作、取消/IME | Shell/capture 门禁、注释合成/系统字体单测；权限弹窗、实际录音录屏待安装态 |
| macro_recorder、macro_playback、macro_cursor_overlay | hook 生命周期、队列、取消与退出 | 既有宏/几何/快捷键门禁；未向用户桌面注入自动点击或按键 |
| floating_panel、island_window、tray_panel、tray_menu、lib | responder 链、显隐、平台窗口资源 | Shell/Island 门禁；新增共用滑块辅助功能修复；不等同 Windows WebView2 验收 |
| settings、startup、permissions | 全局快捷键、登录启动、TCC 边界 | 既有设置/快捷键门禁；未修改系统权限或登录项 |
| system_information、system_stats | 共享模型、平台内存/CPU/电源准确性 | macOS 真实 CPU/内存、电源、静态信息测试随 Rust suite 通过 |
| plugin_system、plugin_cli、terminal | OS 路径、进程、超时、环境与权限 | 路径/CLI/环境契约回归；CLI 使用有界独立 job worker；未执行用户终端任务 |
| plugin_api、remote_image_cache | HTTP 字节限制、权限、缓存、编码 | 接口/二进制/桥接回归；大响应编码仍可优化为后台 CPU 工作 |
| marketplace、updater | ZIP 安全、下载、磁盘替换、签名与错误回收 | 修复下载落盘和 URL 安装的 blocking 边界；本地测试服务器/临时目录 updater 测试通过 |
| storage、history、text_toolbox、diagnostics | 数据持久化、边界、日志 | 全量已有测试与架构门禁；不在真实用户数据库上清理、删历史或做迁移消融 |
| rss、weather、v2ex、github_calendar、g4f | 网络与原生线程边界 | API/架构检查；不是此次线上服务可用性认证 |
| qx_ai_sessions、qx_ai_schedule、qx_ai_memory、qx_ai_skills、qx_ai_mcp | 持久化、后台任务、工具边界 | QxAI/工具和 Rust 回归；未替用户连接外部账号或触发计划任务 |

## Diff 审查结论

已修复：DDC 读失败假值、多屏重复绑定、模糊匹配、DDC 回复不完整校验、扩展坞读写地址
不一致、逐点写入堆积、Windows 空名称目标读写 ID 不一致，以及插件错误被隐藏。软件调光
增加独立标识、范围保护、读回、色彩干扰检测和退出恢复。共享 Workbench 只增加可选 slider，
旧 text/number/select/textarea 与 IPC 名称保持兼容。

额外发现并修复：`download_plugin` 在 async command 内直接磁盘写入，
`install_plugin_from_url` 在同一线程同步解压/安装。两者移到 `runtime::blocking`；下载仍用
异步 HTTP，权限、归档校验与安装规则未改变。

尚需后续审查/优化（不能记作本轮全部原生能力已通过）：冻结 Raycast 导入仍有同步转换路径；
`plugin_http_fetch` 的有界大响应编码与 RSS 原文 HTML 清理仍在 async worker 做 CPU 工作。
仅查到 `Command::new` 不代表阻塞：CLI 的实际 spawn/wait 位于有界 job worker，HTTP `.status()`
读取响应状态也不是子进程等待。盘点脚本不会把这种文本命中自动判定为缺陷。

## 消融记录

| 验证层 | 操作 | 结果 |
|---|---|---|
| 原始基线 | 独立 v0.6.108 worktree + qx-plugins v1.8.8，完整 `npm run check` | 通过 |
| 原始 Rust | 同一基线 `cargo test --lib` | 231 passed，1 ignored（约 100 MB 压力用例） |
| 安装线程独立 | 原始基线仅应用 marketplace blocking 修复，完整 Rust suite | 231 passed，1 ignored |
| 最终组合 | 完整 `npm run check`、前端 build、Rust suite | 通过；232 passed，2 ignored（压力与显式设备用例）；设备用例另行通过 |
| 共享表单独立 | 旧四种表单 + 新 slider 数值/错误边界 | 通过 |
| 后端协议独立 | 生产 C 解码器：300 原始范围、错误码/VCP/校验和/范围；精确/模糊/弱匹配 | 通过 |
| 插件各后端及组合 | native、DDC、software 各自与组合，合成响应 | 通过，仅回归证据 |
| 写入生命周期 | 连续输入只写最新值、失败回退、切目标、销毁禁止尾随写 | 通过 |
| 浏览器 | 真实 Workbench，明暗 × 320/640/980 × 硬件/软件/失败/旧表单 | 24 组无横溢出；方向键、Home/End、禁用态通过 |
| 当前连接设备 | 内置屏读/同值写；软件 95% → 100% 恢复 | 通过；没有外接 DDC 设备 |
| Intel 适配编译 | clang x86_64 语法检查 | 通过；不是 Intel 设备验收 |
| Windows / 发布 | Windows 编译、NSIS、外接 DDC 与驱动矩阵 | 待验证，不将 macOS 成功当成 Windows 成功 |

版本差分、独立检查与组合回归分别保留，不通过删除用户缓存、重置数据库或修改权限来
制造“干净基线”。本轮源码变更已超过 1200 行发布阈值，但插件真实设备上架门禁尚未满足，
不把未经验证的 Windows/外接屏实现发布到市场；完成这些路径后再整批执行发布检查。
