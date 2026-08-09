use enigo::Key;

pub(super) fn parse_key(s: &str) -> Result<Key, String> {
    match s {
        "Return" | "Enter" => Ok(Key::Return),
        "Space" => Ok(Key::Space),
        "Tab" => Ok(Key::Tab),
        "BackSpace" | "Backspace" => Ok(Key::Backspace),
        "Escape" | "Esc" => Ok(Key::Escape),
        "ShiftLeft" | "ShiftRight" | "Shift" => Ok(Key::Shift),
        "ControlLeft" | "ControlRight" | "Control" | "Ctrl" => Ok(Key::Control),
        "Alt" | "AltLeft" | "AltRight" | "Option" => Ok(Key::Alt),
        "MetaLeft" | "MetaRight" | "Meta" | "Command" | "Cmd" | "Super" => Ok(Key::Meta),
        "UpArrow" | "Up" => Ok(Key::UpArrow),
        "DownArrow" | "Down" => Ok(Key::DownArrow),
        "LeftArrow" | "Left" => Ok(Key::LeftArrow),
        "RightArrow" | "Right" => Ok(Key::RightArrow),
        "PageUp" => Ok(Key::PageUp),
        "PageDown" => Ok(Key::PageDown),
        "Home" => Ok(Key::Home),
        "End" => Ok(Key::End),
        "Delete" => Ok(Key::Delete),
        "F1" => Ok(Key::F1),
        "F2" => Ok(Key::F2),
        "F3" => Ok(Key::F3),
        "F4" => Ok(Key::F4),
        "F5" => Ok(Key::F5),
        "F6" => Ok(Key::F6),
        "F7" => Ok(Key::F7),
        "F8" => Ok(Key::F8),
        "F9" => Ok(Key::F9),
        "F10" => Ok(Key::F10),
        "F11" => Ok(Key::F11),
        "F12" => Ok(Key::F12),
        "F13" => Ok(Key::F13),
        "F14" => Ok(Key::F14),
        "F15" => Ok(Key::F15),
        "F16" => Ok(Key::F16),
        "F17" => Ok(Key::F17),
        "F18" => Ok(Key::F18),
        "F19" => Ok(Key::F19),
        "F20" => Ok(Key::F20),
        "Minus" => Ok(Key::Unicode('-')),
        "Equal" => Ok(Key::Unicode('=')),
        "LeftBracket" => Ok(Key::Unicode('[')),
        "RightBracket" => Ok(Key::Unicode(']')),
        "SemiColon" => Ok(Key::Unicode(';')),
        "Quote" => Ok(Key::Unicode('\'')),
        "BackSlash" | "IntlBackslash" => Ok(Key::Unicode('\\')),
        "Comma" => Ok(Key::Unicode(',')),
        "Dot" => Ok(Key::Unicode('.')),
        "Slash" => Ok(Key::Unicode('/')),
        k if k.len() == 4 && k.starts_with("Key") => {
            let byte = k.as_bytes()[3];
            if byte.is_ascii_uppercase() {
                Ok(Key::Unicode((byte as char).to_ascii_lowercase()))
            } else {
                Err(format!("unknown key: {s}"))
            }
        }
        k if k.len() == 4 && k.starts_with("Num") => {
            let byte = k.as_bytes()[3];
            if byte.is_ascii_digit() {
                Ok(Key::Unicode(byte as char))
            } else {
                Err(format!("unknown key: {s}"))
            }
        }
        k if k.len() == 1 => Ok(Key::Unicode(k.chars().next().unwrap())),
        _ => Err(format!("unknown key: {s}")),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_key;

    #[test]
    fn demo_shortcut_key_names_are_supported() {
        assert!(parse_key("MetaLeft").is_ok());
        assert!(parse_key("ControlLeft").is_ok());
        assert!(parse_key("KeyL").is_ok());
        assert!(parse_key("Return").is_ok());
    }
}
