use super::*;

#[test]
fn wait_is_cancelled_without_sleeping_to_the_end() {
    let control = PlaybackControl::new();
    let mut ticks = 0;
    let completed = wait_cancellable(
        &control,
        150,
        |_| {
            ticks += 1;
            control.cancel.store(true, Ordering::SeqCst);
        },
        |_| {},
        |_| {},
    );
    assert!(!completed);
    assert_eq!(ticks, 1);
}

#[test]
fn pause_wait_resumes_from_the_same_control_state() {
    let control = Arc::new(PlaybackControl::new());
    control.paused.store(true, Ordering::SeqCst);
    let wake_control = control.clone();
    let wake_thread = thread::spawn(move || {
        thread::sleep(Duration::from_millis(10));
        wake_control.paused.store(false, Ordering::SeqCst);
        wake_control.wake.notify_all();
    });

    let mut paused_events = 0;
    let mut resumed_events = 0;
    let resumed = wait_for_resume(&control, || paused_events += 1, || resumed_events += 1);
    wake_thread.join().expect("pause wake thread should finish");

    assert!(resumed);
    assert_eq!(paused_events, 1);
    assert_eq!(resumed_events, 1);
}

#[test]
fn preserves_recorded_mouse_button_names() {
    assert_eq!(parse_button(Some("Right")), Ok(enigo::Button::Right));
    assert_eq!(parse_button(Some("Middle")), Ok(enigo::Button::Middle));
    assert_eq!(
        parse_button(Some("unknown")),
        Err("unknown mouse button: unknown".into())
    );
}
