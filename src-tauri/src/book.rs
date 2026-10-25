use encoding_rs::{Encoding, GBK, UTF_16LE, UTF_8};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChapterParse {
    pub idx: i64,
    pub title: String,
    pub offset: u64,
}

#[derive(Serialize, Clone)]
pub struct VolumeParse {
    pub idx: i64,
    pub title: String,
    pub start_chapter: i64,
    pub end_chapter: i64,
}

#[derive(Serialize)]
pub struct ParsedBook {
    pub encoding: String,
    pub chapters: Vec<ChapterParse>,
    pub volumes: Vec<VolumeParse>,
}

/// 探测文件编码：BOM 优先，其次 UTF-8 严格校验，最后回退 GBK
pub fn detect_encoding(bytes: &[u8]) -> &'static Encoding {
    if bytes.len() >= 3 && &bytes[..3] == b"\xef\xbb\xbf" {
        return UTF_8;
    }
    if bytes.len() >= 2 && &bytes[..2] == b"\xff\xfe" {
        return UTF_16LE;
    }
    if bytes.len() >= 2 && &bytes[..2] == b"\xfe\xff" {
        return encoding_rs::UTF_16BE;
    }
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    GBK
}

/// UTF-16 文件转码为 UTF-8（返回新的字节），其他编码原样返回
pub fn normalize_to_utf8(bytes: &[u8]) -> (Vec<u8>, &'static Encoding) {
    let enc = detect_encoding(bytes);
    if enc == UTF_16LE || enc == encoding_rs::UTF_16BE {
        let (cow, _, _) = enc.decode(bytes);
        (cow.into_owned().into_bytes(), UTF_8)
    } else {
        (bytes.to_vec(), enc)
    }
}

fn decode_line(enc: &'static Encoding, raw: &[u8]) -> String {
    let (cow, _, _) = enc.decode(raw);
    cow.into_owned()
}

/// 行级章节/分卷正则族（按置信度从高到低）
struct Patterns {
    vol: Regex,
    ch_strict: Vec<Regex>,
    ch_loose: Regex,
}

fn build_patterns() -> Patterns {
    let num = r"[0-9零一二三四五六七八九十百千两]+";
    Patterns {
        vol: Regex::new(&format!(r"^\s*第{num}[卷部篇][^\n]{{0,50}}$")).unwrap(),
        ch_strict: vec![
            Regex::new(&format!(r"^\s*第{num}[章回节集话][^\n]{{0,50}}$")).unwrap(),
            Regex::new(r"(?i)^\s*chapter\s+\d+\s*[:：.\-]?\s*.{0,50}$").unwrap(),
            Regex::new(&format!(r"^\s*[卷部篇]{num}\s*[:：、.\-]?\s*.{{0,50}}$")).unwrap(),
        ],
        ch_loose: Regex::new(r"^\s*\d{1,4}\s*[、.．]\s*\S.{0,40}$").unwrap(),
    }
}

fn is_valid_heading(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && t.chars().count() <= 60
}

/// 解析章节与分卷。按行扫描，多字节字符不会跨行，因此可按原始字节分行。
pub fn parse_book(file_path: &str) -> Result<ParsedBook, String> {
    let mut f = File::open(file_path).map_err(|e| format!("打开文件失败: {e}"))?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes)
        .map_err(|e| format!("读取文件失败: {e}"))?;

    let (bytes, enc) = normalize_to_utf8(&bytes);
    let pat = build_patterns();

    let mut chapters: Vec<ChapterParse> = Vec::new();
    let mut vol_marks: Vec<(u64, String)> = Vec::new(); // (字节偏移, 卷标题)

    let mut pos: u64 = 0;
    let mut pending_line: Vec<u8> = Vec::new();
    let mut in_leading_blank = true;

    let push_line = |raw: &[u8],
                         pos: u64,
                         chapters: &mut Vec<ChapterParse>,
                         vol_marks: &mut Vec<(u64, String)>,
                         in_leading_blank: &mut bool,
                         pat: &Patterns| {
        let line = decode_line(enc, raw);
        let trimmed = line.trim();
        if *in_leading_blank && trimmed.is_empty() {
            return; // 跳过文件头空行
        }
        *in_leading_blank = false;

        if is_valid_heading(trimmed) && pat.vol.is_match(trimmed) {
            vol_marks.push((pos, trimmed.chars().take(80).collect()));
            return;
        }
        let is_ch = pat.ch_strict.iter().any(|r| r.is_match(trimmed))
            || pat.ch_loose.is_match(trimmed);
        if is_ch {
            let idx = chapters.len() as i64;
            chapters.push(ChapterParse {
                idx,
                title: trimmed.chars().take(80).collect(),
                offset: pos,
            });
        }
    };

    // 按字节分行（\n），兼容 \r\n
    for &b in &bytes {
        if b == b'\n' {
            if !pending_line.is_empty() {
                let raw = if pending_line.last() == Some(&b'\r') {
                    &pending_line[..pending_line.len() - 1]
                } else {
                    &pending_line[..]
                };
                push_line(
                    raw,
                    pos - pending_line.len() as u64,
                    &mut chapters,
                    &mut vol_marks,
                    &mut in_leading_blank,
                    &pat,
                );
                pending_line.clear();
            }
            pos += 1;
        } else {
            pending_line.push(b);
            pos += 1;
        }
    }
    if !pending_line.is_empty() {
        let raw = if pending_line.last() == Some(&b'\r') {
            &pending_line[..pending_line.len() - 1]
        } else {
            &pending_line[..]
        };
        push_line(
            raw,
            pos - pending_line.len() as u64,
            &mut chapters,
            &mut vol_marks,
            &mut in_leading_blank,
            &pat,
        );
    }

    // 无匹配则整书一章
    if chapters.is_empty() {
        chapters.push(ChapterParse {
            idx: 0,
            title: "全文".to_string(),
            offset: 0,
        });
    }
    // 开头内容与第一章之间的兜底章节
    if chapters[0].offset > 0 {
        chapters.insert(
            0,
            ChapterParse {
                idx: 0,
                title: "作品相关".to_string(),
                offset: 0,
            },
        );
        for (i, c) in chapters.iter_mut().enumerate() {
            c.idx = i as i64;
        }
    }

    // 构建分卷：卷标记按字节偏移定位，落在其后、下一卷之前的章节归属该卷
    let mut volumes: Vec<VolumeParse> = Vec::new();
    for (vi, (voff, vtitle)) in vol_marks.iter().enumerate() {
        let start = chapters
            .iter()
            .position(|c| c.offset >= *voff)
            .unwrap_or(chapters.len()) as i64;
        volumes.push(VolumeParse {
            idx: vi as i64,
            title: vtitle.clone(),
            start_chapter: start,
            end_chapter: start, // 稍后统一修正
        });
    }
    for vi in 0..volumes.len() {
        let next_start = if vi + 1 < volumes.len() {
            volumes[vi + 1].start_chapter
        } else {
            chapters.len() as i64
        };
        volumes[vi].end_chapter = next_start - 1;
    }

    Ok(ParsedBook {
        encoding: enc.name().to_string(),
        chapters,
        volumes: volumes.into_iter().filter(|v| v.end_chapter >= v.start_chapter).collect(),
    })
}

/// 从字节偏移读取文本（自动处理编码），返回 UTF-8 文本。
/// max_bytes 用于限定读取范围（如恰好一章的字节长度），避免越界读入后续章节。
pub fn read_at(
    file_path: &str,
    offset: u64,
    max_chars: usize,
    encoding: &str,
    max_bytes: u64,
) -> Result<String, String> {
    let enc = Encoding::for_label(encoding.as_bytes()).unwrap_or(UTF_8);
    let mut f = File::open(file_path).map_err(|e| format!("打开文件失败: {e}"))?;
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("定位失败: {e}"))?;
    let byte_budget = ((max_chars * 4 + 64) as u64)
        .min(4 * 1024 * 1024)
        .min(if max_bytes > 0 { max_bytes } else { u64::MAX });
    let mut reader = BufReader::with_capacity(64 * 1024, f.take(byte_budget));
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取失败: {e}"))?;
    let (text, _, _) = enc.decode(&bytes);
    let cleaned: String = text
        .chars()
        .filter(|c| *c != '\r' && (*c == '\n' || !c.is_control()))
        .take(max_chars)
        .collect();
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_tmp(name: &str, bytes: &[u8]) -> String {
        let p = std::env::temp_dir().join(name);
        let mut f = File::create(&p).unwrap();
        f.write_all(bytes).unwrap();
        p.to_string_lossy().to_string()
    }

    #[test]
    fn test_parse_utf8_with_volumes() {
        let mut content = String::from("书名：测试小说\n作者：某人\n\n");
        for vol in 1..=2 {
            content.push_str(&format!("第{}卷 风云起\n\n", vol));
            for ch in 1..=50 {
                content.push_str(&format!("第{}章 章节标题{}\n\n", (vol - 1) * 50 + ch, ch));
                content.push_str("这是正文内容。测试文本，重复若干行。\n".repeat(10).as_str());
            }
        }
        let path = write_tmp("sr-test-utf8.txt", content.as_bytes());
        let parsed = parse_book(&path).unwrap();
        assert_eq!(parsed.chapters.len(), 101, "100 章 + 卷前序言归入「作品相关」");
        assert_eq!(parsed.chapters[0].title, "作品相关");
        assert_eq!(parsed.volumes.len(), 2, "应识别 2 卷");
        assert_eq!(parsed.volumes[0].start_chapter, 1);
        assert_eq!(parsed.volumes[0].end_chapter, 50);
        assert_eq!(parsed.volumes[1].start_chapter, 51);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_parse_gbk() {
        let mut content = String::from("序言\n\n");
        for ch in 1..=10 {
            content.push_str(&format!("第{}章 测试章节\n正文内容若干。\n", ch));
        }
        let (gbk_bytes, _, _) = GBK.encode(&content);
        let path = write_tmp("sr-test-gbk.txt", &gbk_bytes);
        let parsed = parse_book(&path).unwrap();
        assert_eq!(parsed.encoding, "GBK");
        assert_eq!(parsed.chapters.len(), 11, "10 章 + 序言归入「作品相关」");
        assert_eq!(parsed.chapters[0].title, "作品相关");
        // read_at 能正确解码
        let text = read_at(&path, parsed.chapters[4].offset, 100, "GBK", 0).unwrap();
        assert!(text.contains("第4章"), "应能解码 GBK 章节内容: {}", text);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_parse_utf16_transcode() {
        let content = "第一章 开始\n你好世界，UTF-16 编码。\n第二章 结束\n完。";
        // encoding_rs 不支持编码到 UTF-16，手动转码
        let mut with_bom = b"\xff\xfe".to_vec();
        for u in content.encode_utf16() {
            with_bom.extend_from_slice(&u.to_le_bytes());
        }
        let path = write_tmp("sr-test-u16.txt", &with_bom);
        // 模拟 import_book：UTF-16 先转码落盘再解析
        let (normalized, enc) = normalize_to_utf8(&with_bom);
        assert_eq!(enc.name().to_lowercase(), "utf-8");
        let path = write_tmp("sr-test-u16-normalized.txt", &normalized);
        let parsed = parse_book(&path).unwrap();
        assert_eq!(parsed.encoding.to_lowercase(), "utf-8", "UTF-16 应转码为 UTF-8 存储");
        assert_eq!(parsed.chapters.len(), 2);
        let text = read_at(&path, parsed.chapters[1].offset, 50, "utf-8", 0).unwrap();
        assert!(text.contains("第二章"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_parse_no_chapters() {
        let path = write_tmp("sr-test-plain.txt", "没有任何章节的纯文本。\n就这么多。".as_bytes());
        let parsed = parse_book(&path).unwrap();
        assert_eq!(parsed.chapters.len(), 1);
        assert_eq!(parsed.chapters[0].title, "全文");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_read_at_respects_max_bytes() {
        // 章节内容后紧跟下一章，max_bytes 限定后不得读入下一章内容
        let content = "第一章 开始\n本章正文到此为止。\n第二章 后续\n别的章节内容。";
        let path = write_tmp("sr-test-boundary.txt", content.as_bytes());
        let parsed = parse_book(&path).unwrap();
        assert_eq!(parsed.chapters.len(), 2);
        let ch0 = &parsed.chapters[0];
        let ch1 = &parsed.chapters[1];
        let full = read_at(&path, ch0.offset, 1000, "utf-8", 0).unwrap();
        assert!(full.contains("第二章"), "不限字节数时读到后续内容");
        let bounded = read_at(
            &path,
            ch0.offset,
            1000,
            "utf-8",
            ch1.offset - ch0.offset,
        )
        .unwrap();
        assert!(bounded.contains("本章正文"));
        assert!(!bounded.contains("第二章"), "max_bytes 内不得混入下一章");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_big_file_perf() {
        // 生成约 30MB 文本，验证解析性能
        let mut content = String::new();
        for ch in 1..=2000 {
            content.push_str(&format!("第{}章 章节\n", ch));
            content.push_str("大江东去浪淘尽千古风流人物。\n".repeat(300).as_str());
        }
        let bytes = content.as_bytes();
        eprintln!("test file size: {} MB", bytes.len() / 1024 / 1024);
        let path = write_tmp("sr-test-big.txt", bytes);
        let t = std::time::Instant::now();
        let parsed = parse_book(&path).unwrap();
        eprintln!("parse 2000 chapters took {:?}", t.elapsed());
        assert_eq!(parsed.chapters.len(), 2000);
        assert!(t.elapsed().as_secs() < 10, "30MB 解析应远快于 10 秒");
        std::fs::remove_file(&path).ok();
    }
}
