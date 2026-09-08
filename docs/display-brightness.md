# 显示器亮度服务

> 状态：Current implementation · 下一宿主版本：0.6.109 · 2026-09-08

`display.rs` 保留显示器发现、捕获与公共命令门面；`display/brightness.rs` 负责亮度编排，
`display_macos.m` / `display/ddc_intel.h` 与 `display/brightness_windows.rs` 负责硬件适配，
`display/software.rs` 负责软件调光及色彩恢复。插件、Tray、Home 共享同一服务。

## 调节方式

| 方式 | 实现 | 限制 |
|---|---|---|
| macOS 原生 | 对所有屏尝试 DisplayServices，覆盖内置屏及响应该协议的 Apple 外接屏 | API 拒绝时保留真实错误；外接屏继续尝试 DDC |
| Apple Silicon DDC | IOAVService + 外部 DCP 服务与显示器的排他匹配 | 同型号且身份信息不足时拒绝猜测；扩展坞可能屏蔽 DDC |
| Intel Mac DDC | framebuffer I2C，优先 DDC reply transaction，兼容 simple reply | 无唯一 framebuffer 或无有效读值时不写入 |
| Windows 原生 | WMI `WmiMonitorBrightness*` | 依赖设备驱动公开 WMI |
| Windows DDC | 优先 VCP `0x10`，失败后使用高层 Monitor Configuration | 读写使用同一后端与真实范围，保留非零最小值 |
| 软件调光 | macOS CoreGraphics gamma table / Windows GDI gamma ramp | 只压暗图像，不改变背光；Windows 拒绝 HDR/高级色彩及未知色彩状态，虚拟屏及驱动可能拒绝 |

硬件与软件是独立目标：`id` 不透明，前端不能解析出平台句柄。软件目标的 `backend` 为
`software`，`rawCurrent/rawMax` 为 null；同一显示器可以有两个调节目标，数量不代表物理屏数。
插件用硬件/软件两个页签分开呈现，Tray 和 Home 明确标注软件调光。

`display_brightness_list()` 和 `display_brightness_set(display_id, value)` 的命令名及写入
0–100 范围保持兼容。读取失败的硬件目标仍返回 `supported=false`、`current=null` 和错误，
绝不伪造 0/100 或把找到传输服务等同于亮度可写。DDC 回复验证长度、校验和、响应类型、
结果码、VCP 代码和数值范围。写入只走实际响应读请求的 I2C 地址，不因 WriteI2C 返回成功
就随意选择另一个扩展坞地址。

## 调度与恢复

异步 semaphore 在 blocking pool 之前串行化原生事务。插件串行写入，滑动时每个目标只保留
最新值；不再人为生成逐点渐变。旧读结果用 generation 丢弃，销毁后清除队列和定时器，
已经提交到 OS 的一次写入不能撤销。失败回滚乐观值并保持错误可见，刷新不替换可用旧内容。

软件调光首次写入保存原始色彩表。逻辑 0% 保留原表 10% 的可见强度，100% 恢复原表；每次
写入后读回验证，拒绝假成功。检测到其他色彩程序修改时放弃旧会话，要求刷新，避免覆盖
Night Shift 或色彩校准。正常进程退出通过 exit hook 恢复仍由 Qx 持有的色彩表；强制终止、
GPU 重置和屏幕重新连接后的恢复依赖 OS，本版不承诺自动重放，也不持久化暗屏设置。

## 开源依据

- [MonitorControl](https://github.com/MonitorControl/MonitorControl)：核对 `Arm64DDC.swift`、
  `IntelDDC.swift` 和 `Display.swift`，采用多后端与保存原始 gamma 表的设计；MIT 归属保留
  在原生适配文件，Qx 对模糊匹配和不可读范围采取更保守的拒绝策略。
- [m1ddc](https://github.com/waydabber/m1ddc)：核对 Apple Silicon IOAV/DDC 连接限制。
- [Twinkle Tray](https://github.com/xanderfrangos/twinkle-tray)：参考 WMI + DDC 的跨设备方式。
- [Monitorian](https://github.com/emoacht/Monitorian)：参考 Windows 多显示器兼容性边界。

没有引入这些应用的完整运行时，也不要求用户安装外部显示器 CLI。

## 验证与发布门禁

`node scripts/check-display-brightness.mjs` 覆盖旧表单、滑块边界、分后端/组合、请求合并、
失败、销毁和生产 C 协议解析。`scripts/fixtures/display-brightness.html` 挂载真实 Workbench
组件，以合成设备做视觉消融。Rust 显式硬件测试：

```sh
cargo test --lib connected_display_read_write_smoke -- --ignored --nocapture
```

该测试写回硬件当前值，并短暂软件调光后恢复。它只证明当前连接的设备。本机此次仅有
内置屏，不能代替 Intel、Windows、外接 DDC、HDR、DisplayLink、AirPlay 或扩展坞测试。
插件 2.0.0 要求宿主 0.6.109，真实设备主路径未全部通过前不更新在线市场。
