# QxShell 公共协议重构验证

## 边界

本轮改动限前端公共协议和宿主投影，不改变 Rust 命令或插件 wire/权限。QxShell 从 1167 行减至 349 行；动作、布局测量、窗口操作各有明确所有者。原有超长业务模块仅迁移 Shell 接线，不在本轮拆其业务流程。

## 可重复消融

`npm run check` 包含 `scripts/check-shell-contracts.mjs`，直接执行生产 Action executor、菜单 generation 和分栏边界纯函数，不用源码字符串代替行为断言。

浏览器：先 `npm run dev -- --host 127.0.0.1`，再 `npm run test:shell-browser`。
需要本地 Google Chrome；可用 `QX_FIXTURE_URL` 指定夹具 URL。夹具运行真实 QxShell、ActionList、Island、模块 shell hook 与分栏，原生 IPC 使用无副作用 mock，不读写产品设置或调用插件业务服务。

| 组 | 开启内容 | 验证 |
|---|---|---|
| baseline | Shell 和空闲预览 | chrome、宽度和溢出基线 |
| actions | 公共执行器、菜单 | 四入口一致、禁用、防连击、异步拒绝、关闭/切路由迟到结果、请求乱序、失败重试、真实焦点、IME 与光标键 |
| feedback | 错误/任务会话 | 预览让位、错误详情可达、稳定 TTL/排序、不增高正文或底栏 |
| layout | 内容模式、双分栏 | 拖动结束才持久化、键盘折叠恢复、容器切换、窗口收缩、存储拒绝、卸载清理、Esc 每次一层 |
| combined | 上述组合 | 状态与焦点交互、窄窗碰撞 |

五组分别覆盖 light/dark × en/zh × 360/680/760/860/980/1200px，共 120 个布局组合。测试比较实际 DOM 几何、焦点和回调执行次数，截图辅助检查 360px 长错误。

## 验证记录（2026-09-21）

- `npm run check`、`npx tsc --noEmit`、`npm run build` 与浏览器回归通过；构建仍有既有大 chunk 提示。
- 发布范围另外在隔离 worktree 验证，使用提交所指向的插件 gitlink。`cargo fmt --check` 和 macOS `cargo check` 通过；后者保留既有 unused/dead-code 和 block crate future-incompat 提示，不代表 Windows 构建或原生窗口验收。
- 新增/重构的 Shell 控制器均少于 1000 行。保留插件序列化 Action 契约，宿主适配无需插件升级。
- Web Interface Guidelines 检查用于补齐菜单焦点、combobox/listbox 语义和图标 accessible name；布局、密度、主题继续以 UI_SPEC 为准。
- 浏览器夹具不是安装版实机验收。启动器、剪贴板、RSS、QxAI、设置、插件 Workbench 的 macOS 原生焦点/TCC/窗口显隐，以及 Windows WebView2/NSIS 验收仍待运行；本轮未替换用户安装的 Qx，也未声称这些已通过。
- 发布仅提交本轮范围；同工作区并行 QxAI 记忆代码保留、不合入本次标签。发布工作流只取一次状态快照，不等待 Windows 构建。
