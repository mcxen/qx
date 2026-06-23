import { useSettingsStore } from "./modules/settings/store";

type Locale = "en" | "zh-CN";

const zh: Record<string, string> = {
  "nav.general": "通用",
  "nav.plugins": "扩展",
  "nav.shortcuts": "快捷键",
  "nav.appearance": "外观",
  "nav.rss": "RSS 阅读器",
  "nav.advanced": "高级",

  "settings.search": "搜索设置...",
  "settings.noMatches": "没有匹配的设置",
  "settings.close": "关闭",

  "general.launchAtLogin": "登录时启动",
  "general.launchAtLogin.desc": "登录后自动打开 Qx。",
  "general.language": "语言",
  "general.language.desc": "界面显示语言。",
  "general.autoUpdates": "自动更新",
  "general.autoUpdates.desc": "自动检查并安装更新。",
  "general.autoHideOnBlur": "失焦时自动隐藏",
  "general.autoHideOnBlur.desc": "当 Qx 失去焦点时隐藏启动器类视图。",
  "general.dataPath": "数据路径",
  "general.dataPath.desc": "Qx 存储数据库、截图和历史记录的位置。",
  "general.reset": "重置所有设置",
  "general.reset.desc": "将快捷键、外观和偏好恢复为默认值。",
  "general.reset.button": "重置",

  "appearance.theme": "主题",
  "appearance.theme.desc": "选择界面配色方案。",
  "appearance.theme.light": "浅色",
  "appearance.theme.dark": "深色",
  "appearance.theme.system": "跟随系统",
  "appearance.opacity": "磨砂玻璃透明度",
  "appearance.opacity.desc": "画布透明度",
  "appearance.windowSize": "窗口大小",
  "appearance.windowSize.desc": "启动器窗口尺寸（最小 400×300）。",
  "appearance.cornerRadius": "圆角",
  "appearance.cornerRadius.desc": "窗口和卡片圆角。",
  "appearance.fontSize": "字体大小",
  "appearance.fontSize.desc": "基础界面字号。",
  "appearance.homeIsland": "主页灵动岛",
  "appearance.homeIsland.desc": "搜索空闲时，启动器灵动岛显示的内容。",
  "appearance.homeIsland.default": "默认",
  "appearance.homeIsland.system": "系统",
  "appearance.systemCurves": "系统曲线",
  "appearance.systemCurves.desc": "主页灵动岛中的点状 GEEK 风格指标。",

  "rss.offlineCache": "离线内容缓存",
  "rss.offlineCache.desc": "将完整文章内容保存到本地，便于离线阅读。关闭后只保存标题和摘要。",
  "rss.maxArticles": "每个订阅源最大文章数",
  "rss.maxArticles.desc": "达到限制后，较旧的非星标文章会自动清理。",
  "rss.unlimited": "不限",

  "advanced.logLevel": "日志级别",
  "advanced.logLevel.desc": "Qx 诊断日志的详细程度。",
  "advanced.log.error": "错误",
  "advanced.log.warn": "警告",
  "advanced.log.info": "信息",
  "advanced.log.debug": "调试",
  "advanced.devMode": "开发者模式",
  "advanced.devMode.desc": "显示开发者工具和详细诊断信息。",
  "advanced.importExport": "导入 / 导出配置",
  "advanced.importExport.desc": "输入绝对路径。导入会从 JSON 读取设置；导出会将当前设置写入 JSON。",
  "advanced.import": "导入",
  "advanced.export": "导出",
  "advanced.clearCache": "清除缓存和历史",
  "advanced.clearCache.desc": "清除剪贴板历史和已缓存的截图。",
  "advanced.clear": "清除",
  "advanced.clearing": "清除中…",
  "advanced.developerTools": "开发者工具",
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

  "launcher.quickEntries": "快速入口",
  "launcher.clipboard": "剪贴板历史",
  "launcher.clipboard.desc": "置顶、常用、链接",
  "launcher.screenshot": "截图",
  "launcher.screenshot.desc": "区域或全屏捕获",
  "launcher.rss": "RSS 阅读器",
  "launcher.rss.desc": "订阅源和文章",
  "launcher.settings": "设置",
  "launcher.settings.desc": "外观和插件",
  "launcher.ready": "搜索就绪",
  "launcher.result": "条结果",
  "launcher.title": "Qx 启动器",
  "launcher.idle": "输入以搜索应用和命令",
  "launcher.open": "打开",
  "launcher.search": "搜索",
  "launcher.actions": "操作",
};

export function useLocale(): Locale {
  const language = useSettingsStore((state) => state.settings.general.language);
  return language === "zh-CN" ? "zh-CN" : "en";
}

export function useT() {
  const locale = useLocale();
  return (key: string, fallback: string): string => {
    if (locale === "zh-CN") return zh[key] ?? fallback;
    return fallback;
  };
}
