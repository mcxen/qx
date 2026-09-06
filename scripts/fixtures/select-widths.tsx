// Development-only visual fixture. It uses the production Select and Row
// primitives, but never calls a live service or writes product settings.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Row, Select } from "../../src/components/ui";
import "../../src/App.css";

type FixtureMode = "baseline" | "shared" | "scene" | "combined";
type Locale = "en" | "zh";

const FIXTURE_STYLE = `
#select-widths-fixture {
  --fixture-preview-width: 980px;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 16px;
  overflow: auto;
  background: var(--qx-bg-100);
  color: var(--qx-text-primary);
  font: 13px/1.4 var(--qx-font-sans);
}

#select-widths-fixture * { box-sizing: border-box; }
#select-widths-fixture .fixture-toolbar,
#select-widths-fixture .fixture-toolbar-group,
#select-widths-fixture .fixture-metrics,
#select-widths-fixture .fixture-panel-head,
#select-widths-fixture .fixture-shell-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

#select-widths-fixture .fixture-toolbar {
  justify-content: space-between;
  margin-bottom: 12px;
}

#select-widths-fixture .fixture-toolbar-group { gap: 6px; }
#select-widths-fixture .fixture-toolbar label { color: var(--qx-text-secondary); }
#select-widths-fixture .fixture-title { margin: 0 0 3px; font-size: 17px; font-weight: 700; }
#select-widths-fixture .fixture-subtitle { margin: 0; color: var(--qx-text-secondary); }

#select-widths-fixture .fixture-preview {
  width: min(var(--fixture-preview-width), 100%);
  min-width: 0;
  margin: 0 auto;
  padding: 12px;
  border: 1px solid var(--qx-border-1);
  border-radius: var(--qx-card-radius);
  background: color-mix(in srgb, var(--qx-bg-component-1) 92%, transparent);
}

#select-widths-fixture .fixture-metrics {
  min-height: 24px;
  margin: 0 0 10px;
  padding: 6px 8px;
  border: 1px dashed var(--qx-border-2);
  border-radius: var(--qx-control-radius);
  color: var(--qx-text-secondary);
  font: 11px/1.35 var(--qx-font-mono);
}

#select-widths-fixture .fixture-sections {
  display: grid;
  gap: 12px;
}

#select-widths-fixture .fixture-panel {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--qx-border-1);
  border-radius: var(--qx-card-radius);
  background: color-mix(in srgb, var(--qx-bg-component-2) 88%, transparent);
}

#select-widths-fixture .fixture-panel-head {
  justify-content: space-between;
  margin-bottom: 8px;
}

#select-widths-fixture .fixture-panel-title {
  margin: 0;
  color: var(--qx-text-primary);
  font-size: 12px;
  font-weight: 700;
}

#select-widths-fixture .fixture-panel-note {
  margin: 0;
  color: var(--qx-text-tertiary);
  font-size: 11px;
}

#select-widths-fixture .fixture-settings {
  min-width: 0;
}

#select-widths-fixture .fixture-plugin-install {
  display: grid;
  gap: 8px;
  min-width: 0;
}

#select-widths-fixture .fixture-install-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

#select-widths-fixture .fixture-shell-preview {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--qx-border-1);
  border-radius: var(--qx-control-radius);
  background: var(--qx-bg-component-1);
}

#select-widths-fixture .fixture-shell-preview .qx-shell-topbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--qx-border-1);
  border-radius: var(--qx-control-radius);
  background: var(--qx-bg-component-2);
}

#select-widths-fixture .fixture-shell-search {
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--qx-border-1);
  border-radius: var(--qx-control-radius);
  color: var(--qx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#select-widths-fixture .fixture-keyboard-note {
  margin: 8px 0 0;
  color: var(--qx-text-tertiary);
  font-size: 11px;
}

/* ----- The preserved pre-change baseline ----- */
#select-widths-fixture.fixture-mode-baseline .qx-select,
#select-widths-fixture.fixture-mode-scene .qx-select {
  width: 100%;
  max-width: none;
}

#select-widths-fixture.fixture-mode-baseline .qx-inline-select,
#select-widths-fixture.fixture-mode-scene .qx-inline-select {
  width: 160px;
  max-width: 160px;
}

#select-widths-fixture.fixture-mode-baseline .qx-settings-row:not(.qx-settings-row--stacked) > .qx-settings-row-control,
#select-widths-fixture.fixture-mode-scene .qx-settings-row:not(.qx-settings-row--stacked) > .qx-settings-row-control {
  width: min(var(--qx-settings-control-width), 100%);
  flex: 0 0 var(--qx-settings-control-width);
  max-width: 100%;
}

#select-widths-fixture.fixture-mode-baseline .qx-settings-row-control > .qx-select,
#select-widths-fixture.fixture-mode-scene .qx-settings-row-control > .qx-select,
#select-widths-fixture.fixture-mode-baseline .qx-settings-row-control > .qx-inline-select,
#select-widths-fixture.fixture-mode-scene .qx-settings-row-control > .qx-inline-select {
  width: 100%;
  min-width: min(148px, 100%);
  max-width: 100%;
}

/* Scene-only ablation: undo only scene-context changes, leaving the production
   shared Select sizing active. Combined mode intentionally has no fixture rule
   and therefore depends entirely on the imported production CSS. */
#select-widths-fixture.fixture-mode-baseline .qx-plugin-install-source,
#select-widths-fixture.fixture-mode-shared .qx-plugin-install-source {
  grid-template-columns: auto minmax(150px, 220px);
  flex: 1 1 260px;
}

#select-widths-fixture.fixture-mode-baseline .qx-plugin-source-filter,
#select-widths-fixture.fixture-mode-shared .qx-plugin-source-filter {
  flex: 0 1 168px;
  min-width: 112px;
  max-width: none;
}

#select-widths-fixture.fixture-mode-baseline .qx-shell-content-filter,
#select-widths-fixture.fixture-mode-shared .qx-shell-content-filter {
  width: clamp(132px, 15vw, 188px);
  min-width: 132px;
  max-width: 188px;
  flex: 0 1 188px;
}

#select-widths-fixture.fixture-mode-baseline .qx-shell.launcher-shell .qx-shell-filter-slot,
#select-widths-fixture.fixture-mode-shared .qx-shell.launcher-shell .qx-shell-filter-slot,
#select-widths-fixture.fixture-mode-baseline .qx-shell.launcher-shell .qx-shell-content-filter,
#select-widths-fixture.fixture-mode-shared .qx-shell.launcher-shell .qx-shell-content-filter {
  width: 100%;
  max-width: none;
  flex: 1 1 auto;
}

/* Baseline/shared need the former narrow-window scene geometry as well. */
@media (max-width: 620px) {
  #select-widths-fixture.fixture-mode-baseline .qx-plugin-source-filter,
  #select-widths-fixture.fixture-mode-shared .qx-plugin-source-filter {
    flex-basis: 120px;
  }

  #select-widths-fixture.fixture-mode-baseline .qx-shell-content-filter,
  #select-widths-fixture.fixture-mode-shared .qx-shell-content-filter {
    width: min(132px, 28vw);
    min-width: min(112px, 28vw);
  }
}

`;

const MODES: Array<{ id: FixtureMode; label: string }> = [
  { id: "baseline", label: "Baseline" },
  { id: "shared", label: "Shared size" },
  { id: "scene", label: "Scene layout" },
  { id: "combined", label: "Combined" },
];

const PREVIEW_WIDTHS = [980, 620, 420] as const;

function options(locale: Locale, longLabels: boolean) {
  const zh = locale === "zh";
  const long = longLabels;
  return {
    short: [
      { value: "all", label: zh ? "全部" : "All" },
      { value: "official", label: zh ? "官方" : "Official" },
      { value: "community", label: zh ? "社区" : "Community" },
    ],
    source: [
      { value: "all", label: zh ? "全部插件库 · 21" : "All plugin libraries · 21" },
      { value: "official", label: zh ? "Qx 官方" : "Qx Official" },
      { value: "community", label: long
        ? (zh ? "社区插件库与本地镜像自动更新" : "Community plugin library with local mirror and automatic updates")
        : (zh ? "社区" : "Community") },
    ],
    shell: [
      { value: "all", label: zh ? "全部内容" : "All content" },
      { value: "saved", label: long
        ? (zh ? "仅显示已保存与最近更新内容" : "Saved and recently updated content only")
        : (zh ? "已保存" : "Saved") },
      { value: "unread", label: zh ? "未读" : "Unread" },
    ],
  };
}

function Fixture() {
  const [mode, setMode] = useState<FixtureMode>("baseline");
  const [locale, setLocale] = useState<Locale>("zh");
  const [longLabels, setLongLabels] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [previewWidth, setPreviewWidth] = useState<number>(980);
  const [event, setEvent] = useState("ready");
  const values = useMemo(() => options(locale, longLabels), [locale, longLabels]);
  const zh = locale === "zh";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const root = document.getElementById("select-widths-fixture");
    if (!root) return;
    const targets = [
      ["settings", root.querySelector<HTMLElement>("[data-fixture='settings'] .qx-select")],
      ["install", root.querySelector<HTMLElement>("[data-fixture='install'] .qx-select")],
      ["sourceFilter", root.querySelector<HTMLElement>("[data-fixture='source-filter'] .qx-select")],
      ["shellFilter", root.querySelector<HTMLElement>("[data-fixture='shell-filter'] .qx-select")],
    ] as const;
    const measure = () => {
      const result = targets
        .map(([name, node]) => `${name}=${node ? Math.round(node.getBoundingClientRect().width) : 0}`)
        .join(" · ");
      setEvent(result);
    };
    measure();
    const observer = new ResizeObserver(measure);
    targets.forEach(([, node]) => node && observer.observe(node));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, locale, longLabels, previewWidth]);

  const rootClass = `fixture-mode-${mode}`;
  const labels = {
    settingsTitle: zh ? "设置行：短/长选项" : "Settings rows: short / long options",
    settingsNote: zh ? "真实 Row + Select，共用尺寸消融" : "Real Row + Select; shared-size ablation",
    installTitle: zh ? "插件安装行" : "Plugin install row",
    sourceFilterTitle: zh ? "市场来源筛选" : "Marketplace source filter",
    shellTitle: zh ? "Shell filter" : "Shell filter",
  };

  return (
    <div id="select-widths-fixture" className={rootClass}>
      <style>{FIXTURE_STYLE}</style>
      <div className="fixture-toolbar">
        <div>
          <h1 className="fixture-title">Qx Select width ablation</h1>
          <p className="fixture-subtitle">
            {zh ? "真实 Select / Row 生产组件，测量触发器宽度与弹层文本。" : "Production Select / Row primitives; measure triggers and menu text."}
          </p>
        </div>
        <div className="fixture-toolbar-group" aria-label="Fixture controls">
          {MODES.map((item) => (
            <Button key={item.id} size="sm" variant={mode === item.id ? "default" : "outline"} onClick={() => setMode(item.id)}>
              {item.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "Dark" : "Light"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
            {locale === "zh" ? "EN" : "中文"}
          </Button>
          <Button size="sm" variant={longLabels ? "secondary" : "outline"} onClick={() => setLongLabels(!longLabels)}>
            Long labels
          </Button>
        </div>
      </div>

      <div className="fixture-toolbar">
        <div className="fixture-toolbar-group">
          <span>{zh ? "预览宽度" : "Preview width"}</span>
          {PREVIEW_WIDTHS.map((width) => (
            <Button key={width} size="sm" variant={previewWidth === width ? "secondary" : "outline"} onClick={() => setPreviewWidth(width)}>
              {width}px
            </Button>
          ))}
        </div>
        <div className="fixture-toolbar-group">
          <span>{zh ? "当前模式" : "Mode"}: <strong>{MODES.find((item) => item.id === mode)?.label}</strong></span>
          <span>{zh ? "主题" : "Theme"}: {theme}</span>
          <span>{zh ? "语言" : "Locale"}: {locale}</span>
        </div>
      </div>

      <div className="fixture-preview" style={{ "--fixture-preview-width": `${previewWidth}px` } as React.CSSProperties}>
        <div className="fixture-metrics" aria-live="polite">
          <span>{event}</span>
          <span> · {zh ? "模式切换后会自动重测" : "mode changes remeasure automatically"}</span>
        </div>
        <div className="fixture-sections">
          <section className="fixture-panel fixture-settings" data-fixture="settings">
            <div className="fixture-panel-head">
              <div>
                <h2 className="fixture-panel-title">{labels.settingsTitle}</h2>
                <p className="fixture-panel-note">{labels.settingsNote}</p>
              </div>
            </div>
            <Row
              title={zh ? "状态" : "Status"}
              description={zh ? "短选项用于观察最小宽度。" : "Short options expose the minimum width."}
            >
              <Select
                value="all"
                options={values.short}
                ariaLabel={zh ? "状态" : "Status"}
                onChange={(value) => setEvent(`settings=${value}`)}
              />
            </Row>
            <Row
              title={zh ? "来源" : "Source"}
              description={zh ? "长选项用于观察收窄与省略。" : "Long options expose shrink and ellipsis behavior."}
            >
              <Select
                value="community"
                options={values.source}
                ariaLabel={zh ? "来源" : "Source"}
                onChange={(value) => setEvent(`settings-long=${value}`)}
              />
            </Row>
          </section>

          <section className="fixture-panel fixture-plugin-install" data-fixture="install">
            <div className="fixture-panel-head">
              <div>
                <h2 className="fixture-panel-title">{labels.installTitle}</h2>
                <p className="fixture-panel-note">{zh ? "真实 qx-plugin-install-source 网格。" : "Real qx-plugin-install-source grid."}</p>
              </div>
            </div>
            <div className="fixture-install-actions">
              <div className="qx-plugin-install-source">
                <span>{zh ? "仓库源" : "Library"}</span>
                <Select
                  value="community"
                  options={values.source}
                  ariaLabel={zh ? "仓库源" : "Library"}
                  onChange={(value) => setEvent(`install=${value}`)}
                />
              </div>
              <Button size="sm" variant="default" onClick={() => setEvent("install-action")}>{zh ? "安装" : "Install"}</Button>
            </div>
          </section>

          <section className="fixture-panel" data-fixture="source-filter">
            <div className="fixture-panel-head">
              <div>
                <h2 className="fixture-panel-title">{labels.sourceFilterTitle}</h2>
                <p className="fixture-panel-note">{zh ? "真实 qx-plugin-source-filter flex 项。" : "Real qx-plugin-source-filter flex item."}</p>
              </div>
            </div>
            <div className="qx-plugin-marketplace-query">
              <div className="qx-plugin-source-filter">
                <Select
                  value="all"
                  options={values.source}
                  ariaLabel={zh ? "插件库" : "Plugin library"}
                  onChange={(value) => setEvent(`source=${value}`)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => setEvent("sources-action")}>{zh ? "仓库源" : "Sources"}</Button>
            </div>
          </section>

          <section className="fixture-panel" data-fixture="shell-filter">
            <div className="fixture-panel-head">
              <div>
                <h2 className="fixture-panel-title">{labels.shellTitle}</h2>
                <p className="fixture-panel-note">{zh ? "真实 launcher-shell filter slot + content filter。" : "Real launcher-shell filter slot + content filter."}</p>
              </div>
            </div>
            <div className="fixture-shell-preview qx-shell launcher-shell">
              <div className="qx-shell-topbar">
                <div className="fixture-shell-search">{zh ? "搜索扩展…" : "Search extensions…"}</div>
                <div className="qx-shell-trailing">
                  <div className="qx-shell-filter-slot" role="group" aria-label={zh ? "Shell 内容筛选" : "Shell content filters"}>
                    <Select
                      value="all"
                      options={values.shell}
                      ariaLabel={zh ? "Shell 内容" : "Shell content"}
                      className="qx-shell-content-filter"
                      onChange={(value) => setEvent(`shell=${value}`)}
                    />
                  </div>
                </div>
              </div>
              <p className="fixture-keyboard-note">{zh ? "点击筛选器后用 ↑↓ / Enter，检查键盘连续性。" : "Focus the filter, use ↑↓ / Enter, and check keyboard continuity."}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
