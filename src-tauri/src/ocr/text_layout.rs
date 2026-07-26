use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WindowsOcrLine {
    text: String,
    top: Option<f64>,
    height: Option<f64>,
}

fn is_cjk_text_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x2E80..=0x2FFF
            | 0x3000..=0x303F
            | 0x3040..=0x30FF
            | 0x31C0..=0x31EF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0xFF01..=0xFF65
            | 0x20000..=0x2FA1F
    )
}

/// Windows OCR tokenizes CJK text and may insert an ASCII space between every
/// token. Remove only whitespace whose two neighbours are CJK characters or
/// CJK punctuation; spaces separating Latin words and mixed-language runs stay
/// intact.
fn normalize_ocr_line(line: &str) -> String {
    let chars = line.chars().collect::<Vec<_>>();
    let mut normalized = String::with_capacity(line.len());
    let mut index = 0;

    while index < chars.len() {
        if chars[index].is_whitespace() {
            let previous = normalized.chars().next_back();
            let mut next_index = index + 1;
            while next_index < chars.len() && chars[next_index].is_whitespace() {
                next_index += 1;
            }
            let next = chars.get(next_index).copied();
            if !matches!(
                (previous, next),
                (Some(left), Some(right)) if is_cjk_text_char(left) && is_cjk_text_char(right)
            ) && !normalized.ends_with(' ')
            {
                normalized.push(' ');
            }
            index = next_index;
            continue;
        }
        normalized.push(chars[index]);
        index += 1;
    }

    normalized.trim().to_string()
}

pub(super) fn format_windows_ocr_lines(lines: Vec<WindowsOcrLine>) -> String {
    let mut text = String::new();
    let mut previous_bounds: Option<(f64, f64)> = None;

    for line in lines {
        let line_text = normalize_ocr_line(&line.text);
        if line_text.is_empty() {
            continue;
        }

        if !text.is_empty() {
            text.push('\n');
            if let (Some((previous_top, previous_height)), Some(top), Some(height)) =
                (previous_bounds, line.top, line.height)
            {
                let vertical_gap = top - (previous_top + previous_height);
                let paragraph_gap = previous_height.max(height) * 0.7;
                if vertical_gap > paragraph_gap {
                    text.push('\n');
                }
            }
        }
        text.push_str(&line_text);

        if let (Some(top), Some(height)) = (line.top, line.height) {
            previous_bounds = Some((top, height));
        } else {
            previous_bounds = None;
        }
    }

    text
}

#[cfg(test)]
mod tests {
    use super::{format_windows_ocr_lines, normalize_ocr_line, WindowsOcrLine};

    #[test]
    fn cjk_token_spaces_are_removed_without_collapsing_latin_words() {
        assert_eq!(
            normalize_ocr_line("再 细 细 看 看 Windows OCR 的 识 别 结 果"),
            "再细细看看 Windows OCR 的识别结果"
        );
        assert_eq!(
            normalize_ocr_line("PowerShell 调 用 WinRT API"),
            "PowerShell 调用 WinRT API"
        );
    }

    #[test]
    fn windows_lines_preserve_lines_and_mark_large_vertical_gaps() {
        let formatted = format_windows_ocr_lines(vec![
            WindowsOcrLine {
                text: "第 一 行".into(),
                top: Some(10.0),
                height: Some(20.0),
            },
            WindowsOcrLine {
                text: "第 二 行".into(),
                top: Some(34.0),
                height: Some(20.0),
            },
            WindowsOcrLine {
                text: "新 段 落".into(),
                top: Some(72.0),
                height: Some(20.0),
            },
        ]);

        assert_eq!(formatted, "第一行\n第二行\n\n新段落");
    }
}
