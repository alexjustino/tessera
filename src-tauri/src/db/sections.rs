//! A notebook in sections (migration 022): named, coloured groups of pages.
//!
//! A page is in one section or in none, and none is Quick notes. Deleting a section
//! sends its pages back to Quick notes and never deletes one: a press that tidies the
//! notebook must not be able to lose what was written in it.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use super::items::{check_position, now};
use super::pages::{self, Page};
use crate::error::{Error, Result};

/// The colours a section can wear. The interface names them; the host keeps to the list.
pub const COLORS: &[&str] = &[
    "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray",
];

const LONGEST_NAME: usize = 60;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Section {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub position: String,
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Section> {
    Ok(Section {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        position: row.get(3)?,
    })
}

fn check_color(color: Option<&str>) -> Result<()> {
    match color {
        Some(name) if !COLORS.contains(&name) => {
            Err(Error::InvalidInput("that is not one of the colours"))
        }
        _ => Ok(()),
    }
}

fn clean_name(conn: &Connection, name: &str, except: Option<&str>) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::InvalidInput("a section needs a name"));
    }
    if name.chars().count() > LONGEST_NAME {
        return Err(Error::InvalidInput("that name is too long for a section"));
    }
    // Quick notes is where pages with no section are, and is never a row.
    if name.to_lowercase() == "quick notes" {
        return Err(Error::InvalidInput("Quick notes is already there"));
    }
    let taken = list(conn)?.into_iter().any(|section| {
        Some(section.id.as_str()) != except && section.name.to_lowercase() == name.to_lowercase()
    });
    if taken {
        return Err(Error::InvalidInput(
            "there is already a section with that name",
        ));
    }
    Ok(name.to_owned())
}

pub fn list(conn: &Connection) -> Result<Vec<Section>> {
    let mut statement = conn
        .prepare("SELECT id, name, color, position FROM section ORDER BY position, created_at")?;
    let rows = statement.query_map([], read)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn get(conn: &Connection, id: &str) -> Result<Section> {
    conn.query_row(
        "SELECT id, name, color, position FROM section WHERE id = ?1",
        params![id],
        read,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

pub fn create(
    conn: &Connection,
    name: &str,
    color: Option<&str>,
    position: &str,
) -> Result<Section> {
    check_position(position)?;
    check_color(color)?;
    let name = clean_name(conn, name, None)?;
    let id = Uuid::now_v7().to_string();
    let timestamp = now();
    conn.execute(
        "INSERT INTO section (id, name, color, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, name, color, position, timestamp],
    )?;
    get(conn, &id)
}

/// Rename a section, or give it another colour.
pub fn update(conn: &Connection, id: &str, name: &str, color: Option<&str>) -> Result<Section> {
    get(conn, id)?;
    check_color(color)?;
    let name = clean_name(conn, name, Some(id))?;
    conn.execute(
        "UPDATE section SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, name, color, now()],
    )?;
    get(conn, id)
}

/// Delete a section. Its pages go back to Quick notes; none is deleted.
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    get(conn, id)?;
    conn.execute(
        "UPDATE page SET section_id = NULL WHERE section_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM section WHERE id = ?1", params![id])?;
    Ok(())
}

/// File a page in a section, or in Quick notes with none.
pub fn file_page(conn: &Connection, page_id: &str, section_id: Option<&str>) -> Result<Page> {
    if let Some(section) = section_id {
        get(conn, section)?;
    }
    let changed = conn.execute(
        "UPDATE page SET section_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![page_id, section_id, now()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    pages::get(conn, page_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    #[test]
    fn makes_a_section_and_files_a_page_in_it() {
        let mut conn = workspace();
        let section = create(&conn, " Projects ", Some("blue"), "V").unwrap();
        let page = pages::create(&mut conn, "Kick-off", "V").unwrap();
        assert_eq!(page.section_id, None);

        let filed = file_page(&conn, &page.id, Some(&section.id)).unwrap();

        assert_eq!(section.name, "Projects");
        assert_eq!(section.color.as_deref(), Some("blue"));
        assert_eq!(filed.section_id.as_deref(), Some(section.id.as_str()));
        assert_eq!(pages::list(&conn).unwrap()[0].section_id, filed.section_id);
    }

    #[test]
    fn renames_and_recolours_a_section() {
        let conn = workspace();
        let section = create(&conn, "Projects", None, "V").unwrap();
        let changed = update(&conn, &section.id, "Clients", Some("green")).unwrap();
        assert_eq!(changed.name, "Clients");
        assert_eq!(changed.color.as_deref(), Some("green"));
    }

    #[test]
    fn deleting_a_section_sends_its_pages_to_quick_notes_and_keeps_them() {
        let mut conn = workspace();
        let section = create(&conn, "Projects", None, "V").unwrap();
        let page = pages::create(&mut conn, "Kick-off", "V").unwrap();
        file_page(&conn, &page.id, Some(&section.id)).unwrap();

        delete(&conn, &section.id).unwrap();

        assert!(list(&conn).unwrap().is_empty());
        assert_eq!(pages::get(&conn, &page.id).unwrap().section_id, None);
    }

    #[test]
    fn a_page_goes_back_to_quick_notes() {
        let mut conn = workspace();
        let section = create(&conn, "Projects", None, "V").unwrap();
        let page = pages::create(&mut conn, "Kick-off", "V").unwrap();
        file_page(&conn, &page.id, Some(&section.id)).unwrap();
        assert_eq!(file_page(&conn, &page.id, None).unwrap().section_id, None);
    }

    // ── Negative cases ─────────────────────────────────────────────────────
    #[test]
    fn refuses_a_colour_not_on_the_list() {
        let conn = workspace();
        assert!(matches!(
            create(&conn, "Projects", Some("#ff0000"), "V"),
            Err(Error::InvalidInput(_))
        ));
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn refuses_an_empty_long_or_taken_name() {
        let conn = workspace();
        create(&conn, "Projects", None, "V").unwrap();
        assert!(create(&conn, "  ", None, "W").is_err());
        assert!(create(&conn, &"x".repeat(61), None, "W").is_err());
        assert!(create(&conn, "projects", None, "W").is_err());
        assert!(create(&conn, "Quick Notes", None, "W").is_err());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn refuses_to_file_into_a_section_that_does_not_exist() {
        let mut conn = workspace();
        let page = pages::create(&mut conn, "Kick-off", "V").unwrap();
        assert!(matches!(
            file_page(&conn, &page.id, Some("gone")),
            Err(Error::NotFound)
        ));
        assert_eq!(pages::get(&conn, &page.id).unwrap().section_id, None);
    }

    #[test]
    fn refuses_to_file_a_page_that_does_not_exist() {
        let conn = workspace();
        assert!(matches!(
            file_page(&conn, "gone", None),
            Err(Error::NotFound)
        ));
    }
}
