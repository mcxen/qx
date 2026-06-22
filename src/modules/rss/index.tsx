import { useEffect } from "react";
import { useRssStore } from "./store";
import RssPanel from "./RssPanel";
import ArticleList from "./ArticleList";
import ArticleDetail from "./ArticleDetail";

export default function RssReader() {
  const { view, loadFeeds } = useRssStore();

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  if (view === "detail") return <ArticleDetail />;
  if (view === "articles") return <ArticleList />;
  return <RssPanel />;
}
