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
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Item {
    pub fn is_completed(&self) -> bool {
        self.completed_at.is_some()
    }
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
