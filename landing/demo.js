/* Static public-data snapshot that mirrors the Qx shell. */
(() => {
  const $ = (id) => document.getElementById(id);
  const shell = document.querySelector(".demo");
  const input = $("demo-query");
  const zh = () => document.documentElement.lang === "zh-CN";
  const pick = (value) => Array.isArray(value) ? value[zh() ? 0 : 1] : value;
  const safe = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ui = {
    search: ["搜索应用和命令...", "Search apps and commands..."], all: ["全部", "All"], app: ["应用", "Apps"],
    module: ["Qx 内置", "Qx built-in"], plugin: ["扩展插件", "Extensions"], file: ["文件", "Files"],
    home: ["主页", "Home"], open: ["打开详情", "Open detail"], read: ["阅读文章", "Read article"],
    actions: ["操作", "Actions"], back: ["返回", "Back"], noMatch: ["没有匹配结果", "No matching results"],
    samples: ["真实公开数据快照 · 2026-09-12", "Public data snapshot · Sep 12, 2026"],
    latest: ["最新", "Latest"], hot: ["热门", "Hot"], feeds: ["订阅源", "Feeds"], articles: ["文章", "Articles"],
    unread: ["未读", "Unread"], source: ["来源", "Source"], topics: ["个主题", "topics"],
  };
  const t = (key) => pick(ui[key] || key);
  const icons = {
    code: '<path d="m16 3 5 2v14l-5 2-9-8-4 3v-8l4 3 9-8Z M16 3v18M7 11l9 7M7 13l9-7"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    rss: '<circle cx="5" cy="19" r="1"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/>',
    clipboard: '<rect x="7" y="4" width="10" height="4" rx="1"/><path d="M9 6H5v15h14V6h-4M8 12h8M8 16h6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
    v2ex: '<path d="M4 6h4l4 12 4-12h4M9 6l3 8 3-8"/>',
    module: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  };
  const icon = (id) => `<span class="demo-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[id] || icons.module}</svg></span>`;
  const entries = [
    { id: "code", kind: "app", title: "Visual Studio Code", sub: ["代码编辑器", "Code editor"], keys: "code vscode editor bianjiqi" },
    { id: "terminal", kind: "app", title: ["终端", "Terminal"], sub: ["命令行与开发工具", "Command line and developer tools"], keys: "terminal zhongduan shell" },
    { id: "clipboard", kind: "module", title: ["剪贴板历史", "Clipboard history"], sub: ["文本、图片、文件", "Text, images and files"], keys: "clipboard jtb copy" },
    { id: "rss", kind: "module", title: ["RSS 阅读器", "RSS reader"], sub: ["13 个订阅 · 4 个文件夹 · 5410 篇未读", "13 feeds · 4 folders · 5,410 unread"], keys: "rss yuedu reader feed" },
    { id: "files", kind: "module", title: ["文件搜索", "File search"], sub: ["优先查找最近的文件与文件夹", "Find recent files and folders first"], keys: "file search wenjian" },
    { id: "v2ex", kind: "plugin", title: "V2EX", sub: ["最新、热门与节点主题", "Latest, hot and node topics"], keys: "v2ex v2 community shequ" },
    { id: "readme", kind: "file", title: "Qx README.md", sub: ["Documents / Qx / README.md", "Documents / Qx / README.md"], keys: "qx readme markdown md" },
    { id: "design", kind: "file", title: ["搜索交互设计.md", "Search interaction.md"], sub: ["Documents / Design", "Documents / Design"], keys: "search design markdown md" },
    { id: "release", kind: "file", title: ["发布清单.md", "Release checklist.md"], sub: ["Documents / Qx", "Documents / Qx"], keys: "release checklist markdown md" },
  ];
  const v2Topics = [
    ["今晚 8 点开抢，你准备买哪款？", "iPhone · omz · 刚刚", "0"],
    ["[求职] 45+ 跨端 C++工程师，桌面应用或 chromium 相关开发", "求职 · wuruxu · 刚刚", "0"],
    ["没人管管 Anthropic 一直骂街吗", "问与答 · 565656 · 刚刚", "0"],
    ["三点了，我还没重置 gpt", "程序员 · helloboy9527 · 刚刚", "2"],
    ["有没有什么能帮忙规划自驾游的 agent 呢", "程序员 · zzzz2333 · 刚刚", "0"],
    ["你们 ChatGPT 重置了吗？", "OpenAI · ldy619354397 · 刚刚", "7"],
    ["如何彻底屏蔽 macOS26 更新提示", "Apple · ly1878 · 刚刚", "0"],
    ["FlowDesk 更新：从“私信发安装包”到官网直接下载", "分享创造 · guanghuan2008 · 刚刚", "0"],
    ["养育孩子的牙齿，父母应该知道的事", "生活 · luojiedev · 刚刚", "0"],
    ["vibe coding 的代码你怎么放心上线？", "程序员 · wildwind2333 · 1 小时前", "8"],
  ];
  const rssFeeds = [
    ["科技", "IT之家", "1796"], ["科技", "超能网", ""], ["科技", "阮一峰的网络日志", "5"],
    ["新闻", "《联合早报》-中港台-即时", ""], ["新闻", "新华社新闻_新华网", "2897"],
    ["资讯", "喷嚏-70", "29"], ["资讯", "知乎日报", "19"], ["资讯", "青年文摘", "136"],
  ];
  const rssArticles = [
    ["英伟达 CEO 黄仁勋重申：公司明年可以实现 70% 的同比增长", "IT之家 9 月 11 日消息，据外媒 TechCrunch 报道，黄仁勋再次解释公司在 AI 领域的增长预期。"],
    ["七彩虹灵创 Mini Pro 迷你主机亮相，搭载 192GB 统一内存", "AMD 推出锐龙 AI Max PRO 400 系列处理器，七彩虹展示新款迷你主机。"],
    ["月之暗面 Kimi K2.8 Preview 模型全量上线 Kimi Code", "Model ID 保持不变，客户端与第三方工具无需修改配置。"],
    ['友通推出工业 ITX 主板 ARH171/ARH173，支持移动处理器', "新主板同时支持 Meteor Lake 与 Arrow Lake 移动处理器。"],
    ["MCN 组织博主诋毁 vivo 被判赔 130 万", "vivo 法务部回应将依法维护品牌权益。"],
    ["复刻苹果首款折叠 iPhone Duo 开合透视动画", "相关动画复刻方案覆盖 Android、iOS 与 macOS。"],
    ["亚马逊与 OpenAI 合作，客户可在 ChatGPT 投放广告", "Amazon Ads 宣布新的广告合作安排。"],
    ["阿里 Qoder 推出 Mobile Use 插件，打通移动端 Agent 闭环验证", "插件覆盖鸿蒙、Android 与 iOS 的构建和交互验证。"],
  ];
  let state = { scene: "home", mode: "launcher", scope: "all", selected: 0, detail: null, rssView: "feeds", rssFeed: "IT之家", filter: "latest" };
  const title = (entry) => pick(entry.title);
  const matches = (entry, terms) => terms.every((term) => `${title(entry)} ${pick(entry.sub)} ${entry.keys}`.toLowerCase().includes(term));
  function launcherResults() {
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => (state.scope === "all" || e.kind === state.scope) && matches(e, terms));
  }
  function setChrome({ placeholder, scope, island, primary }) {
    input.placeholder = placeholder;
    $("demo-scope").textContent = `${scope} ⌄`;
    $("demo-island").textContent = island;
    $("demo-open").innerHTML = `${primary} <kbd>↵</kbd>`;
    $("demo-action").innerHTML = `${t("actions")} <kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}K</kbd>`;
    $("demo-back").innerHTML = `${t("back")} <kbd>Esc</kbd>`;
  }
  function renderContext(titleText, actions, about) {
    $("demo-context").innerHTML = `<div class="demo-context-title">${safe(titleText)}</div><div class="demo-action-list">${actions.map((x) => `<button type="button">${safe(pick(x))}</button>`).join("")}</div><div class="demo-section-title">${zh() ? "关于" : "About"}</div><div class="demo-about">${about}</div>`;
  }
  function renderLauncher() {
    const results = launcherResults();
    state.selected = Math.min(state.selected, Math.max(0, results.length - 1));
    setChrome({ placeholder: t("search"), scope: t(state.scope), island: input.value ? `${results.length} ${zh() ? "项结果" : "results"}` : `Qx · ${zh() ? "搜索就绪" : "Ready"}`, primary: t("open") });
    const home = !input.value && state.scope === "all";
    if (state.detail) {
      $("demo-content").innerHTML = `<article class="demo-article"><small>${t("samples")}</small><h3>${safe(state.detail[0])}</h3><p>${safe(state.detail[1])}</p><p>${zh() ? "客户端会在这里打开对应应用、文件预览或模块工作台。" : "The desktop client opens the matching app, file preview or module workbench here."}</p></article>`;
    } else if (home) {
      $("demo-content").innerHTML = `<div class="demo-section-title">${t("home")}</div><div class="demo-card"><div class="demo-section-title">${zh() ? "置顶入口" : "Pinned"}<span>6</span></div><div class="demo-pins">${entries.slice(0, 6).map((e) => `<button class="demo-pin" data-entry="${e.id}">${icon(e.id)}<span>${safe(title(e))}</span></button>`).join("")}</div></div><div class="demo-card"><div class="demo-section-title">${zh() ? "真实能力入口" : "Real capabilities"}</div><button class="demo-quick" data-scene-jump="rss"><strong>RSS 阅读器</strong><small>${safe(pick(entries[3].sub))}</small></button><button class="demo-quick" data-scene-jump="v2ex"><strong>V2EX</strong><small>${safe(pick(entries[5].sub))}</small></button></div>`;
    } else {
      $("demo-content").innerHTML = `<div class="demo-section-title">${t(state.scope)}<span>${results.length}</span></div><div id="demo-results" role="listbox">${results.map((e, i) => `<div class="demo-row" role="option" data-index="${i}" aria-selected="${i === state.selected}">${icon(e.id)}<span><strong>${safe(title(e))}</strong><small>${safe(pick(e.sub))}</small></span><small>${t(e.kind)}</small></div>`).join("")}</div>${results.length ? "" : `<div class="demo-empty">${t("noMatch")}</div>`}`;
    }
    const current = results[state.selected];
    renderContext(current ? title(current) : (zh() ? "快速入口" : "Quick entries"), [["剪贴板历史", "Clipboard history"], ["文件搜索", "File search"], ["RSS 阅读器", "RSS reader"], ["Qx 设置", "Qx settings"]], current ? `<strong>${safe(title(current))}</strong><p>${safe(pick(current.sub))}</p><small>${t("samples")}</small>` : `<strong>Qx</strong><p>${zh() ? "应用、文件与命令的统一入口。" : "One entry for apps, files and commands."}</p>`);
    $("demo-open").hidden = home || !!state.detail || !results.length;
    input.setAttribute("aria-expanded", String(!home));
  }
  function renderV2ex() {
    const query = input.value.trim().toLowerCase();
    const rows = v2Topics.filter((x) => x.join(" ").toLowerCase().includes(query));
    state.selected = Math.min(state.selected, Math.max(0, rows.length - 1));
    setChrome({ placeholder: zh() ? "搜索已加载主题…" : "Search loaded topics…", scope: t(state.filter), island: "V2EX · v3.1.5", primary: t("open") });
    if (state.detail) {
      $("demo-content").innerHTML = `<article class="demo-article"><span class="demo-node">${safe(state.detail[1].split(" · ")[0])}</span><h3>${safe(state.detail[0])}</h3><p>${zh() ? "这是从 V2EX 公开主题列表载入的演示条目。客户端可继续读取正文与回复，并在配置令牌后发送回复。" : "This demo item comes from V2EX's public topic list. The client can load content and replies, and post after token setup."}</p><div class="demo-replies"><strong>${safe(state.detail[2])} ${zh() ? "条回复" : "replies"}</strong></div></article>`;
    } else {
      $("demo-content").innerHTML = `<div class="demo-section-title">${t(state.filter)}<span>41</span></div><div id="demo-results" role="listbox">${rows.map((x, i) => `<div class="demo-topic" role="option" data-index="${i}" aria-selected="${i === state.selected}"><i></i><span><strong>${safe(x[0])}</strong><small>${safe(x[1])}</small></span><em>${x[2]}</em></div>`).join("")}</div>`;
    }
    const current = state.detail || rows[state.selected] || v2Topics[0];
    renderContext(current[0], [["在浏览器中打开", "Open in browser"], ["复制链接", "Copy link"], ["复制标题", "Copy title"], ["刷新", "Refresh"], ["打开 V2EX", "Open V2EX"]], `<strong>V2EX</strong><p>${zh() ? "通过 Workbench 浏览最新、热门与节点主题。" : "Browse latest, hot and node topics in Workbench."}</p><small>${t("samples")}</small>`);
    $("demo-open").hidden = !!state.detail || !rows.length;
  }
  function renderRss() {
    const articleMode = state.rssView === "articles";
    const source = articleMode ? rssArticles : rssFeeds;
    const query = input.value.trim().toLowerCase();
    const rows = source.filter((x) => x.join(" ").toLowerCase().includes(query));
    state.selected = Math.min(state.selected, Math.max(0, rows.length - 1));
    setChrome({ placeholder: articleMode ? (zh() ? `在 ${state.rssFeed} 中搜索…` : `Search ${state.rssFeed}…`) : (zh() ? "搜索订阅或文件夹…" : "Search feeds or folders…"), scope: articleMode ? t("all") : t("feeds"), island: articleMode ? `${state.rssFeed} · 120 ${t("articles")} · 120 ${t("unread")}` : `RSS 阅读器 · 13 ${t("feeds")} · 4 ${zh() ? "个文件夹" : "folders"} · 5410 ${t("unread")}`, primary: articleMode ? t("read") : (zh() ? "查看文章" : "View articles") });
    if (state.detail) {
      $("demo-content").innerHTML = `<article class="demo-article"><small>${safe(state.rssFeed)} · 9/11</small><h3>${safe(state.detail[0])}</h3><p>${safe(state.detail[1])}</p><p>${zh() ? "完整客户端支持正文阅读、图片、星标、已读状态、离线保存和浏览器打开。" : "The desktop client supports full content, images, stars, read state, offline save and browser opening."}</p></article>`;
    } else if (articleMode) {
      $("demo-content").innerHTML = `<div class="demo-section-title">${zh() ? "昨天" : "Yesterday"}<span>60</span></div><div id="demo-results" role="listbox">${rows.map((x, i) => `<div class="demo-article-row" role="option" data-index="${i}" aria-selected="${i === state.selected}"><i></i><span><strong>${safe(x[0])}</strong><small>${safe(x[1])}</small></span><time>9/11</time></div>`).join("")}</div>`;
    } else {
      let folder = "";
      $("demo-content").innerHTML = `<div class="demo-section-title">${t("feeds")}<span>13</span></div><div id="demo-results" class="demo-feed-list" role="listbox">${rows.map((x, i) => { const heading = x[0] !== folder ? `<div class="demo-folder">${safe(x[0])}</div>` : ""; folder = x[0]; return `${heading}<div class="demo-feed-row" role="option" data-index="${i}" aria-selected="${i === state.selected}">${icon("rss")}<span><strong>${safe(x[1])}</strong><small>${safe(x[0])} · ${zh() ? "23 小时前" : "23h ago"}</small></span><em>${x[2]}</em></div>`; }).join("")}</div>`;
    }
    const current = state.detail || rows[state.selected] || source[0];
    renderContext(articleMode ? (zh() ? "文章" : "Article") : (zh() ? "订阅" : "Feed"), articleMode ? [["保存文章", "Save article"], ["标为已读", "Mark as read"], ["下载文章", "Download article"], ["在浏览器中打开", "Open in browser"], ["刷新订阅", "Refresh feed"]] : [["刷新订阅", "Refresh feed"], ["设置文件夹…", "Set folder…"], ["编辑订阅", "Edit feed"], ["导入 OPML…", "Import OPML…"], ["全部刷新", "Refresh all"]], `<strong>${safe(articleMode ? current[0] : current[1])}</strong><p>${articleMode ? safe(current[1]) : "http://www.ithome.com/rss/"}</p><small>${t("samples")}</small>`);
    $("demo-open").hidden = !!state.detail || !rows.length;
  }
  function render() {
    document.querySelectorAll("[data-demo-scene]").forEach((el) => el.setAttribute("aria-selected", String(el.dataset.demoScene === state.scene)));
    input.setAttribute("aria-label", pick(ui.search));
    if (state.mode === "v2ex") renderV2ex(); else if (state.mode === "rss") renderRss(); else renderLauncher();
    $("demo-menu").innerHTML = `<button type="button" data-demo-notify="${zh() ? "已复制链接" : "Link copied"}">${zh() ? "复制链接" : "Copy link"}</button><button type="button" data-demo-notify="${zh() ? "已保存到本地" : "Saved locally"}">${zh() ? "保存" : "Save"}</button><button type="button" data-demo-notify="${zh() ? "已更新置顶入口" : "Pinned entries updated"}">${zh() ? "置顶 / 取消置顶" : "Pin / unpin"}</button>`;
    $("demo-scopes").innerHTML = ["all", "app", "module", "plugin", "file"].map((key) => `<button type="button" data-demo-scope="${key}">${state.scope === key ? "✓ " : ""}${t(key)}</button>`).join("");
    $("demo-menu").hidden = true;
    $("demo-scopes").hidden = true;
    $("demo-examples").innerHTML = `<span>${t("samples")}</span><button data-scene-jump="rss">RSS · IT之家</button><button data-scene-jump="v2ex">V2EX · ${t("latest")}</button><button data-query=".md">.md</button>`;
  }
  function setScene(scene) {
    state = { ...state, scene, mode: ["rss", "v2ex"].includes(scene) ? scene : "launcher", scope: scene === "apps" ? "app" : scene === "files" ? "file" : scene === "clipboard" ? "module" : "all", selected: 0, detail: null, rssView: "feeds" };
    input.value = scene === "files" ? ".md" : scene === "clipboard" ? "jtb" : "";
    render(); input.focus();
  }
  function currentRows() {
    if (state.mode === "v2ex") return v2Topics.filter((x) => x.join(" ").toLowerCase().includes(input.value.toLowerCase()));
    if (state.mode === "rss") return (state.rssView === "articles" ? rssArticles : rssFeeds).filter((x) => x.join(" ").toLowerCase().includes(input.value.toLowerCase()));
    return launcherResults();
  }
  function open() {
    const row = currentRows()[state.selected]; if (!row) return;
    if (state.mode === "launcher") { const e = row; if (e.id === "rss" || e.id === "v2ex") setScene(e.id); else state.detail = [title(e), pick(e.sub)]; }
    else if (state.mode === "rss" && state.rssView === "feeds") { state.rssFeed = row[1]; state.rssView = "articles"; state.selected = 0; input.value = ""; }
    else state.detail = row;
    render();
  }
  function back() {
    if (state.detail) state.detail = null;
    else if (state.mode === "rss" && state.rssView === "articles") { state.rssView = "feeds"; state.selected = 0; input.value = ""; }
    else if (state.mode !== "launcher") setScene("home");
    else if (input.value) input.value = "";
    else state.scope = "all";
    render(); input.focus();
  }
  input.addEventListener("input", () => { state.selected = 0; state.detail = null; render(); });
  $("demo-home").onclick = () => setScene("home");
  $("demo-open").onclick = open;
  $("demo-back").onclick = back;
  $("demo-action").onclick = () => { $("demo-menu").hidden = !$("demo-menu").hidden; };
  $("demo-scope").onclick = () => {
    if (state.mode === "v2ex") { state.filter = state.filter === "latest" ? "hot" : "latest"; render(); }
    else $("demo-scopes").hidden = !$("demo-scopes").hidden;
  };
  document.querySelector(".demo-stage").addEventListener("click", (event) => {
    const target = event.target.closest("[data-demo-scene],[data-scene-jump],[data-query],[data-entry],[data-index],[data-demo-scope],[data-demo-notify]");
    if (!target) return;
    if (target.dataset.demoScene) setScene(target.dataset.demoScene);
    else if (target.dataset.sceneJump) setScene(target.dataset.sceneJump);
    else if (target.dataset.query !== undefined) { setScene("home"); input.value = target.dataset.query; render(); }
    else if (target.dataset.entry) { const e = entries.find((x) => x.id === target.dataset.entry); if (e) { input.value = title(e); render(); } }
    else if (target.dataset.index !== undefined) { state.selected = Number(target.dataset.index); render(); }
    else if (target.dataset.demoScope) { state.scope = target.dataset.demoScope; state.selected = 0; state.detail = null; render(); input.focus(); }
    else if (target.dataset.demoNotify) { $("demo-island").textContent = target.dataset.demoNotify; $("demo-menu").hidden = true; }
  });
  $("demo-content").addEventListener("dblclick", (event) => { if (event.target.closest("[data-index]")) open(); });
  shell.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); back(); }
    else if (event.key === "Enter") { event.preventDefault(); open(); }
    else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key) && currentRows().length) {
      event.preventDefault(); const step = event.key.startsWith("Page") ? 6 : 1;
      state.selected = Math.max(0, Math.min(currentRows().length - 1, state.selected + (/Up$/.test(event.key) ? -step : step))); render();
    }
  });
  document.addEventListener("qx-demo-locale", render);
  render();
})();
