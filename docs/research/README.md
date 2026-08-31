# Qx 研究与提案

> 状态：Research · 非当前产品契约

这里放尚未成为交付能力的调研、比较和方案草案。它们可用于决策，但不得被 README、用户指南或插件作者文档描述成已经可用的接口。

| 文档 | 研究问题 | 当前状态 |
|---|---|---|
| [`macos-widget-plugin-research.md`](./macos-widget-plugin-research.md) | 原生 WidgetKit surface 与 App Group | 未进入当前插件协议 |
| [`mobile-plugin-portability-research.md`](./mobile-plugin-portability-research.md) | Android/iOS 插件可移植性 | 决策前调研 |
| [`plugin-design-research.md`](./plugin-design-research.md) | 启动器插件模型横向比较 | 背景研究 |

研究结论落地时，先冻结窄接口并更新 `docs/` 或 `public/doc/` 的对应 Current 文档，再实现和验证；不要直接把研究页改成混合了现状与路线图的长期规范。
