//! An email draft, as a file the person's own mail program opens.
//!
//! Tessera never sends mail and never signs in to anything (ADR-012). It writes a
//! `.eml` marked as unsent, which Outlook and most mail programs open as a draft
//! ready to address, and hands it over. The file stays on this machine.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use chrono::Utc;

use crate::error::{Error, Result};

/// A draft left behind is a copy of somebody's notes in a temporary folder, so
/// the old ones are cleared whenever a new one is written.
const KEPT_FOR: Duration = Duration::from_secs(24 * 60 * 60);

fn encoded(text: &str) -> String {
    let body = base64::engine::general_purpose::STANDARD.encode(text.as_bytes());
    body.as_bytes()
        .chunks(76)
        .map(|line| String::from_utf8_lossy(line).into_owned())
        .collect::<Vec<_>>()
        .join("\r\n")
}

/// The message, ready to write. A subject with line breaks would be a way to add
/// headers, so they are taken out; it is encoded so any language survives.
pub fn message(subject: &str, html: &str, text: &str) -> String {
    let subject: String = subject.chars().filter(|c| !c.is_control()).collect();
    let subject = base64::engine::general_purpose::STANDARD.encode(subject.as_bytes());
    let boundary = format!("tessera-{}", Utc::now().timestamp_millis());
    format!(
        "X-Unsent: 1\r\n\
         Subject: =?UTF-8?B?{subject}?=\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\
         \r\n\
         --{boundary}\r\n\
         Content-Type: text/plain; charset=UTF-8\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {plain}\r\n\
         --{boundary}\r\n\
         Content-Type: text/html; charset=UTF-8\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {rich}\r\n\
         --{boundary}--\r\n",
        plain = encoded(text),
        rich = encoded(html),
    )
}

fn clear_old(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > KEPT_FOR);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Write the draft into `folder`, clearing the old ones. Returns where it went.
pub fn write_draft(folder: &Path, subject: &str, html: &str, text: &str) -> Result<PathBuf> {
    let refused = |_| Error::InvalidInput("the draft could not be written to disk");
    std::fs::create_dir_all(folder).map_err(refused)?;
    clear_old(folder);
    let path = folder.join(format!("draft-{}.eml", Utc::now().timestamp_millis()));
    std::fs::write(&path, message(subject, html, text)).map_err(refused)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(eml: &str, marker: &str) -> String {
        let start = eml.find(marker).expect("the part") + marker.len();
        let body = &eml[start..];
        let end = body.find("\r\n--").expect("the end of the part");
        let flat: String = body[..end].split_whitespace().collect();
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(flat)
                .expect("base64"),
        )
        .expect("utf-8")
    }

    #[test]
    fn it_opens_as_an_unsent_draft_with_nobody_on_it() {
        let eml = message("Nozomi", "<p>Hi</p>", "Hi");
        assert!(eml.starts_with("X-Unsent: 1\r\n"));
        assert!(!eml.contains("\r\nTo:"));
        assert!(!eml.contains("\r\nFrom:"));
    }

    #[test]
    fn it_carries_both_forms_and_any_language() {
        let eml = message("Reunião", "<p>Olá, ação</p>", "Olá, ação");
        assert_eq!(
            decode(
                eml.as_str(),
                "text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            ),
            "Olá, ação"
        );
        assert_eq!(
            decode(
                eml.as_str(),
                "text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            ),
            "<p>Olá, ação</p>"
        );
    }

    #[test]
    fn a_subject_cannot_add_headers() {
        let eml = message("Hello\r\nBcc: someone@example.com", "", "");
        assert!(!eml.contains("\r\nBcc:"));
    }

    #[test]
    fn it_writes_the_file_where_it_was_told() {
        let folder = std::env::temp_dir().join(format!("tessera-email-{}", std::process::id()));
        let path = write_draft(&folder, "Nozomi", "<p>Hi</p>", "Hi").unwrap();
        assert_eq!(path.extension().unwrap(), "eml");
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("X-Unsent: 1"));
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
