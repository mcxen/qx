use std::path::PathBuf;

pub(crate) mod gif;
pub(crate) mod h264;
pub(crate) mod image;

pub(crate) struct MediaOutput {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub duration_ms: u64,
}
