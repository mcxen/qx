use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feed {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub icon: String,
    pub last_fetched: i64,
    pub error_count: i64,
    pub unread_count: i64,
    pub created_at: i64,
    /// Optional folder id for hierarchical feed management.
    pub folder_id: Option<i64>,
    /// Denormalized folder name for UI/search (null when ungrouped).
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: i64,
    pub feed_count: i64,
}

/// One feed entry parsed from OPML (optionally under a top-level folder name).
#[derive(Debug, Clone)]
pub struct OpmlFeedEntry {
    pub url: String,
    pub title: String,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Article {
    pub id: i64,
    pub feed_id: i64,
    pub guid: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub author: String,
    pub link: String,
    pub image_url: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub published_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct ParsedFeed {
    pub title: String,
    pub icon: String,
    pub articles: Vec<ParsedArticle>,
}

#[derive(Debug, Clone)]
pub struct ParsedArticle {
    pub guid: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub author: String,
    pub link: String,
    pub image_url: String,
    pub published_at: i64,
}
