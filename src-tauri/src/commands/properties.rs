//! Property commands.

use serde_json::Value;
use tauri::State;

use crate::db::models::{NewProperty, Property, PropertyValueRow};
use crate::db::{properties, Db};
use crate::error::Result;

#[tauri::command]
pub fn properties_list(db: State<'_, Db>, collection_id: String) -> Result<Vec<Property>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    properties::list_properties(&conn, &collection_id)
}

#[tauri::command]
pub fn property_create(db: State<'_, Db>, property: NewProperty) -> Result<Property> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    properties::create_property(&conn, property)
}

#[tauri::command]
pub fn property_update(
    db: State<'_, Db>,
    id: String,
    name: String,
    config: Value,
) -> Result<Property> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    properties::update_property(&conn, &id, &name, &config)
}

#[tauri::command]
pub fn property_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    properties::delete_property(&conn, &id)
}

#[tauri::command]
pub fn property_values_list(
    db: State<'_, Db>,
    collection_id: String,
) -> Result<Vec<PropertyValueRow>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    properties::list_values(&conn, &collection_id)
}

#[tauri::command]
pub fn property_value_set(
    db: State<'_, Db>,
    item_id: String,
    property_id: String,
    value: Value,
) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    properties::set_value(&conn, &item_id, &property_id, &value)
}
