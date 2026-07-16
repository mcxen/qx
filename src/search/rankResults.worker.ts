/// <reference lib="webworker" />

import type { AppEntry } from "../store";
import { rankSearchResults } from "./rankResults";

interface RankRequest {
  id: number;
  entries: AppEntry[];
  query: string;
}

interface RankResponse {
  id: number;
  entries: AppEntry[];
}

self.addEventListener("message", (event: MessageEvent<RankRequest>) => {
  const { id, entries, query } = event.data;
  const response: RankResponse = {
    id,
    entries: rankSearchResults(entries, query),
  };
  self.postMessage(response);
});

export {};
