use crate::{EventFlag, FSEventStreamEventId, ScanType};
use std::{
    ffi::{CStr, OsStr},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub struct FsEvent {
    /// The path of this event.
    pub path: PathBuf,
    /// The event type.
    pub flag: EventFlag,
    /// The event id.
    pub id: FSEventStreamEventId,
}

impl FsEvent {
    pub(crate) unsafe fn from_raw(path: *const i8, flag: u32, id: u64) -> Self {
        let path = unsafe { CStr::from_ptr(path) };
        let path = OsStr::from_bytes(path.to_bytes());
        let path = PathBuf::from(path);
        let flag = EventFlag::from_bits_truncate(flag);
        FsEvent { path, flag, id }
    }

    pub fn should_rescan(&self, root: &Path) -> bool {
        match self.flag.scan_type() {
            ScanType::ReScan => true,
            ScanType::SingleNode | ScanType::Folder if self.path == root => true,
            ScanType::SingleNode | ScanType::Folder | ScanType::Nop => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_should_rescan() {
        let root = std::path::Path::new("/root");

        // ReScan always true
        let event = FsEvent {
            path: PathBuf::from("/root/file"),
            flag: EventFlag::RootChanged,
            id: 1,
        };
        assert!(event.should_rescan(root));

        // SingleNode at root true
        let event = FsEvent {
            path: PathBuf::from("/root"),
            flag: EventFlag::ItemModified | EventFlag::ItemIsFile,
            id: 1,
        };
        assert!(event.should_rescan(root));

        // SingleNode not at root false
        let event = FsEvent {
            path: PathBuf::from("/root/sub/file"),
            flag: EventFlag::ItemModified | EventFlag::ItemIsFile,
            id: 1,
        };
        assert!(!event.should_rescan(root));

        // Nop false
        let event = FsEvent {
            path: PathBuf::from("/root/file"),
            flag: EventFlag::HistoryDone,
            id: 1,
        };
        assert!(!event.should_rescan(root));
    }
}
