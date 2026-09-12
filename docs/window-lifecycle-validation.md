# 窗口生命周期与 Windows 消融

本轮检查覆盖全部原生窗口所有者；原生机制验证与最终产品交互验收分别记录。
版本基线 v0.6.110，本地修复工作区，2026-09-12。

## 窗口清单与关闭语义

| 窗口 | 显示与焦点 | 隐藏/关闭 |
|---|---|---|
| main | 显式召唤恢复最小化，随后定位、显示、聚焦；普通/置顶/失焦收起设置继续独立 | `floating_panel` 维护可见状态，隐藏保留 WebView；迟到 blur 不得关闭新召唤 |
| region-picker / shade | 冻结帧准备完成后显示；交互 picker 聚焦，录制框和倒计时按协议穿透 | 完成、复制、Esc、原生关闭均走会话端口；录屏开始也走完整 picker 隐藏 |
| recording-controls | 受内容保护；指针可操作，不取得 Windows 前台 | 复用隐藏；录制期间原生关闭不能移除停止入口 |
| island | 非激活、保持指针操作；更新内容不重复抢前台 | 原生关闭同时清除 float 请求；迟到创建/show 和旧前端可见性查询不得复活它 |
| macro-cursor-overlay | 每屏透明、非激活、鼠标穿透 | 停止/拓扑变化/关闭经共享隐藏，复用时保留穿透属性 |
| tray-panel | macOS 独立面板；Windows 当前左键打开主窗口，不创建此 WebView | macOS 打开 Tray 时收起 main 必须走主窗口状态端口 |
| update-progress | 非激活属性在 show 前设置，保留取消按钮 | 原生关闭进入既有 cooperative cancel，窗口可复用；不改变安装提交阶段规则 |
| capture-pin-* | 一次性置顶图片窗口，独立拖动与关闭 | 保持销毁语义，不套用可复用窗口的 close-to-hide |

## 共享端口不变量

- [`window_composition`](../src-tauri/src/window_composition.rs) 把 cloak/hide 与
  show/uncloak 放在同一 UI 事务中。隐藏失败尝试解除 cloak；DWM 失败仍执行原生隐藏。
  端口不更改尺寸、透明度、内容保护、鼠标穿透、焦点角色或领域会话。
- [`auxiliary_window`](../src-tauri/src/auxiliary_window.rs) 的 Windows 非激活行为同时更新
  Tauri/Tao 的 `focusable=false` 与原生根 HWND。仅手工写 `WS_EX_NOACTIVATE` 会被 Tao 后续
  Show/Hide/置顶的样式重建覆盖；`.focused(false)` 只描述创建时是否聚焦。
- 主窗口隐藏状态只归 `floating_panel`，前端恢复录屏界面使用 `floating_show`。
- picker-ready 在 UI 事务内重新检查当前可见状态和是否录制，不恢复已经隐藏的 picker，
  也不把录制装饰框变回可交互全屏层。
- island 的原生显隐 generation 与前端 effect revision 分别拒绝迟到创建和迟到查询结果。

Windows 原生显示常量的激活区别参见
[Microsoft ShowWindow 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)。

## 可重复消融

运行 `pwsh -File scripts/test-windows-window-lifecycle.ps1`。程序使用真实 Tauri/WebView2
空白窗口及生产的 UI 调度、呈现和非激活实现，独立 app identifier，不加载主 Qx 设置或插件。
失败必须返回非零退出码。辅助测试程序单独嵌入 Common Controls v6 / PerMonitorV2 清单；
缺少清单时出现过 `STATUS_ENTRYPOINT_NOT_FOUND`，不能把此构建状态视为运行通过。

| 消融 | 验证目标 |
|---|---|
| A：仅原生 hide | HWND 隐藏但没有应用 cloak，作为原实现对照 |
| B：仅 cloak | 合成呈现隐藏但 HWND 仍 visible，证明不能替代正常隐藏 |
| C：完整端口 + 内容保护变化 | 连续 12 次隐藏、保护开关、显示；HWND 和几何保持不变 |
| D：加入辅助窗口 | `WS_EX_NOACTIVATE` 与前台 HWND 在显示后保持 |
| E：加入鼠标穿透 | overlay 隐藏/显示后仍保留 `WS_EX_TRANSPARENT` |
| F：加入最小化 | 显式恢复后原生 minimized=false、visible=true、cloak=false |
| G：加入原生关闭 | 辅助窗口可重开；一次性 pin 真正销毁 |
| H：组合捕获清理 | 主/辅助窗口全部隐藏后修改内容保护，仍保持 hidden+cloaked |

`npm run check` 中的窗口门禁另防止可复用窗口重新出现裸 Show/Hide，检查 close、
异步 generation、picker-ready 与主窗口失焦事务；它不冒充视觉测试。

运行结果与剩余验收见 [TASK.md](../TASK.md)。多显示器、真实 IME、macOS 原生层级和
安装态视觉残影需要各自设备复核，不能由独立空白窗口消融推定。
