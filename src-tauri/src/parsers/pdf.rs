use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use pdf::content::{Op, TextDrawAdjusted};
use pdf::enc::StreamFilter;
use pdf::file::FileOptions;
use pdf::object::{ColorSpace, ImageXObject, Resolve, XObject};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::path::Path;
use std::process::Command;

pub struct PdfParser {
    file_path: String,
}
const PDF_IMAGE_MARKER_PREFIX: &str = "[[PDF_IMAGE:";

impl PdfParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }
        Ok(Self {
            file_path: file_path.to_string(),
        })
    }

    pub fn get_metadata(&self) -> Result<NewDocument> {
        let default_title = Path::new(&self.file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();
        let mut title = default_title.clone();
        let mut author = None;

        if let Ok(file) = FileOptions::cached().open(&self.file_path) {
            if let Some(ref info) = file.trailer.info_dict {
                if let Some(meta_title) = info.get("Title").and_then(|p| p.to_string_lossy().ok())
                {
                    let trimmed = meta_title.trim();
                    if !trimmed.is_empty() {
                        title = trimmed.to_string();
                    }
                }
                if let Some(meta_author) = info.get("Author").and_then(|p| p.to_string_lossy().ok())
                {
                    let trimmed = meta_author.trim();
                    if !trimmed.is_empty() {
                        author = Some(trimmed.to_string());
                    }
                }
            }
        }

        Ok(NewDocument {
            title,
            author,
            language: None,
            file_path: self.file_path.clone(),
            file_type: "pdf".to_string(),
        })
    }

    pub fn extract_text_by_page(&self) -> Result<Vec<(String, Vec<String>)>> {
        let image_output_dir = build_pdf_image_output_dir(&self.file_path);
        let _ = fs::remove_dir_all(&image_output_dir);
        let _ = fs::create_dir_all(&image_output_dir);

        if let Some(raw_page_lines) = extract_with_system_tools(&self.file_path, &image_output_dir)
        {
            let cleaned_page_lines = clean_page_lines(raw_page_lines);
            let mut pages = Vec::new();

            for (idx, lines) in cleaned_page_lines.into_iter().enumerate() {
                let paragraphs = split_pdf_paragraphs(&lines);
                pages.push((format!("Page {}", idx + 1), paragraphs));
            }

            if pages.is_empty() {
                pages.push((
                    "Page 1".to_string(),
                    vec!["No readable content extracted from PDF.".to_string()],
                ));
            }

            return Ok(pages);
        }

        let file = FileOptions::cached()
            .open(&self.file_path)
            .map_err(|e| ReaderError::PdfParse(format!("Failed to open PDF: {}", e)))?;
        let mut raw_page_lines: Vec<Vec<String>> = Vec::new();

        for (idx, page_result) in file.pages().enumerate() {
            let page = page_result
                .map_err(|e| ReaderError::PdfParse(format!("Failed to read page: {}", e)))?;
            let mut lines: Vec<String> = Vec::new();
            let mut current_line = String::new();

            if let Some(content) = page.contents.as_ref() {
                let page_xobject_markers = collect_page_image_markers(
                    &file,
                    &page,
                    page_idx_label(idx),
                    &image_output_dir,
                );
                let mut used_xobject_names: HashSet<String> = HashSet::new();

                let ops = content.operations(&file).map_err(|e| {
                    ReaderError::PdfParse(format!(
                        "Failed to parse content stream on page {}: {}",
                        idx + 1,
                        e
                    ))
                })?;

                let mut inline_image_index = 0usize;
                for op in ops {
                    match op {
                        Op::TextDraw { text } => append_text_fragment(&mut current_line, text.to_string_lossy()),
                        Op::TextDrawAdjusted { array } => {
                            for part in array {
                                if let TextDrawAdjusted::Text(text) = part {
                                    append_text_fragment(&mut current_line, text.to_string_lossy());
                                }
                            }
                        }
                        Op::TextNewline => flush_line(&mut lines, &mut current_line),
                        Op::XObject { name } => {
                            let key = name.to_string();
                            if let Some(markers) = page_xobject_markers.get(&key) {
                                flush_line(&mut lines, &mut current_line);
                                lines.extend(markers.clone());
                                used_xobject_names.insert(key);
                            }
                        }
                        Op::InlineImage { image } => {
                            if let Some(marker) = build_image_marker(
                                &file,
                                &image,
                                page_idx_label(idx),
                                &format!("inline{}", inline_image_index),
                                &image_output_dir,
                            ) {
                                lines.push(marker);
                            }
                            inline_image_index += 1;
                        }
                        _ => {}
                    }
                }

                // Append image resources that exist on page but are not explicitly referenced
                // in parsed operators, as a fallback.
                for (name, markers) in page_xobject_markers {
                    if used_xobject_names.contains(&name) {
                        continue;
                    }
                    lines.extend(markers);
                }
            }

            flush_line(&mut lines, &mut current_line);
            raw_page_lines.push(lines);
        }

        let cleaned_page_lines = clean_page_lines(raw_page_lines);
        let mut pages = Vec::new();

        for (idx, lines) in cleaned_page_lines.into_iter().enumerate() {
            let paragraphs = split_pdf_paragraphs(&lines);
            pages.push((format!("Page {}", idx + 1), paragraphs));
        }

        if pages.is_empty() {
            pages.push((
                "Page 1".to_string(),
                vec!["No readable content extracted from PDF.".to_string()],
            ));
        }

        Ok(pages)
    }

    pub fn parse_all(&self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let metadata = self.get_metadata()?;
        let pages = self.extract_text_by_page()?;

        let mut chapters = Vec::new();

        for (order_index, (title, paragraphs)) in pages.into_iter().enumerate() {
            let href = format!("page{}", order_index + 1);
            chapters.push((title, order_index as i32, href, paragraphs));
        }

        Ok((metadata, chapters))
    }
}

fn append_text_fragment(line: &mut String, fragment: impl AsRef<str>) {
    let fragment = fragment.as_ref().trim();
    if fragment.is_empty() {
        return;
    }
    if !line.is_empty() && !line.ends_with(' ') {
        line.push(' ');
    }
    line.push_str(fragment);
}

fn flush_line(lines: &mut Vec<String>, current_line: &mut String) {
    let normalized = normalize_whitespace(current_line);
    if !normalized.is_empty() {
        lines.push(normalized);
    }
    current_line.clear();
}

fn normalize_whitespace(input: &str) -> String {
    input
        .replace('\u{00A0}', " ")
        .replace('\t', " ")
        .replace('\r', " ")
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn split_pdf_paragraphs(lines: &[String]) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    let mut current_is_table = false;

    for line in lines {
        let trimmed = line.trim();
        if is_pdf_image_marker(trimmed) {
            if !current.is_empty() {
                paragraphs.push(current.trim().to_string());
                current.clear();
                current_is_table = false;
            }
            paragraphs.push(trimmed.to_string());
            continue;
        }

        if trimmed.is_empty() {
            if !current.is_empty() {
                paragraphs.push(current.trim().to_string());
                current.clear();
                current_is_table = false;
            }
            continue;
        }

        let line_is_table = is_tabular_line(trimmed);
        let normalized_line = normalize_pdf_line_text(trimmed);

        if current.is_empty() {
            current.push_str(&normalized_line);
            current_is_table = line_is_table;
            continue;
        }

        if current_is_table || line_is_table {
            if current_is_table && line_is_table {
                current.push('\n');
                current.push_str(&normalized_line);
                continue;
            }

            paragraphs.push(normalize_pdf_paragraph_text(&current));
            current.clear();
            current.push_str(&normalized_line);
            current_is_table = line_is_table;
            continue;
        }

        let ends_sentence = current.ends_with('.')
            || current.ends_with('!')
            || current.ends_with('?')
            || current.ends_with(':');
        if ends_sentence || current.len() > 800 {
            paragraphs.push(normalize_pdf_paragraph_text(&current));
            current.clear();
            current.push_str(&normalized_line);
        } else {
            append_pdf_line_to_paragraph(&mut current, &normalized_line);
        }
    }

    if !current.is_empty() {
        paragraphs.push(normalize_pdf_paragraph_text(&current));
    }

    if paragraphs.is_empty() {
        return vec!["No readable content extracted from PDF.".to_string()];
    }

    paragraphs
}

fn extract_with_system_tools(pdf_path: &str, output_dir: &Path) -> Option<Vec<Vec<String>>> {
    let _ = output_dir;
    extract_lines_with_pdftotext(pdf_path)
}

fn extract_lines_with_pdftotext(pdf_path: &str) -> Option<Vec<Vec<String>>> {
    let mut output = None;
    for cmd in ["/opt/homebrew/bin/pdftotext", "pdftotext"] {
        match Command::new(cmd)
            .args(["-enc", "UTF-8", pdf_path, "-"])
            .output()
        {
            Ok(result) => {
                output = Some(result);
                break;
            }
            Err(_) => continue,
        }
    }
    let output = output?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut pages = Vec::new();
    for segment in text.split('\u{000C}') {
        let mut lines = Vec::new();
        for raw in segment.lines() {
            let line = raw.trim_end_matches('\r').to_string();
            if line.is_empty() {
                lines.push(String::new());
            } else {
                lines.push(line);
            }
        }
        if lines.iter().any(|line| !line.trim().is_empty()) {
            pages.push(lines);
        }
    }
    Some(pages)
}

fn append_pdf_line_to_paragraph(current: &mut String, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    if current.is_empty() {
        current.push_str(line);
        return;
    }

    // Fix common PDF line-wrap hyphenation: "human-" + "centered" => "humancentered".
    if current.ends_with('-')
        && line
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() && c.is_ascii_lowercase())
    {
        current.pop();
        current.push_str(line);
        return;
    }

    current.push(' ');
    current.push_str(line);
}

fn normalize_pdf_line_text(line: &str) -> String {
    collapse_spaced_uppercase_letters(line)
}

fn collapse_spaced_uppercase_letters(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;

    while i < chars.len() {
        if chars[i].is_ascii_uppercase() {
            let mut j = i + 1;
            let mut letters = String::new();
            letters.push(chars[i]);
            let mut count = 1usize;

            loop {
                let mut spaces = 0usize;
                while j < chars.len() && chars[j] == ' ' {
                    spaces += 1;
                    j += 1;
                }
                if spaces != 1 || j >= chars.len() || !chars[j].is_ascii_uppercase() {
                    break;
                }
                letters.push(chars[j]);
                count += 1;
                j += 1;
            }

            if count >= 3 {
                out.push_str(&split_merged_uppercase_heading_word(&letters));
                i = j;
                continue;
            }
        }

        out.push(chars[i]);
        i += 1;
    }

    out
}

fn split_merged_uppercase_heading_word(word: &str) -> String {
    for suffix in [
        "REPORT",
        "PAPER",
        "ABSTRACT",
        "APPENDIX",
        "INTRODUCTION",
        "CONCLUSION",
        "CONCLUSIONS",
        "METHOD",
        "METHODS",
        "RESULT",
        "RESULTS",
    ] {
        if word.len() > suffix.len() + 3 && word.ends_with(suffix) {
            let prefix_len = word.len() - suffix.len();
            return format!("{} {}", &word[..prefix_len], suffix);
        }
    }
    word.to_string()
}

fn normalize_pdf_paragraph_text(text: &str) -> String {
    let mut tokens = text
        .split_whitespace()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    if tokens.len() < 2 {
        return text.trim().to_string();
    }

    let mut i = 0usize;
    while i + 1 < tokens.len() {
        if should_merge_two_broken_tokens(&tokens[i], &tokens[i + 1]) {
            let merged = format!("{}{}", tokens[i], tokens[i + 1]);
            tokens.splice(i..=i + 1, [merged]);
            continue;
        }
        if i + 2 < tokens.len() && should_merge_three_broken_tokens(&tokens[i], &tokens[i + 1], &tokens[i + 2]) {
            let merged = format!("{}{}{}", tokens[i], tokens[i + 1], tokens[i + 2]);
            tokens.splice(i..=i + 2, [merged]);
            continue;
        }
        i += 1;
    }

    tokens.join(" ")
}

fn should_merge_two_broken_tokens(left: &str, right: &str) -> bool {
    if !is_ascii_alpha_word(left) || !is_ascii_alpha_word(right) {
        return false;
    }
    if !(2..=4).contains(&left.len()) || right.len() < 2 {
        return false;
    }
    if is_common_short_word(left) {
        return false;
    }
    let total = left.len() + right.len();
    let right_starts_lower = right.chars().next().is_some_and(|c| c.is_ascii_lowercase());
    let left_capitalized = left.chars().next().is_some_and(|c| c.is_ascii_uppercase());
    let looks_like_title_split = left_capitalized && right.len() <= 3 && total >= 5;
    let looks_like_body_split = total >= 6 && right.len() >= 4;
    right_starts_lower && (looks_like_body_split || looks_like_title_split)
}

fn should_merge_three_broken_tokens(a: &str, b: &str, c: &str) -> bool {
    if !is_ascii_alpha_word(a) || !is_ascii_alpha_word(b) || !is_ascii_alpha_word(c) {
        return false;
    }
    if !(2..=3).contains(&a.len()) || b.len() != 1 || c.len() < 3 {
        return false;
    }
    if is_common_short_word(a) {
        return false;
    }
    let c_starts_lower = c.chars().next().is_some_and(|ch| ch.is_ascii_lowercase());
    c_starts_lower && (a.len() + b.len() + c.len() >= 7)
}

fn is_ascii_alpha_word(word: &str) -> bool {
    !word.is_empty() && word.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_common_short_word(word: &str) -> bool {
    matches!(
        word.to_ascii_lowercase().as_str(),
        "a"
            | "an"
            | "and"
            | "as"
            | "at"
            | "by"
            | "for"
            | "from"
            | "in"
            | "into"
            | "is"
            | "it"
            | "of"
            | "on"
            | "or"
            | "the"
            | "to"
            | "with"
    )
}

fn extract_page_image_markers_with_pdfimages(
    pdf_path: &str,
    output_dir: &Path,
) -> Option<HashMap<usize, Vec<String>>> {
    let mut list_output = None;
    for cmd in ["/opt/homebrew/bin/pdfimages", "pdfimages"] {
        match Command::new(cmd).args(["-list", pdf_path]).output() {
            Ok(result) => {
                list_output = Some(result);
                break;
            }
            Err(_) => continue,
        }
    }
    let list_output = list_output?;
    if !list_output.status.success() {
        return None;
    }

    let mut page_to_nums: HashMap<usize, Vec<usize>> = HashMap::new();
    let list_text = String::from_utf8_lossy(&list_output.stdout);
    for line in list_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("page") || trimmed.starts_with('-') {
            continue;
        }
        let cols: Vec<&str> = trimmed.split_whitespace().collect();
        if cols.len() < 5 {
            continue;
        }
        let Ok(page) = cols[0].parse::<usize>() else {
            continue;
        };
        let Ok(num) = cols[1].parse::<usize>() else {
            continue;
        };
        let image_type = cols[2];
        if image_type != "image" {
            continue;
        }
        let width = cols[3].parse::<usize>().unwrap_or(0);
        let height = cols[4].parse::<usize>().unwrap_or(0);
        if width < 100 || height < 100 {
            continue;
        }
        page_to_nums
            .entry(page.saturating_sub(1))
            .or_default()
            .push(num);
    }
    if page_to_nums.is_empty() {
        return Some(HashMap::new());
    }

    let prefix = output_dir.join("img");
    let prefix_string = prefix.to_string_lossy().to_string();
    let mut extract_ok = false;
    for cmd in ["/opt/homebrew/bin/pdfimages", "pdfimages"] {
        match Command::new(cmd)
            .args(["-all", pdf_path, &prefix_string])
            .status()
        {
            Ok(status) if status.success() => {
                extract_ok = true;
                break;
            }
            Ok(_) | Err(_) => continue,
        }
    }
    if !extract_ok {
        return None;
    }

    let mut num_to_path: HashMap<usize, PathBuf> = HashMap::new();
    if let Ok(entries) = fs::read_dir(output_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            let Some(rest) = name.strip_prefix("img-") else {
                continue;
            };
            let Some((num_str, _ext)) = rest.split_once('.') else {
                continue;
            };
            let Ok(num) = num_str.parse::<usize>() else {
                continue;
            };
            num_to_path.insert(num, path);
        }
    }

    let mut result: HashMap<usize, Vec<String>> = HashMap::new();
    for (page, mut nums) in page_to_nums {
        nums.sort_unstable();
        nums.dedup();
        let mut markers = Vec::new();
        for num in nums.into_iter().take(4) {
            let Some(path) = num_to_path.get(&num) else {
                continue;
            };
            markers.push(format!(
                "{prefix}{path}]]",
                prefix = PDF_IMAGE_MARKER_PREFIX,
                path = path.to_string_lossy()
            ));
        }
        if !markers.is_empty() {
            result.insert(page, markers);
        }
    }

    Some(result)
}

fn render_page_snapshot_marker(pdf_path: &str, page_number: usize, output_dir: &Path) -> Option<String> {
    let prefix = output_dir.join(format!("page_{:04}", page_number));
    let prefix_string = prefix.to_string_lossy().to_string();
    let page_number_string = page_number.to_string();

    let mut rendered = false;
    for cmd in ["/opt/homebrew/bin/pdftoppm", "pdftoppm"] {
        let status = Command::new(cmd)
            .args([
                "-f",
                page_number_string.as_str(),
                "-l",
                page_number_string.as_str(),
                "-singlefile",
                "-png",
                "-r",
                "144",
                pdf_path,
                prefix_string.as_str(),
            ])
            .status();
        match status {
            Ok(status) if status.success() => {
                rendered = true;
                break;
            }
            Ok(_) | Err(_) => continue,
        }
    }
    if !rendered {
        return None;
    }

    let png_path = prefix.with_extension("png");
    if !png_path.exists() {
        return None;
    }

    Some(format!(
        "{prefix}{path}]]",
        prefix = PDF_IMAGE_MARKER_PREFIX,
        path = png_path.to_string_lossy()
    ))
}

fn insert_markers_after_captions(lines: &mut Vec<String>, markers: Vec<String>) {
    if markers.is_empty() {
        return;
    }

    let caption_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(idx, line)| {
            if looks_like_figure_or_table_caption(line) {
                Some(idx)
            } else {
                None
            }
        })
        .collect();

    if caption_indices.is_empty() {
        lines.extend(markers);
        return;
    }

    let mut merged = Vec::with_capacity(lines.len() + markers.len());
    let mut marker_iter = markers.into_iter();
    let mut caption_cursor = 0usize;
    let mut next_caption = caption_indices.get(caption_cursor).copied();

    for (idx, line) in lines.iter().enumerate() {
        merged.push(line.clone());
        if next_caption == Some(idx) {
            if let Some(marker) = marker_iter.next() {
                merged.push(marker);
            }
            caption_cursor += 1;
            next_caption = caption_indices.get(caption_cursor).copied();
        }
    }

    for marker in marker_iter {
        merged.push(marker);
    }
    *lines = merged;
}

fn looks_like_figure_or_table_caption(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let starts_with_caption = lower.starts_with("figure")
        || lower.starts_with("fig.")
        || lower.starts_with("fig ")
        || lower.starts_with("table")
        || trimmed.starts_with("图")
        || trimmed.starts_with("表");
    if !starts_with_caption {
        return false;
    }
    trimmed.chars().any(|c| c.is_ascii_digit())
}

fn needs_page_visual_fallback(lines: &[String]) -> bool {
    let mut has_caption = false;
    let mut has_formula_noise = false;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if looks_like_figure_or_table_caption(trimmed) {
            has_caption = true;
        }
        let replacement = trimmed.chars().filter(|&c| c == '�').count();
        let math_symbols = trimmed
            .chars()
            .filter(|c| matches!(
                c,
                '='
                    | '+'
                    | '-'
                    | '*'
                    | '/'
                    | '^'
                    | '_'
                    | '∑'
                    | '∫'
                    | '√'
                    | '≈'
                    | '≠'
                    | '≤'
                    | '≥'
                    | '∞'
            ))
            .count();
        if replacement > 0 || math_symbols >= 6 {
            has_formula_noise = true;
        }
        if has_caption || has_formula_noise {
            break;
        }
    }

    has_caption || has_formula_noise
}

fn clean_page_lines(page_lines: Vec<Vec<String>>) -> Vec<Vec<String>> {
    if page_lines.is_empty() {
        return page_lines;
    }

    let total_pages = page_lines.len();
    let mut line_counts: HashMap<String, usize> = HashMap::new();
    let mut edge_counts: HashMap<String, usize> = HashMap::new();

    for lines in &page_lines {
        let edge_indices = edge_line_indices(lines.len());
        for (idx, line) in lines.iter().enumerate() {
            let normalized = normalize_whitespace(line);
            if normalized.is_empty() {
                continue;
            }
            *line_counts.entry(normalized.clone()).or_insert(0) += 1;
            if edge_indices.contains(&idx) {
                *edge_counts.entry(normalized).or_insert(0) += 1;
            }
        }
    }

    page_lines
        .into_iter()
        .map(|lines| {
            let edge_indices = edge_line_indices(lines.len());
            lines
                .into_iter()
                .enumerate()
                .filter_map(|(idx, line)| {
                    let normalized = normalize_whitespace(&line);
                    if normalized.is_empty() {
                        return None;
                    }
                    if is_pdf_image_marker(&normalized) {
                        return Some(normalized);
                    }
                    if is_probable_page_number(&normalized) {
                        return None;
                    }
                    let seen = line_counts.get(&normalized).copied().unwrap_or(0);
                    let seen_on_edge = edge_counts.get(&normalized).copied().unwrap_or(0);
                    if is_repeated_edge_noise(
                        &normalized,
                        total_pages,
                        seen,
                        seen_on_edge,
                        edge_indices.contains(&idx),
                    ) {
                        return None;
                    }
                    Some(normalized)
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn edge_line_indices(len: usize) -> Vec<usize> {
    if len == 0 {
        return Vec::new();
    }
    let mut indices = vec![0];
    if len > 1 {
        indices.push(1);
        indices.push(len - 1);
    }
    if len > 3 {
        indices.push(len - 2);
    }
    indices.sort_unstable();
    indices.dedup();
    indices
}

fn is_probable_page_number(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.len() > 24 {
        return false;
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if let Some(rest) = trimmed.strip_prefix("Page ") {
        if rest.trim().chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    let compact = trimmed.replace(' ', "");
    let mut has_digit = false;
    if compact.chars().all(|c| {
        if c.is_ascii_digit() {
            has_digit = true;
            true
        } else {
            matches!(c, '/' | '-' | '–' | '_')
        }
    }) && has_digit
    {
        return true;
    }
    false
}

fn is_repeated_edge_noise(
    line: &str,
    total_pages: usize,
    seen: usize,
    seen_on_edge: usize,
    is_edge_line: bool,
) -> bool {
    if !is_edge_line || total_pages < 4 {
        return false;
    }
    if line.len() > 90 {
        return false;
    }
    if seen < 3 {
        return false;
    }
    seen_on_edge * 2 >= seen
}

fn is_pdf_image_marker(line: &str) -> bool {
    line.starts_with(PDF_IMAGE_MARKER_PREFIX) && line.ends_with("]]"
    )
}

fn is_tabular_line(line: &str) -> bool {
    if line.len() < 8 {
        return false;
    }
    let multi_spaces = line.matches("  ").count();
    if multi_spaces >= 2 {
        return true;
    }
    let alpha_tokens = line
        .split_whitespace()
        .filter(|token| token.chars().any(|c| c.is_ascii_alphabetic()))
        .count();
    let numeric_tokens = line
        .split_whitespace()
        .filter(|token| token.chars().any(|c| c.is_ascii_digit()))
        .count();
    alpha_tokens >= 2 && numeric_tokens >= 2 && line.contains(' ')
}

fn build_pdf_image_output_dir(pdf_path: &str) -> PathBuf {
    let stem = Path::new(pdf_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf");
    let sanitized = sanitize_filename(stem);
    let mut hasher = DefaultHasher::new();
    pdf_path.hash(&mut hasher);
    let suffix = hasher.finish();
    std::env::temp_dir()
        .join("reader_pdf_images")
        .join(format!("{}_{:016x}", sanitized, suffix))
}

fn sanitize_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "pdf".to_string()
    } else {
        out
    }
}

fn collect_page_image_markers<R: Resolve>(
    file: &R,
    page: &pdf::object::Page,
    page_label: String,
    output_dir: &Path,
) -> HashMap<String, Vec<String>> {
    let mut markers: HashMap<String, Vec<String>> = HashMap::new();
    let resources = match page.resources() {
        Ok(res) => res,
        Err(_) => return markers,
    };
    if resources.xobjects.is_empty() {
        return markers;
    }

    for (obj_name, obj_ref) in &resources.xobjects {
        let xobject = match file.get(*obj_ref) {
            Ok(xobj) => xobj,
            Err(_) => continue,
        };
        match &*xobject {
            XObject::Image(image) => {
                if let Some(marker) = build_image_marker(
                    file,
                    image,
                    page_label.clone(),
                    obj_name,
                    output_dir,
                ) {
                    markers.insert(obj_name.to_string(), vec![marker]);
                }
            }
            XObject::Form(form) => {
                let form_markers =
                    collect_markers_from_form(file, form, &page_label, output_dir, 0);
                if !form_markers.is_empty() {
                    markers.insert(obj_name.to_string(), form_markers);
                }
            }
            _ => {}
        }
    }

    markers
}

fn collect_markers_from_form<R: Resolve>(
    file: &R,
    form: &pdf::content::FormXObject,
    page_label: &str,
    output_dir: &Path,
    depth: usize,
) -> Vec<String> {
    if depth >= 6 {
        return Vec::new();
    }

    let mut markers = Vec::new();
    let ops = match form.operations(file) {
        Ok(ops) => ops,
        Err(_) => return markers,
    };
    let resources = form.dict().resources.as_ref();
    let mut inline_idx = 0usize;

    for op in ops {
        match op {
            Op::InlineImage { image } => {
                if let Some(marker) = build_image_marker(
                    file,
                    &image,
                    page_label.to_string(),
                    &format!("form_inline_{}_{}", depth, inline_idx),
                    output_dir,
                ) {
                    markers.push(marker);
                }
                inline_idx += 1;
            }
            Op::XObject { name } => {
                let Some(res) = resources else { continue };
                let Some(obj_ref) = res.xobjects.get(&name) else {
                    continue;
                };
                let Ok(xobj) = file.get(*obj_ref) else {
                    continue;
                };
                match &*xobj {
                    XObject::Image(image) => {
                        if let Some(marker) = build_image_marker(
                            file,
                            image,
                            page_label.to_string(),
                            &format!("form_{}_{}", depth, name),
                            output_dir,
                        ) {
                            markers.push(marker);
                        }
                    }
                    XObject::Form(nested) => {
                        markers.extend(collect_markers_from_form(
                            file,
                            nested,
                            page_label,
                            output_dir,
                            depth + 1,
                        ));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    markers
}

fn build_image_marker<R: Resolve>(
    file: &R,
    image: &ImageXObject,
    page_label: String,
    image_name: &str,
    output_dir: &Path,
) -> Option<String> {
    let (data, filter) = image.raw_image_data(file).ok()?;
    let abs_path = match filter {
        Some(StreamFilter::DCTDecode(_)) => {
            let file_name = format!(
                "{}_{}_{}.jpg",
                page_label,
                sanitize_filename(image_name),
                data.len()
            );
            let abs_path = output_dir.join(file_name);
            if fs::write(&abs_path, data).is_err() {
                return None;
            }
            abs_path
        }
        Some(StreamFilter::JPXDecode) => {
            let file_name = format!(
                "{}_{}_{}.jp2",
                page_label,
                sanitize_filename(image_name),
                data.len()
            );
            let abs_path = output_dir.join(file_name);
            if fs::write(&abs_path, data).is_err() {
                return None;
            }
            abs_path
        }
        Some(StreamFilter::JBIG2Decode) => {
            // JBIG2 decoding is not available in current pipeline.
            return None;
        }
        _ => {
            let pixels = image.image_data(file).ok()?;
            let png_bytes = encode_pdf_image_png(image, &pixels)?;
            let file_name = format!(
                "{}_{}_{}.png",
                page_label,
                sanitize_filename(image_name),
                png_bytes.len()
            );
            let abs_path = output_dir.join(file_name);
            if fs::write(&abs_path, png_bytes).is_err() {
                return None;
            }
            abs_path
        }
    };

    Some(format!(
        "{prefix}{path}]]",
        prefix = PDF_IMAGE_MARKER_PREFIX,
        path = abs_path.to_string_lossy()
    ))
}

fn page_idx_label(page_idx: usize) -> String {
    format!("p{}", page_idx + 1)
}

fn encode_pdf_image_png(image: &ImageXObject, pixels: &[u8]) -> Option<Vec<u8>> {
    let width = image.width;
    let height = image.height;
    if width == 0 || height == 0 {
        return None;
    }
    let bpc = image.bits_per_component.unwrap_or(8);
    let color_space = image
        .color_space
        .as_ref()
        .unwrap_or(&ColorSpace::DeviceRGB);

    let (buffer, color): (Vec<u8>, ColorType) = match (color_space, bpc) {
        (ColorSpace::DeviceRGB, 8) => {
            let expected = (width as usize) * (height as usize) * 3;
            if pixels.len() < expected {
                return None;
            }
            (pixels[..expected].to_vec(), ColorType::Rgb8)
        }
        (ColorSpace::DeviceGray, 8) => {
            let expected = (width as usize) * (height as usize);
            if pixels.len() < expected {
                return None;
            }
            (pixels[..expected].to_vec(), ColorType::L8)
        }
        (ColorSpace::DeviceGray, 1) => {
            let expected = (width as usize) * (height as usize);
            let expanded = expand_mono_bitmap(pixels, expected);
            if expanded.len() != expected {
                return None;
            }
            (expanded, ColorType::L8)
        }
        _ => return None,
    };

    let mut out = Vec::new();
    let encoder = PngEncoder::new(&mut out);
    encoder
        .write_image(&buffer, width, height, color.into())
        .ok()?;
    Some(out)
}

fn expand_mono_bitmap(input: &[u8], target_pixels: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target_pixels);
    for &byte in input {
        for bit in (0..8).rev() {
            if out.len() >= target_pixels {
                return out;
            }
            let v = if (byte >> bit) & 1 == 1 { 255 } else { 0 };
            out.push(v);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        append_pdf_line_to_paragraph, collapse_spaced_uppercase_letters, normalize_pdf_paragraph_text,
        PdfParser,
    };

    #[test]
    fn parse_pdf_case_from_env_when_available() {
        let path = match std::env::var("PDF_CASE_PATH") {
            Ok(path) => path,
            Err(_) => return,
        };

        let parser = PdfParser::new(&path).expect("failed to create parser");
        let (_, chapters) = parser.parse_all().expect("failed to parse PDF");
        assert!(!chapters.is_empty(), "expected non-empty chapters");

        let all_text = chapters
            .into_iter()
            .flat_map(|(_, _, _, paragraphs)| paragraphs)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !all_text.contains("PDF text extraction not yet fully implemented"),
            "placeholder text should not appear"
        );
        assert!(
            all_text.len() > 200,
            "expected meaningful extracted text length, got {}",
            all_text.len()
        );
        if std::env::var("PDF_EXPECT_IMAGE_MARKER").ok().as_deref() == Some("1") {
            assert!(
                all_text.contains("[[PDF_IMAGE:"),
                "expected at least one extracted image marker"
            );
        }
    }

    #[test]
    fn collapse_spaced_uppercase_heading_words() {
        let line = "Kimi K2 T E C H N I C A L R E P O R T";
        let fixed = collapse_spaced_uppercase_letters(line);
        assert_eq!(fixed, "Kimi K2 TECHNICAL REPORT");
    }

    #[test]
    fn merge_hyphenated_wrap_between_lines() {
        let mut current = "this approach allows an AI agent to go beyond static human-".to_string();
        append_pdf_line_to_paragraph(&mut current, "centered limits.");
        assert_eq!(
            current,
            "this approach allows an AI agent to go beyond static humancentered limits."
        );
    }

    #[test]
    fn normalize_split_words_in_paragraph() {
        let input = "1 Intr oduction The de v elopment of Lar ge Language Models";
        let fixed = normalize_pdf_paragraph_text(input);
        assert_eq!(fixed, "1 Introduction The development of Large Language Models");
    }
}
