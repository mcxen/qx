//! Built-in Chinese (zh-Hans) display names and aliases for Apple system apps
//! whose bundled `InfoPlist.strings` do not provide a localized Chinese name.
//!
//! Indexed by `CFBundleIdentifier` (case-insensitive match).
//! The first entry is used as the preferred zh-Hans display name when no
//! lproj-provided name is found. All entries are appended to the app's
//! aliases so the launcher can match on any of them.

pub const SYSTEM_APP_ZH: &[(&str, &[&str])] = &[
    ("com.apple.AppStore", &["App Store", "应用商店", "应用市场"]),
    ("com.apple.finder", &["访达", "Finder"]),
    ("com.apple.systempreferences", &["系统设置", "系统偏好设置"]),
    ("com.apple.Preferences", &["系统设置", "系统偏好设置"]),
    ("com.apple.mail", &["邮件"]),
    ("com.apple.Safari", &["Safari 浏览器", "浏览器"]),
    ("com.apple.Terminal", &["终端"]),
    ("com.apple.Notes", &["备忘录"]),
    ("com.apple.reminders", &["提醒事项"]),
    ("com.apple.iCal", &["日历"]),
    ("com.apple.Maps", &["地图"]),
    ("com.apple.Music", &["音乐"]),
    ("com.apple.Photos", &["照片"]),
    ("com.apple.FaceTime", &["FaceTime 通话", "FaceTime"]),
    ("com.apple.MobileSMS", &["信息", "短信"]),
    ("com.apple.AddressBook", &["通讯录"]),
    ("com.apple.ActivityMonitor", &["活动监视器"]),
    ("com.apple.DiskUtility", &["磁盘工具"]),
    ("com.apple.iBooksX", &["图书"]),
    ("com.apple.VoiceMemos", &["语音备忘录"]),
    ("com.apple.Home", &["家庭"]),
    ("com.apple.podcasts", &["播客"]),
    ("com.apple.TV", &["Apple TV", "电视"]),
    ("com.apple.news", &["新闻"]),
    ("com.apple.stocks", &["股市"]),
    ("com.apple.weather", &["天气"]),
    ("com.apple.calculator", &["计算器"]),
    ("com.apple.Preview", &["预览"]),
    ("com.apple.QuickTimePlayerX", &["QuickTime 播放器"]),
    ("com.apple.ImageCaptureApp", &["图像捕捉"]),
    ("com.apple.Image_Capture", &["图像捕捉"]),
    ("com.apple.Dictionary", &["词典"]),
    ("com.apple.shortcuts", &["快捷指令"]),
    ("com.apple.freeform", &["无边记"]),
    ("com.apple.findmy", &["查找", "查找我的"]),
    ("com.apple.Passwords", &["密码"]),
    ("com.apple.iWork.Pages", &["Pages 文稿"]),
    ("com.apple.iWork.Numbers", &["Numbers 表格"]),
    ("com.apple.iWork.Keynote", &["Keynote 讲演"]),
    ("com.apple.iChat", &["信息"]),
    ("com.apple.Console", &["控制台"]),
    ("com.apple.ScriptEditor2", &["脚本编辑器"]),
    ("com.apple.systemuiserver", &["系统 UI 服务"]),
    ("com.apple.PhotoBooth", &["照片亭"]),
    ("com.apple.Chess", &["国际象棋"]),
    ("com.apple.DigitalColorMeter", &["数码测色计"]),
    ("com.apple.grapher", &["Grapher 图形计算器", "图形计算器"]),
    ("com.apple.AudioMIDISetup", &["音频 MIDI 设置"]),
    ("com.apple.MigrateAssistant", &["迁移助理"]),
    ("com.apple.Automator", &["Automator 自动操作", "自动操作"]),
    ("com.apple.airport.airportutility", &["AirPort 实用工具"]),
    ("com.apple.bluetoothfileexchange", &["蓝牙文件交换"]),
    ("com.apple.BootCampAssistant", &["启动转换助理"]),
    ("com.apple.ColorSyncUtility", &["ColorSync 实用工具"]),
    ("com.apple.Stickies", &["便笺"]),
    ("com.apple.Music.app", &["音乐"]),
    ("com.apple.exposelauncher", &["调度中心"]),
    ("com.apple.LaunchPad", &["启动台"]),
    ("com.apple.launchpad.launcher", &["启动台"]),
    ("com.apple.ScreenSharing", &["屏幕共享"]),
    ("com.apple.screenshot.launcher", &["屏幕截图"]),
    ("com.apple.SystemProfiler", &["系统信息"]),
    ("com.apple.VoiceOverUtility", &["旁白实用工具"]),
    ("com.apple.JavaJDK17.Updater", &["Java 更新程序"]),
    ("com.apple.print.PrinterProxy", &["打印机代理"]),
    ("com.apple.Tips", &["使用诀窍"]),
    ("com.apple.TextEdit", &["文本编辑"]),
];

/// Look up zh-Hans names by bundle identifier (case-insensitive).
pub fn lookup(bundle_id: &str) -> Option<&'static [&'static str]> {
    let needle = bundle_id.to_lowercase();
    SYSTEM_APP_ZH
        .iter()
        .find(|(id, _)| id.to_lowercase() == needle)
        .map(|(_, names)| *names)
}
