pub(crate) fn constrain_video_size(
    image: image::RgbaImage,
    max_size: Option<(u32, u32)>,
) -> image::RgbaImage {
    let (max_width, max_height) = max_size.unwrap_or((3840, 2160));
    let width_ratio = max_width as f64 / image.width().max(1) as f64;
    let height_ratio = max_height as f64 / image.height().max(1) as f64;
    let ratio = width_ratio.min(height_ratio).min(1.0);
    // H.264 4:2:0 requires even dimensions.
    let width = ((image.width() as f64 * ratio).floor() as u32).max(2) & !1;
    let height = ((image.height() as f64 * ratio).floor() as u32).max(2) & !1;
    if width == image.width() && height == image.height() {
        image
    } else {
        image::imageops::resize(&image, width, height, image::imageops::FilterType::Triangle)
    }
}

#[cfg(test)]
mod tests {
    use super::constrain_video_size;

    #[test]
    fn video_dimensions_are_even_and_bounded() {
        let source = image::RgbaImage::new(2559, 1439);
        let output = constrain_video_size(source, Some((1920, 1080)));
        assert!(output.width() <= 1920);
        assert!(output.height() <= 1080);
        assert_eq!(output.width() % 2, 0);
        assert_eq!(output.height() % 2, 0);
    }
}
