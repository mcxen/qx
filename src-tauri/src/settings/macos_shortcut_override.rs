use std::sync::Arc;

pub(crate) type CmdSpaceHandler = Arc<dyn Fn() + Send + Sync + 'static>;

#[cfg(target_os = "macos")]
mod platform {
    use super::CmdSpaceHandler;
    use rdev::{grab, Event, EventType, Key};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};

    static HANDLER: OnceLock<Arc<Mutex<Option<CmdSpaceHandler>>>> = OnceLock::new();
    static GRAB_STARTED: AtomicBool = AtomicBool::new(false);

    fn handler_slot() -> &'static Arc<Mutex<Option<CmdSpaceHandler>>> {
        HANDLER.get_or_init(|| Arc::new(Mutex::new(None)))
    }

    fn is_modifier(key: Key, target: Key) -> bool {
        key == target
    }

    fn intercept_cmd_space(
        event: Event,
        handler_slot: &Arc<Mutex<Option<CmdSpaceHandler>>>,
        modifiers: &mut [bool; 4],
        suppressed_space: &mut bool,
    ) -> Option<Event> {
        let (key, pressed) = match event.event_type {
            EventType::KeyPress(key) => (key, true),
            EventType::KeyRelease(key) => (key, false),
            _ => return Some(event),
        };

        // [command, control, option, shift]. rdev reports physical modifier
        // transitions as key events on macOS.
        let modifier_index = [
            (Key::MetaLeft, 0),
            (Key::MetaRight, 0),
            (Key::ControlLeft, 1),
            (Key::ControlRight, 1),
            (Key::Alt, 2),
            (Key::ShiftLeft, 3),
            (Key::ShiftRight, 3),
        ]
        .iter()
        .find_map(|(modifier, index)| is_modifier(key, *modifier).then_some(*index));

        if let Some(index) = modifier_index {
            modifiers[index] = pressed;
            return Some(event);
        }

        if key != Key::Space {
            return Some(event);
        }

        if !pressed {
            if *suppressed_space {
                *suppressed_space = false;
                return None;
            }
            return Some(event);
        }

        let exact_cmd_space = modifiers[0] && !modifiers[1] && !modifiers[2] && !modifiers[3];
        let handler = if exact_cmd_space {
            handler_slot.lock().ok().and_then(|slot| slot.clone())
        } else {
            None
        };

        let Some(handler) = handler else {
            return Some(event);
        };

        // Consume both key-down and key-up so Spotlight never sees a partial
        // Cmd+Space sequence. Key repeat is also ignored after the first press.
        if !*suppressed_space {
            *suppressed_space = true;
            handler();
        }
        None
    }

    pub(crate) fn set_handler(handler: Option<CmdSpaceHandler>) -> Result<(), String> {
        let should_start = handler.is_some();
        let slot = handler_slot();
        if let Ok(mut current) = slot.lock() {
            if should_start && current.is_some() {
                return Err("Cmd+Space is already assigned to another Qx action".to_string());
            }
            *current = handler;
        } else {
            return Err("macOS Cmd+Space handler lock is poisoned".to_string());
        }

        if !should_start {
            return Ok(());
        }

        if GRAB_STARTED
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            let slot = Arc::clone(slot);
            std::thread::Builder::new()
                .name("qx-cmd-space-override".to_string())
                .spawn(move || {
                    let input_state = Arc::new(Mutex::new(([false; 4], false)));
                    let input_state_for_callback = Arc::clone(&input_state);
                    let result = grab(move |event| {
                        let Ok(mut state) = input_state_for_callback.lock() else {
                            return Some(event);
                        };
                        let (modifiers, suppressed_space) = &mut *state;
                        intercept_cmd_space(event, &slot, modifiers, suppressed_space)
                    });
                    if let Err(error) = result {
                        GRAB_STARTED.store(false, Ordering::SeqCst);
                        crate::diagnostics::log(
                            crate::diagnostics::LogLevel::Warn,
                            "shortcuts.macos",
                            "Cmd+Space override could not start; Accessibility/Input Monitoring permission may be required",
                            serde_json::json!({ "error": format!("{error:?}") }),
                        );
                    }
                })
                .map_err(|error| {
                    GRAB_STARTED.store(false, Ordering::SeqCst);
                    format!("could not start macOS Cmd+Space override: {error}")
                })?;
        }

        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub(crate) use platform::set_handler;

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_handler(_handler: Option<CmdSpaceHandler>) -> Result<(), String> {
    Ok(())
}
