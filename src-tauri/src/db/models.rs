//! The shapes that cross the command boundary.
//!
//! These mirror the schema, not the interface: the frontend translates
//! snake_case into its own vocabulary once, in `src/data/`, rather than letting
//! the database's naming leak into every component.

use serde::{Deserialize, Serialize};

/// A list, board or database — the container a set of items lives in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A unit of work.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Item {
    pub id: String,
    pub collection_id: String,
    pub parent_item_id: Option<String>,
    pub title: String,
    pub position: String,
    /// All UTC instants (ADR-013).
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub remind_at: Option<String>,
    /// An RFC 5545 rule without DTSTART. The host stores it; expanding it is
    /// the domain layer's job, where the timezone arithmetic lives.
    pub recurrence_rrule: Option<String>,
    pub recurrence_mode: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Item {
    pub fn is_completed(&self) -> bool {
        self.completed_at.is_some()
    }
}

/// The dates and repetition of one item.
#[derive(Debug, Clone, Deserialize)]
pub struct ItemSchedule {
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub remind_at: Option<String>,
    pub recurrence_rrule: Option<String>,
    pub recurrence_mode: Option<String>,
}

/// What the interface sends to create an item.
///
/// `position` is computed by the domain layer and passed in: the ordering
/// algorithm lives in one place, in pure TypeScript, and the host stores what it
/// is given (ADR-006).
#[derive(Debug, Clone, Deserialize)]
pub struct NewItem {
    pub collection_id: String,
    pub title: String,
    pub position: String,
}

/// A typed field a collection declares.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Property {
    pub id: String,
    pub collection_id: String,
    /// Stable across renames. What saved views refer to.
    pub key: String,
    pub name: String,
    pub r#type: String,
    /// Per-type configuration. The host stores it and does not interpret it —
    /// the shape is the domain layer's business (ADR-003).
    pub config: serde_json::Value,
    pub position: String,
    /// Seeded by a migration: renameable, not deletable.
    pub is_system: bool,
}

/// What the interface sends to declare a property.
#[derive(Debug, Clone, Deserialize)]
pub struct NewProperty {
    pub collection_id: String,
    pub name: String,
    pub r#type: String,
    pub config: serde_json::Value,
    pub position: String,
}

/// One stored value, flat. Joined to its item in the interface.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PropertyValueRow {
    pub item_id: String,
    pub property_id: String,
    pub value: serde_json::Value,
}

/// A saved query, given a name and a shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct View {
    pub id: String,
    /// None for a cross-collection view: Today, Inbox, Overdue.
    pub collection_id: Option<String>,
    pub name: String,
    pub kind: String,
    /// Filters, sorts, grouping and visible fields. Stored, not interpreted.
    pub config: serde_json::Value,
    pub position: String,
}

/// What the interface sends to save a new view.
#[derive(Debug, Clone, Deserialize)]
pub struct NewView {
    pub collection_id: Option<String>,
    pub name: String,
    pub kind: String,
    pub config: serde_json::Value,
    pub position: String,
}

/// One stored top-level node of a document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Block {
    pub id: String,
    pub owner_kind: String,
    pub owner_id: String,
    pub r#type: String,
    pub position: String,
    /// The node as JSON. The host stores it and does not read it (ADR-003).
    pub content: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BlockCreate {
    pub id: String,
    pub r#type: String,
    pub position: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BlockUpdate {
    pub id: String,
    pub r#type: String,
    pub position: String,
    pub content: serde_json::Value,
}

/// The smallest set of writes a document change implies, computed upstream.
#[derive(Debug, Clone, Deserialize)]
pub struct BlockChanges {
    pub creates: Vec<BlockCreate>,
    pub updates: Vec<BlockUpdate>,
    pub deletes: Vec<String>,
}
