//! Sequence cursor for the clipboard polling workflow.
//!
//! A sequence is committed only after its native payload was read or a
//! supported non-file format was inspected. Retryable platform failures leave
//! the cursor untouched, so the same Explorer/RDP copy is attempted again.

#[derive(Default)]
pub(super) struct CaptureCursor {
    processed: Option<i64>,
}

impl CaptureCursor {
    pub(super) fn should_attempt(&self, current: Option<i64>) -> bool {
        current.is_none() || current != self.processed
    }

    pub(super) fn commit(&mut self, current: Option<i64>) {
        self.processed = current;
    }
}

#[cfg(test)]
mod tests {
    use super::CaptureCursor;

    #[test]
    fn failed_native_reads_leave_the_same_sequence_pending() {
        let mut cursor = CaptureCursor::default();
        assert!(cursor.should_attempt(Some(42)));

        // A failed read does not call commit.
        assert!(cursor.should_attempt(Some(42)));

        cursor.commit(Some(42));
        assert!(!cursor.should_attempt(Some(42)));
        assert!(cursor.should_attempt(Some(43)));
    }

    #[test]
    fn platforms_without_sequence_numbers_continue_polling() {
        let mut cursor = CaptureCursor::default();
        cursor.commit(None);
        assert!(cursor.should_attempt(None));
    }
}
