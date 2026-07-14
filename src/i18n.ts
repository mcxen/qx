import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "./modules/settings/store";

/** Resolved UI locale after applying system preference. */
export type Locale = "en" | "zh-CN";

/**
 * User-facing language preference stored in settings.
 * - `system`: follow OS; only Simplified Chinese systems get `zh-CN`, else `en`
 * - `en` / `zh-CN`: force that locale
 */
export type LanguagePreference = "system" | "en" | "zh-CN";

const zh: Record<string, string> = {
  "nav.general": "通用",
  "nav.plugins": "扩展",
  "nav.shortcuts": "快捷键",
  "nav.permissions": "权限",
  "nav.appearance": "外观",
  "nav.agent": "AI Agent",
  "nav.rss": "RSS 阅读器",
  "nav.weather": "天气",
  "nav.ocr": "OCR",
  "nav.advanced": "高级",
  "nav.about": "关于",

  "settings.search": "搜索设置...",
  "settings.noMatches": "没有匹配的设置",
  "settings.close": "关闭",
  "settings.navGroup.core": "核心",
  "settings.navGroup.intelligence": "智能",
  "settings.navGroup.workspace": "工作区",
  "settings.navGroup.extensions": "扩展",
  "settings.navGroup.modules": "模块",
  "settings.navGroup.system": "系统",

  "general.startup.title": "启动与行为",
  "general.startup.desc": "控制 Qx 如何启动、隐藏以及呈现界面。",
  "general.storageUpdates.title": "更新与数据",
  "general.storageUpdates.desc": "选择更新方式和本地 Qx 数据存储位置。",
  "general.launchAtLogin": "登录时启动",
  "general.launchAtLogin.desc": "登录后自动打开 Qx。",
  "general.language": "语言",
  "general.language.desc": "界面显示语言。跟随系统时仅简体中文系统使用中文，其余系统使用英文。",
  "general.language.system": "跟随系统",
  "general.language.en": "English",
  "general.language.zh-CN": "简体中文",
  "general.autoUpdates": "自动更新",
  "general.autoUpdates.desc": "自动检查并安装更新。",
  "general.autoHideOnBlur": "失焦时自动隐藏",
  "general.autoHideOnBlur.desc": "当 Qx 失去焦点时隐藏启动器类视图。",
  "general.dataPath": "数据路径",
  "general.dataPath.desc": "Qx 存储数据库、录屏和历史记录的位置。",
  "general.reset": "重置所有设置",
  "general.reset.desc": "将快捷键、外观和偏好恢复为默认值。",
  "general.reset.confirm.desc": "当设置状态不一致，或想回到干净默认布局时使用。",
  "general.reset.button": "重置",

  "general.trayMenu": "托盘菜单",
  "general.trayMenu.desc": "自定义系统托盘菜单中显示的项目。",
  "general.trayMenu.title": "操作标题",
  "general.trayMenu.remove": "移除",
  "general.trayMenu.addAction": "添加操作",
  "general.trayMenu.add": "添加",
  "general.trayMenu.reset": "恢复默认",

  "appearance.theme": "主题",
  "appearance.theme.desc": "选择界面配色方案。",
  "appearance.surface.title": "主题与表面",
  "appearance.surface.desc": "设置整体色彩、透明度和窗口质感。",
  "appearance.layout.title": "窗口与密度",
  "appearance.layout.desc": "调整启动器尺寸、圆角和基础字号。",
  "appearance.homeIsland.title": "主页灵动岛",
  "appearance.homeIsland.cardDesc": "搜索空闲时的底部灵动岛：经典视图或科幻 HUD。",
  "appearance.theme.light": "浅色",
  "appearance.theme.dark": "深色",
  "appearance.theme.system": "跟随系统",
  "appearance.opacity": "界面透明度",
  "appearance.opacity.desc": "统一控制主壳、面板和灵动岛透明度",
  "appearance.windowSize": "窗口大小",
  "appearance.windowSize.desc": "启动器窗口尺寸（最小 400×300）。",
  "appearance.cornerRadius": "圆角",
  "appearance.cornerRadius.desc": "窗口和卡片圆角。",
  "appearance.fontSize": "字体大小",
  "appearance.fontSize.desc": "基础界面字号。",
  "appearance.homeIsland": "主页灵动岛",
  "appearance.homeIsland.desc": "搜索空闲时灵动岛显示的内容。",
  "appearance.homeIsland.default": "默认",
  "appearance.homeIsland.default.hint": "状态文案",
  "appearance.homeIsland.system": "系统",
  "appearance.homeIsland.system.hint": "CPU · MEM · GPU",
  "appearance.homeIsland.date": "日期",
  "appearance.homeIsland.date.hint": "点阵时钟",
  "appearance.homeIsland.pulse": "脉冲",
  "appearance.homeIsland.pulse.hint": "网速上下行 VU",
  "appearance.homeIsland.core": "核心",
  "appearance.homeIsland.core.hint": "电池能量条",
  "appearance.homeIsland.orbit": "轨道",
  "appearance.homeIsland.orbit.hint": "任务时钟 + CPU 环",
  "appearance.systemCurves": "系统曲线",
  "appearance.systemCurves.desc": "在「系统」灵动岛上开关各项指标。",
  "island.pulse.tag": "PULSE",
  "island.pulse.aria": "网络脉冲",
  "island.pulse.down": "下载速率",
  "island.pulse.up": "上传速率",
  "island.core.tag": "CORE",
  "island.core.aria": "电源核心",
  "island.core.bar": "电量",
  "island.core.ac": "AC",
  "island.core.chg": "CHG",
  "island.core.bat": "BAT",
  "island.core.external": "EXT",
  "island.orbit.tag": "ORBIT",
  "island.orbit.aria": "任务时钟",
  "island.orbit.time": "当前时间",
  "island.orbit.cpu": "CPU 轨道",

  "agent.mode": "Agent 模式",
  "agent.mode.desc": "允许 QxAI 和插件运行多步骤 Agent 任务，并使用统一的模型和工具配置。",
  "agent.defaultModel": "默认 Agent 模型",
  "agent.defaultModel.desc": "Agent 任务未指定 provider 或 model 时使用的模型。",
  "agent.loadingModels": "正在加载模型...",
  "agent.provider": "Agent Provider",
  "agent.model": "Agent 模型",
  "agent.noModels": "该 Provider 没有可用模型",
  "agent.noProviders": "没有可用 AI Provider",
  "agent.modelTools": "模型工具调用",
  "agent.modelTools.desc": "当运行时支持 tool schema 时，允许所选模型接收工具定义。",
  "qxai.builtinKeys": "内置供应商密钥",
  "qxai.builtinKeys.desc": "Qx 已固定接口地址和推荐模型，你只需填写 API Key。",
  "qxai.key.save": "保存密钥",
  "qxai.key.remove": "移除密钥",
  "qxai.key.saving": "保存中...",
  "qxai.key.saved": "API Key 已保存",
  "qxai.key.removed": "API Key 已移除",
  "agent.tools": "工具",
  "agent.tools.enabled": "启用工具",
  "agent.tools.enabled.desc": "Agent 工具执行的总开关。",
  "agent.tools.memory": "记忆工具",
  "agent.tools.memory.desc": "允许 Agent 读取和写入用户管理的 QxAI 记忆。",
  "agent.tools.search": "应用和文件搜索",
  "agent.tools.search.desc": "将 Qx 应用搜索和文件搜索暴露为 Agent 工具。",
  "agent.tools.apps": "应用",
  "agent.tools.files": "文件",
  "agent.tools.network": "HTTP 和通知",
  "agent.tools.network.desc": "可选的外部请求和任务完成通知工具。",
  "agent.tools.http": "HTTP",
  "agent.tools.notify": "通知",
  "agent.tools.mcp": "MCP 工具",
  "agent.tools.mcp.desc": "为 Agent Runtime 预留 MCP 工具访问能力；具体 MCP 服务仍单独配置。",
  "agent.background": "后台任务",
  "agent.background.desc": "允许 Agent 任务在 Qx 隐藏到托盘后继续运行，并在完成时通知。",
  "agent.bash": "Bash 工具",
  "agent.bash.enabled": "启用 Bash",
  "agent.bash.enabled.desc": "允许有权限的插件通过 AI runtime 执行真实 /bin/bash 脚本。",
  "agent.bash.cwd": "默认工作目录",
  "agent.bash.cwd.desc": "任务未提供 cwd 时使用的目录。留空使用应用进程 cwd。",
  "agent.bash.timeout": "Bash 超时",
  "agent.bash.timeout.desc": "每次 bash 调用的上限；插件请求会被限制在该值以内。",
  "agent.grep": "Grep 搜索",
  "agent.grep.enabled": "启用 Grep 搜索",
  "agent.grep.enabled.desc": "为 Agent 任务暴露真实 rg/grep 文本搜索工具。",
  "agent.grep.command": "搜索后端",
  "agent.grep.command.desc": "优先使用 ripgrep；grep 可作为系统兜底。",
  "agent.grep.root": "默认搜索根目录",
  "agent.grep.root.desc": "grep 任务未提供 root 时使用的目录。留空使用用户 Home。",
  "agent.grep.limit": "最大 Grep 结果数",
  "agent.grep.limit.desc": "每次 grep 搜索返回给 Agent 的结果上限。",

  "rss.offlineCache": "离线内容缓存",
  "rss.library.title": "内容库与存储",
  "rss.library.desc": "控制文章缓存、保留数量和订阅源标识。",
  "rss.reader.title": "阅读视图",
  "rss.reader.desc": "设置文章详情里的底部状态和图片展示方式。",
  "rss.typography.title": "排版",
  "rss.typography.desc": "调整长文阅读的正文大小和字体。",
  "rss.offlineCache.desc": "将完整文章内容保存到本地，便于离线阅读。关闭后只保存标题和摘要。",
  "rss.maxArticles": "每个订阅源最大文章数",
  "rss.maxArticles.desc": "达到限制后，较旧的非星标文章会自动清理。",
  "rss.unlimited": "不限",
  "rss.bottomIslandMode": "底部灵动岛",
  "rss.bottomIslandMode.desc": "阅读文章时底部状态岛显示的内容。",
  "rss.bottomIslandMode.scroll": "阅读进度",
  "rss.bottomIslandMode.index": "文章序号",
  "rss.imageDisplayMode": "图片显示模式",
  "rss.imageDisplayMode.desc": "控制文章详情中的图片尺寸。固定大小会限制宽度，全宽会铺满内容列。",
  "rss.imageDisplayMode.full": "默认全宽",
  "rss.imageDisplayMode.fixed": "固定大小",
  "rss.imageFixedWidth": "固定图片宽度",
  "rss.imageFixedWidth.desc": "固定大小模式下图片的最大宽度。",
  "rss.articleFontSize": "文章文字大小",
  "rss.articleFontSize.desc": "调整文章正文基础字号，便于长文阅读。",
  "rss.articleFontFamily": "文章字体",
  "rss.articleFontFamily.desc": "选择文章正文使用的字体。System 使用系统默认字体。",
  "rss.showFeedIcons": "显示订阅源图标",
  "rss.showFeedIcons.desc": "在订阅源列表显示来源图标。关闭后使用字母占位。",

  "nav.v2ex": "V2EX",
  "v2ex.token": "访问令牌",
  "v2ex.token.desc": "API v2 功能（通知、节点主题、回复）需要令牌。前往 v2ex.com/settings/tokens 创建。",
  "v2ex.token.placeholder": "粘贴你的 V2EX 访问令牌",
  "v2ex.token.get": "获取令牌",
  "v2ex.token.test": "测试",
  "v2ex.token.testing": "测试中...",
  "v2ex.token.valid": "令牌有效",
  "v2ex.token.times": "次",
  "v2ex.nodes": "节点",
  "v2ex.nodes.desc": "按节点查看主题时使用的节点名，用空格分隔。",
  "v2ex.hint": "最新和热门主题无需令牌。通知、节点主题和回复需要 v2ex.com/settings/tokens 的访问令牌。",

  "advanced.logLevel": "日志级别",
  "advanced.diagnostics.title": "诊断",
  "advanced.diagnostics.desc": "调整日志和开发诊断，用于排查问题。",
  "advanced.logLevel.desc": "Qx 诊断日志的详细程度。",
  "advanced.log.error": "错误",
  "advanced.log.warn": "警告",
  "advanced.log.info": "信息",
  "advanced.log.debug": "调试",
  "advanced.devMode": "开发者模式",
  "advanced.devMode.desc": "显示开发者工具和详细诊断信息。",
  "advanced.network.title": "网络",
  "advanced.network.desc": "配置扩展市场、插件下载、应用更新和网络工具使用的代理。",
  "advanced.networkProxy": "网络代理",
  "advanced.networkProxy.desc": "让 Qx 网络请求通过 HTTP、HTTPS 或 SOCKS 代理访问。",
  "advanced.importExport": "导入 / 导出配置",
  "advanced.config.title": "配置文件",
  "advanced.config.desc": "从可信本地路径导入或导出当前设置 JSON。",
  "advanced.importExport.desc": "输入绝对路径。导入会从 JSON 读取设置；导出会将当前设置写入 JSON。",
  "advanced.maintenance.title": "维护",
  "advanced.maintenance.desc": "清理生成状态，同时保留插件、文件和用户设置。",
  "advanced.import": "导入",
  "advanced.export": "导出",
  "advanced.clearCache": "清除缓存和历史",
  "advanced.clearCache.desc": "清除可重建缓存、剪贴板历史、启动/搜索历史和 RSS 离线文章。",
  "advanced.clearCache.confirm": "清除可重建缓存、剪贴板历史、启动/搜索历史和 RSS 离线文章？生成文件、插件和设置会保留。",
  "advanced.clear": "清除",
  "advanced.clearing": "清除中…",
  "advanced.developerTools": "开发者工具",
  "advanced.developerTools.desc": "创建、重载和监听本地插件项目，方便开发扩展。",
  "advanced.createPlugin": "创建插件 (qx init)",
  "advanced.createPlugin.desc": "生成包含 manifest.json、index.js 和 README 的新插件脚手架。",
  "advanced.create": "创建",
  "advanced.creating": "创建中…",
  "advanced.pluginCreated": "插件已创建：{path}",
  "advanced.error": "错误：{message}",
  "advanced.hotReload": "开发模式热重载",
  "advanced.hotReload.desc": "开发时每 3 秒自动刷新插件。",
  "advanced.startWatching": "开始监听",
  "advanced.stopWatching": "停止监听",
  "advanced.reloadPlugins": "重新加载插件",
  "advanced.reloadPlugins.desc": "手动重新扫描并加载所有已安装插件。",
  "advanced.reloadNow": "立即重新加载",

  "about.storage": "存储",
  "about.storage.desc": "查看 Qx 本地存储，并清理生成的缓存或文件。",
  "about.storage.cache": "缓存",
  "about.storage.files": "文件",
  "about.storage.databases": "数据库",
  "about.storage.clipboard": "剪贴板图片",
  "about.storage.plugins": "插件",
  "about.storage.settings": "设置",
  "about.storage.refresh": "刷新",
  "about.storage.refreshing": "刷新中...",
  "about.storage.clearCache": "清理缓存",
  "about.storage.clearFiles": "清理文件",
  "about.storage.clearClipboard": "清理剪贴板图片",
  "about.storage.cleanup": "清理目标",
  "about.storage.cleanup.cache": "可重建缓存",
  "about.storage.cleanup.cache.desc": "应用图标、OCR 模型和临时录屏目录。",
  "about.storage.cleanup.files": "生成文件",
  "about.storage.cleanup.files.desc": "输出目录中的 Qx 截图和 GIF 录制文件。",
  "about.storage.cleanup.clipboard": "剪贴板附件",
  "about.storage.cleanup.clipboard.desc": "缓存的剪贴板图片和 pasteboard 快照。文本历史会保留。",
  "about.storage.cleanup.clipboardHistory": "剪贴板历史",
  "about.storage.cleanup.clipboardHistory.desc": "所有剪贴板文本条目、图片条目和缓存附件。",
  "about.storage.cleanup.launcherHistory": "启动器历史",
  "about.storage.cleanup.launcherHistory.desc": "启动器使用的最近启动记录和搜索建议。",
  "about.storage.cleanup.rssCache": "RSS 离线文章",
  "about.storage.cleanup.rssCache.desc": "未星标的 RSS 文章。订阅源和星标文章会保留。",
  "about.storage.cleanup.reclaimable": "全部缓存和历史",
  "about.storage.cleanup.reclaimable.desc": "可重建缓存、剪贴板历史、启动器历史和 RSS 历史。生成文件不会删除。",
  "about.storage.clean": "清理",
  "about.storage.clearing": "清理中...",
  "about.storage.confirmCache": "清理可重建缓存？应用图标和 OCR 模型可重新生成或下载。",
  "about.storage.confirmFiles": "删除输出文件夹中的 Qx GIF 录制文件？",
  "about.storage.confirmClipboard": "删除已缓存的剪贴板图片？文本历史会保留。",
  "about.storage.confirmClipboardHistory": "删除所有剪贴板历史，包括文本条目和缓存图片？",
  "about.storage.confirmLauncherHistory": "清除最近启动记录和搜索建议历史？",
  "about.storage.confirmRssCache": "删除未星标的 RSS 离线文章，同时保留订阅源和星标文章？",
  "about.storage.confirmReclaimable": "清除全部缓存和历史？生成文件、插件和设置会保留。",
  "about.storage.cleared": "已清理 {size}，共 {count} 个文件。",
  "about.storage.clearedDetailed": "已清理 {items}。",
  "about.storage.clearedNothing": "没有可清理内容。",
  "about.storage.missing": "不存在",
  "about.storage.files.unit": "个文件",
  "about.storage.records.unit": "条记录",
  "about.storage.open": "打开",
  "about.storage.warnings": "部分条目已跳过：",

  "permissions.title": "macOS 权限",
  "permissions.desc": "检查 Qx 剪贴板粘贴、GIF 录屏和宏功能需要的系统权限。",
  "permissions.summary.none": "暂无可用权限",
  "permissions.summary.ready": "权限就绪度",
  "permissions.summary.desc": "只授予你使用的模块需要的权限。修改 macOS 设置后请刷新状态。",
  "permissions.requests.title": "权限请求",
  "permissions.requests.desc": "打开 macOS 授权提示，并跳转到对应的系统设置页面。",
  "permissions.screenRecording": "屏幕录制",
  "permissions.screenRecording.desc": "GIF 屏幕录制需要此权限。",
  "permissions.accessibility": "辅助功能",
  "permissions.accessibility.desc": "剪贴板粘贴、宏回放和系统自动化需要此权限。",
  "permissions.inputMonitoring": "输入监听",
  "permissions.inputMonitoring.desc": "录制键盘和鼠标宏事件需要此权限。",
  "permissions.granted": "已授权",
  "permissions.needed": "需授权",
  "permissions.unsupported": "不支持",
  "permissions.refresh": "刷新",
  "permissions.request": "请求",
  "permissions.openSettings": "打开",
  "permissions.opening": "打开中...",
  "permissions.checking": "检查中...",
  "permissions.requested": "已打开系统权限面板。授权后请重启 Qx，再刷新状态。",
  "permissions.opened": "已打开系统设置。修改授权后请重启 Qx，再刷新状态。",
  "permissions.error": "权限检查失败：{message}",

  "plugins.importArchive": "导入插件压缩包",
  "plugins.importArchive.desc": "从本地 .zip / .qx-plugin 安装，或粘贴 GitHub Release / Source archive 压缩包链接。",
  "plugins.localArchive.placeholder": "本地压缩包路径，例如 ~/Downloads/plugin.zip",
  "plugins.githubArchive.placeholder": "GitHub 仓库、Release 资源或 archive ZIP 链接",
  "plugins.installLocal": "安装本地",
  "plugins.installUrl": "安装链接",
  "plugins.installing": "安装中...",
  "plugins.downloading": "下载中...",
  "plugins.installComplete": "插件已安装。",
  "plugins.installFailed": "安装失败：{message}",

  "launcher.quickEntries": "快速入口",
  "launcher.clipboard": "剪贴板历史",
  "launcher.clipboard.desc": "置顶、常用、链接",
  "launcher.rss": "RSS 阅读器",
  "launcher.rss.desc": "订阅源和文章",
  "launcher.v2ex": "V2EX",
  "launcher.v2ex.desc": "最新和热门帖子",
  "launcher.settings": "设置",
  "launcher.settings.desc": "外观和插件",
  "launcher.weather": "天气",
  "launcher.weather.desc": "当前天气和预报",
  "launcher.qx-ai": "QxAI",
  "launcher.qx-ai.desc": "对话与 Agent 任务",
  "launcher.screencap": "屏幕录制",
  "launcher.screencap.desc": "GIF 捕获",
  "launcher.documents": "文档",
  "launcher.documents.desc": "文本、Markdown、JSON",
  "launcher.macros": "宏录制",
  "launcher.macros.desc": "录制并回放操作",
  "launcher.ready": "搜索就绪",
  "launcher.searching": "搜索中",
  "launcher.result": "条结果",
  "launcher.resultCount": "{n} 条结果",
  "launcher.title": "Qx 启动器",
  "launcher.idle": "输入以搜索应用和命令",
  "launcher.open": "打开",
  "launcher.search": "搜索",
  "launcher.actions": "操作",
  "launcher.loading": "正在加载应用...",
  "launcher.loading.detail": "正在准备应用缓存",
  "launcher.loadingApps": "正在加载应用...",
  "launcher.placeholder": "搜索应用和命令...",
  "launcher.scope": "搜索范围",
  "launcher.scope.all": "全部",
  "launcher.scope.apps": "应用",
  "launcher.scope.files": "文件",
  "launcher.scope.clipboard": "剪贴板",
  "launcher.suggestions": "建议",
  "launcher.noResults": "未找到结果",
  "launcher.recent": "最近",
  "launcher.recentSearches": "最近搜索",
  "launcher.aliasesTags": "别名与标签",
  "launcher.editQuickEntries": "编辑快速入口",
  "launcher.done": "完成",
  "launcher.add": "添加",
  "launcher.reset": "重置",
  "launcher.enabled": "已启用",
  "launcher.disabled": "已禁用",
  "launcher.removeQuickEntry": "移除快速入口",
  "launcher.quickEntryTitle": "快速入口标题",
  "launcher.quickEntrySubtitle": "快速入口副标题",
  "launcher.quickEntryTarget": "快速入口目标",
  "launcher.quickEntry": "快速入口",
  "launcher.action.fileActions": "文件操作",
  "launcher.action.clipboardActions": "剪贴板操作",
  "launcher.action.commandActions": "命令操作",
  "launcher.action.appActions": "应用操作",
  "launcher.action.copyText": "复制文本",
  "launcher.action.openClipboard": "打开剪贴板历史",
  "launcher.action.openSettings": "打开设置",
  "launcher.action.runCommand": "运行命令",
  "launcher.action.copyResult": "复制结果",
  "launcher.action.openFile": "打开文件",
  "launcher.action.openApp": "打开应用",
  "launcher.action.showInFinder": "在 Finder 中显示",
  "launcher.action.copyPath": "复制路径",
  "launcher.action.showPackage": "显示包内容",
  "launcher.editAliases": "编辑别名",
  "launcher.editShortcut": "编辑快捷键",
  "launcher.recordShortcut": "录制快捷键",
  "launcher.removeShortcut": "移除快捷键",
  "launcher.appShortcut": "应用快捷键",
  "launcher.shortcut": "快捷键",
  "launcher.shortcutConflict": "该快捷键已被其他操作占用。",
  "launcher.remove": "移除",

  "clipboard.title": "剪贴板历史",
  "clipboard.filter": "剪贴板筛选",
  "clipboard.placeholder": "输入以筛选条目...",
  "clipboard.paste": "粘贴",
  "clipboard.copy": "复制",
  "clipboard.pin": "置顶",
  "clipboard.unpin": "取消置顶",
  "clipboard.delete": "删除",
  "clipboard.compressImage": "压缩图片",
  "clipboard.videoToGif": "视频转 GIF",
  "clipboard.compress": "压缩",
  "clipboard.convertGif": "转为 GIF",
  "clipboard.copied": "已复制",
  "clipboard.pasting": "正在粘贴",
  "clipboard.pasteFailed": "粘贴失败",
  "clipboard.pinned": "已置顶",
  "clipboard.unpinned": "已取消置顶",
  "clipboard.startingCompress": "开始压缩",
  "clipboard.startingGif": "开始转换为 GIF",
  "clipboard.emptyHistory": "暂无剪贴板历史",
  "clipboard.noMatch": "没有匹配的条目",
  "clipboard.selectPreview": "选择条目以预览",
  "clipboard.emptyText": "空文本",
  "clipboard.imageAlt": "剪贴板图片",
  "clipboard.loadingFile": "正在加载文件…",
  "clipboard.info": "信息",
  "clipboard.contentType": "内容类型",
  "clipboard.characters": "字符数",
  "clipboard.words": "词数",
  "clipboard.file": "文件",
  "clipboard.kind": "类型",
  "clipboard.size": "大小",
  "clipboard.dimensions": "尺寸",
  "clipboard.duration": "时长",
  "clipboard.quickAction": "快捷操作",
  "clipboard.copiedAt": "复制时间",
  "clipboard.filter.all": "全部类型",
  "clipboard.filter.pinned": "已置顶",
  "clipboard.filter.links": "链接",
  "clipboard.filter.code": "代码",
  "clipboard.filter.long": "长文本",
  "clipboard.filter.frequent": "常用",
  "clipboard.filter.image": "图片",
  "clipboard.filter.file": "文件",
  "clipboard.section.recent": "最近",
  "clipboard.section.today": "今天",
  "clipboard.section.yesterday": "昨天",
  "clipboard.section.thisWeek": "本周",
  "clipboard.section.older": "更早",
  "clipboard.type.link": "链接",
  "clipboard.type.code": "代码",
  "clipboard.type.image": "图片",
  "clipboard.type.file": "文件",
  "clipboard.type.text": "文本",
  "clipboard.copied.today": "今天 {time}",
  "clipboard.copied.on": "{date} {time}",
  "clipboard.items": "{n} 项",
  "clipboard.listAria": "剪贴板历史",

  "common.module": "模块",
  "common.loading": "加载中",
  "common.loadingModule": "正在加载模块",
  "common.loadingNamed": "正在加载 {name}...",
  "common.moduleError": "模块错误",
  "common.back": "返回",
  "common.failedRender": "{name} 渲染失败。",
  "module.clipboard": "剪贴板",
  "module.qx-ai": "QxAI",
  "module.rss": "RSS",
  "module.screencap": "屏幕录制",
  "module.v2ex": "V2EX",
  "module.weather": "天气",
  "module.documents": "文档",
  "module.macros": "宏录制",
  "module.settings": "设置",

  "ocr.capture.title": "识别",
  "ocr.capture.desc": "启用截图、剪贴板图片和插件会用到的 OCR 能力。",
  "ocr.enable": "启用 OCR",
  "ocr.enable.desc": "为图片启用文字识别。",
  "ocr.engine.title": "识别引擎",
  "ocr.engine.cardDesc": "选择本地 OCR 识别任务使用的后端。",
  "ocr.engine": "OCR 引擎",
  "ocr.engine.desc": "选择 OCR 后端引擎。",
  "ocr.engine.appleVision": "Apple Vision（macOS 原生，无需下载）",
  "ocr.engine.oarOcr": "OAR-OCR（跨平台，需要下载模型）",
  "ocr.model.title": "OAR 模型",
  "ocr.model.desc": "选择并下载 OAR-OCR 使用的识别模型。",
  "ocr.modelSize": "模型大小",
  "ocr.modelSize.desc": "更大的模型准确率更高，但会占用更多磁盘和内存。",
  "ocr.size.tiny": "Tiny（约 5MB）",
  "ocr.size.small": "Small（约 15MB）",
  "ocr.size.medium": "Medium（约 30MB）",
  "ocr.download": "下载 OCR 模型",
  "ocr.download.desc": "下载所选 OCR 模型以启用 OAR-OCR 识别。",
  "ocr.downloadBtn": "下载 OCR 模型",
  "ocr.downloading": "下载中...",
  "ocr.downloadComplete": "下载完成！",

  "weather.loading": "加载天气中...",
  "weather.back": "返回",
  "weather.refresh": "刷新",
  "weather.retry": "重试",
  "weather.source.title": "数据源",
  "weather.source.desc": "选择天气服务，并在需要时配置 API Key。",
  "weather.provider": "数据源",
  "weather.provider.desc": "选择天气数据来源。Open-Meteo 免费且无需 API 密钥。",
  "weather.apiKey": "OpenWeatherMap API Key",
  "weather.apiKey.desc": "可选。从 openweathermap.org 获取。未填写时使用 Open-Meteo 兜底。",
  "weather.display.title": "位置与单位",
  "weather.display.desc": "设置天气查询位置和温度显示单位。",
  "weather.location": "位置",
  "weather.location.desc": "留空自动检测（IP 定位），或输入城市名（如 Beijing）或坐标（如 39.9,116.4）。",
  "weather.location.placeholder": "自动检测或输入城市/纬度,经度",
  "weather.units": "温度单位",
  "weather.units.desc": "选择温度显示单位。",
};

/** Normalize stored preference; unknown / empty values mean follow system. */
export function normalizeLanguagePreference(raw: string | null | undefined): LanguagePreference {
  if (raw === "en" || raw === "zh-CN" || raw === "system") return raw;
  return "system";
}

/**
 * Whether a BCP 47 / POSIX-ish locale tag is Simplified Chinese.
 * Traditional Chinese (zh-TW / zh-HK / zh-Hant / …) is NOT simplified.
 */
export function isSimplifiedChineseLocale(tag: string): boolean {
  const n = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!n || n === "c" || n === "posix") return false;
  // Strip encoding suffix: zh_CN.UTF-8 → handled after _ → -
  const base = n.split(".")[0] ?? n;
  if (!base.startsWith("zh")) return false;
  if (
    base.includes("hant")
    || base === "zh-tw"
    || base.startsWith("zh-tw-")
    || base === "zh-hk"
    || base.startsWith("zh-hk-")
    || base === "zh-mo"
    || base.startsWith("zh-mo-")
  ) {
    return false;
  }
  if (
    base.includes("hans")
    || base === "zh-cn"
    || base.startsWith("zh-cn-")
    || base === "zh-sg"
    || base.startsWith("zh-sg-")
    || base === "zh-my"
    || base.startsWith("zh-my-")
    || base === "zh"
  ) {
    return true;
  }
  // Other zh-* (rare) → not simplified under our product rule
  return false;
}

/** OS language tags visible to the webview (primary first). */
export function readSystemLocaleTags(): string[] {
  if (typeof navigator === "undefined") return ["en"];
  const tags: string[] = [];
  if (Array.isArray(navigator.languages)) {
    for (const tag of navigator.languages) {
      if (tag) tags.push(tag);
    }
  }
  if (navigator.language) tags.push(navigator.language);
  return tags.length > 0 ? tags : ["en"];
}

/** Product rule: Simplified Chinese system → zh-CN, otherwise English. */
export function detectSystemLocale(): Locale {
  return readSystemLocaleTags().some(isSimplifiedChineseLocale) ? "zh-CN" : "en";
}

/** Map settings preference → effective UI locale. */
export function resolveLocale(preference: string | null | undefined): Locale {
  const pref = normalizeLanguagePreference(preference);
  if (pref === "zh-CN") return "zh-CN";
  if (pref === "en") return "en";
  return detectSystemLocale();
}

export function useLanguagePreference(): LanguagePreference {
  const language = useSettingsStore((state) => state.settings.general.language);
  return normalizeLanguagePreference(language);
}

/**
 * Effective UI locale. Re-resolves when settings change or the OS fires `languagechange`.
 */
export function useLocale(): Locale {
  const preference = useLanguagePreference();
  const [systemEpoch, setSystemEpoch] = useState(0);

  useEffect(() => {
    const onLanguageChange = () => setSystemEpoch((n) => n + 1);
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  return useMemo(() => {
    void systemEpoch;
    return resolveLocale(preference);
  }, [preference, systemEpoch]);
}

/**
 * Translate UI copy. English strings live in call-site fallbacks;
 * `zh` table overrides when locale is zh-CN.
 *
 * Do NOT pass keyboard chord labels through `t()` — keep `kbd` / shortcut
 * glyphs platform-native via `formatQxShortcut` (Esc, ⌘, Ctrl, …).
 */
export function useT() {
  const locale = useLocale();
  return useCallback((key: string, fallback: string): string => {
    if (locale === "zh-CN") return zh[key] ?? fallback;
    return fallback;
  }, [locale]);
}
