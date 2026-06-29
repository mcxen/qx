import { useEffect } from "react";
import { useRssStore } from "./store";
import RssPanel from "./RssPanel";
import ArticleList from "./ArticleList";

export default function RssReader() {
  const { view, loadFeeds } = useRssStore();

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  if (view === "detail" || view === "articles") return <ArticleList />;
  return <RssPanel />;
}
