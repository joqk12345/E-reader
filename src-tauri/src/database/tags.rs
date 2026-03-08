use crate::models::{
    BatchTagReviewDoc, BatchTagReviewItem, DocumentTagAssignment, RelatedDocument, TagAlias,
    TagFacet, TagRecord, TagSuggestion,
};
use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result};
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

const STATUS_PENDING: &str = "pending";
const STATUS_ACCEPTED: &str = "accepted";
const STATUS_REJECTED: &str = "rejected";

#[derive(Error, Debug)]
pub enum TagError {
    #[error("Tag name cannot be empty")]
    EmptyName,
    #[error("Tag conflict: {0}")]
    Conflict(String),
    #[error("Tag not found")]
    NotFound,
    #[error("Suggestion not found")]
    SuggestionNotFound,
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
}

#[derive(Debug, Clone)]
pub struct NewTagSuggestion {
    pub doc_id: String,
    pub proposed_name: String,
    pub source: String,
    pub matched_tag_id: Option<String>,
    pub reason: Option<String>,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct ReviewTagSuggestionAction {
    pub suggestion_ids: Vec<String>,
    pub action: String,
    pub tag_id: Option<String>,
    pub new_tag_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReviewTagSuggestionResult {
    pub accepted: usize,
    pub rejected: usize,
    pub created_tags: usize,
    pub mapped_to_existing: usize,
}

pub fn normalize_tag_name(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_lowercase()
}

fn sanitize_tag_name(input: &str) -> Result<(String, String), TagError> {
    let name = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err(TagError::EmptyName);
    }
    let normalized = normalize_tag_name(&name);
    if normalized.is_empty() {
        return Err(TagError::EmptyName);
    }
    Ok((name, normalized))
}

fn load_aliases_by_tag_ids(
    conn: &Connection,
    tag_ids: &[String],
) -> Result<HashMap<String, Vec<TagAlias>>, TagError> {
    if tag_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = tag_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, tag_id, alias, normalized_alias, created_at, updated_at
         FROM tag_aliases
         WHERE tag_id IN ({})
         ORDER BY alias COLLATE NOCASE ASC",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(tag_ids.iter()), |row| {
        Ok(TagAlias {
            id: row.get(0)?,
            tag_id: row.get(1)?,
            alias: row.get(2)?,
            normalized_alias: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    let mut aliases = HashMap::new();
    for row in rows {
        let alias = row?;
        aliases
            .entry(alias.tag_id.clone())
            .or_insert_with(Vec::new)
            .push(alias);
    }
    Ok(aliases)
}

fn get_tag_core(conn: &Connection, tag_id: &str) -> Result<Option<TagRecord>, TagError> {
    conn.query_row(
        "SELECT id, name, normalized_name, is_temporary, created_at, updated_at
         FROM tags
         WHERE id = ?1",
        params![tag_id],
        |row| {
            Ok(TagRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                normalized_name: row.get(2)?,
                is_temporary: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                usage_count: 0,
                pending_suggestion_count: 0,
                aliases: Vec::new(),
            })
        },
    )
    .optional()
    .map_err(TagError::from)
}

fn get_tag_usage_count(conn: &Connection, tag_id: &str) -> Result<usize, TagError> {
    conn.query_row(
        "SELECT COUNT(DISTINCT doc_id) FROM document_tags WHERE tag_id = ?1",
        params![tag_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count.max(0) as usize)
    .map_err(TagError::from)
}

fn get_tag_pending_count(conn: &Connection, tag_id: &str) -> Result<usize, TagError> {
    conn.query_row(
        "SELECT COUNT(*)
         FROM tag_suggestions
         WHERE matched_tag_id = ?1 AND status = ?2",
        params![tag_id, STATUS_PENDING],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count.max(0) as usize)
    .map_err(TagError::from)
}

fn attach_tag_details(conn: &Connection, tag: &mut TagRecord) -> Result<(), TagError> {
    tag.usage_count = get_tag_usage_count(conn, &tag.id)?;
    tag.pending_suggestion_count = get_tag_pending_count(conn, &tag.id)?;
    tag.aliases = load_aliases_by_tag_ids(conn, &[tag.id.clone()])?
        .remove(&tag.id)
        .unwrap_or_default();
    Ok(())
}

pub fn resolve_tag_by_name(
    conn: &Connection,
    raw_name: &str,
) -> Result<Option<TagRecord>, TagError> {
    let (_, normalized) = sanitize_tag_name(raw_name)?;

    if let Some(mut tag) = conn
        .query_row(
            "SELECT id, name, normalized_name, is_temporary, created_at, updated_at
             FROM tags
             WHERE normalized_name = ?1",
            params![normalized],
            |row| {
                Ok(TagRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    normalized_name: row.get(2)?,
                    is_temporary: row.get::<_, i64>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    usage_count: 0,
                    pending_suggestion_count: 0,
                    aliases: Vec::new(),
                })
            },
        )
        .optional()?
    {
        attach_tag_details(conn, &mut tag)?;
        return Ok(Some(tag));
    }

    if let Some(tag_id) = conn
        .query_row(
            "SELECT tag_id FROM tag_aliases WHERE normalized_alias = ?1",
            params![normalized],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        let mut tag = get_tag_core(conn, &tag_id)?.ok_or(TagError::NotFound)?;
        attach_tag_details(conn, &mut tag)?;
        return Ok(Some(tag));
    }

    Ok(None)
}

fn ensure_name_not_conflicting(
    conn: &Connection,
    normalized: &str,
    current_tag_id: Option<&str>,
) -> Result<(), TagError> {
    if let Some(existing_id) = conn
        .query_row(
            "SELECT id FROM tags WHERE normalized_name = ?1",
            params![normalized],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        if current_tag_id != Some(existing_id.as_str()) {
            return Err(TagError::Conflict(format!(
                "canonical tag already exists for '{}'",
                normalized
            )));
        }
    }

    if let Some(existing_id) = conn
        .query_row(
            "SELECT tag_id FROM tag_aliases WHERE normalized_alias = ?1",
            params![normalized],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        if current_tag_id != Some(existing_id.as_str()) {
            return Err(TagError::Conflict(format!(
                "alias already exists for '{}'",
                normalized
            )));
        }
    }

    Ok(())
}

pub fn ensure_tag(
    conn: &Connection,
    raw_name: &str,
    is_temporary: bool,
) -> Result<TagRecord, TagError> {
    if let Some(tag) = resolve_tag_by_name(conn, raw_name)? {
        if is_temporary || !tag.is_temporary {
            return Ok(tag);
        }
        conn.execute(
            "UPDATE tags SET is_temporary = 0, updated_at = ?2 WHERE id = ?1",
            params![tag.id, Utc::now().timestamp()],
        )?;
        let mut refreshed = get_tag_core(conn, &tag.id)?.ok_or(TagError::NotFound)?;
        attach_tag_details(conn, &mut refreshed)?;
        return Ok(refreshed);
    }

    let (name, normalized) = sanitize_tag_name(raw_name)?;
    ensure_name_not_conflicting(conn, &normalized, None)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO tags (id, name, normalized_name, is_temporary, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            name,
            normalized,
            if is_temporary { 1 } else { 0 },
            now,
            now
        ],
    )?;

    let mut tag = get_tag_core(conn, &id)?.ok_or(TagError::NotFound)?;
    attach_tag_details(conn, &mut tag)?;
    Ok(tag)
}

pub fn list_document_tags(
    conn: &Connection,
    doc_id: Option<&str>,
) -> Result<Vec<DocumentTagAssignment>, TagError> {
    let mut sql = String::from(
        "SELECT dt.doc_id, dt.tag_id, t.name, t.normalized_name, t.is_temporary, dt.source, dt.applied_at
         FROM document_tags dt
         JOIN tags t ON t.id = dt.tag_id",
    );
    if doc_id.is_some() {
        sql.push_str(" WHERE dt.doc_id = ?1");
    }
    sql.push_str(" ORDER BY t.name COLLATE NOCASE ASC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(doc_id) = doc_id {
        stmt.query_map(params![doc_id], |row| {
            Ok(DocumentTagAssignment {
                doc_id: row.get(0)?,
                tag_id: row.get(1)?,
                tag_name: row.get(2)?,
                normalized_name: row.get(3)?,
                is_temporary: row.get::<_, i64>(4)? != 0,
                source: row.get(5)?,
                applied_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map([], |row| {
            Ok(DocumentTagAssignment {
                doc_id: row.get(0)?,
                tag_id: row.get(1)?,
                tag_name: row.get(2)?,
                normalized_name: row.get(3)?,
                is_temporary: row.get::<_, i64>(4)? != 0,
                source: row.get(5)?,
                applied_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn list_tag_library(
    conn: &Connection,
    search: Option<&str>,
    only_temporary: bool,
    only_unused: bool,
) -> Result<Vec<TagRecord>, TagError> {
    let search_filter = search
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value));
    let mut stmt = conn.prepare(
        "SELECT
            t.id,
            t.name,
            t.normalized_name,
            t.is_temporary,
            t.created_at,
            t.updated_at,
            COUNT(DISTINCT dt.doc_id) AS usage_count,
            COUNT(DISTINCT CASE WHEN ts.status = 'pending' THEN ts.id END) AS pending_count
         FROM tags t
         LEFT JOIN document_tags dt ON dt.tag_id = t.id
         LEFT JOIN tag_suggestions ts ON ts.matched_tag_id = t.id
         WHERE
            (?1 IS NULL OR t.name LIKE ?1 OR EXISTS (
                SELECT 1 FROM tag_aliases ta2 WHERE ta2.tag_id = t.id AND ta2.alias LIKE ?1
            ))
            AND (?2 = 0 OR t.is_temporary = 1)
         GROUP BY t.id
         HAVING (?3 = 0 OR COUNT(DISTINCT dt.doc_id) = 0)
         ORDER BY usage_count DESC, t.name COLLATE NOCASE ASC",
    )?;

    let mut tags = stmt
        .query_map(
            params![
                search_filter,
                if only_temporary { 1 } else { 0 },
                if only_unused { 1 } else { 0 }
            ],
            |row| {
                Ok(TagRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    normalized_name: row.get(2)?,
                    is_temporary: row.get::<_, i64>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    usage_count: row.get::<_, i64>(6)?.max(0) as usize,
                    pending_suggestion_count: row.get::<_, i64>(7)?.max(0) as usize,
                    aliases: Vec::new(),
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let tag_ids = tags.iter().map(|tag| tag.id.clone()).collect::<Vec<_>>();
    let alias_map = load_aliases_by_tag_ids(conn, &tag_ids)?;
    for tag in &mut tags {
        tag.aliases = alias_map.get(&tag.id).cloned().unwrap_or_default();
    }
    Ok(tags)
}

pub fn list_tag_facets(conn: &Connection, search: Option<&str>) -> Result<Vec<TagFacet>, TagError> {
    let search_filter = search
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value));
    let mut stmt = conn.prepare(
        "SELECT
            t.id,
            t.name,
            t.normalized_name,
            t.is_temporary,
            COUNT(DISTINCT dt.doc_id) AS doc_count
         FROM tags t
         LEFT JOIN document_tags dt ON dt.tag_id = t.id
         WHERE
            (?1 IS NULL OR t.name LIKE ?1 OR EXISTS (
                SELECT 1 FROM tag_aliases ta WHERE ta.tag_id = t.id AND ta.alias LIKE ?1
            ))
         GROUP BY t.id
         HAVING COUNT(DISTINCT dt.doc_id) > 0
         ORDER BY doc_count DESC, t.name COLLATE NOCASE ASC",
    )?;

    let facets = stmt
        .query_map(params![search_filter], |row| {
            Ok(TagFacet {
                tag_id: row.get(0)?,
                name: row.get(1)?,
                normalized_name: row.get(2)?,
                is_temporary: row.get::<_, i64>(3)? != 0,
                count: row.get::<_, i64>(4)?.max(0) as usize,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(facets)
}

pub fn apply_document_tags(
    conn: &Connection,
    doc_ids: &[String],
    tag_ids: &[String],
    source: &str,
) -> Result<usize, TagError> {
    let now = Utc::now().timestamp();
    let mut applied = 0;
    let mut seen = HashSet::new();
    for doc_id in doc_ids {
        for tag_id in tag_ids {
            if !seen.insert((doc_id.clone(), tag_id.clone())) {
                continue;
            }
            let changed = conn.execute(
                "INSERT OR IGNORE INTO document_tags (doc_id, tag_id, source, applied_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![doc_id, tag_id, source, now],
            )?;
            applied += changed;
        }
    }
    Ok(applied)
}

pub fn remove_document_tag(conn: &Connection, doc_id: &str, tag_id: &str) -> Result<(), TagError> {
    conn.execute(
        "DELETE FROM document_tags WHERE doc_id = ?1 AND tag_id = ?2",
        params![doc_id, tag_id],
    )?;
    Ok(())
}

pub fn clear_pending_suggestions_for_doc(conn: &Connection, doc_id: &str) -> Result<(), TagError> {
    conn.execute(
        "DELETE FROM tag_suggestions WHERE doc_id = ?1 AND status = ?2",
        params![doc_id, STATUS_PENDING],
    )?;
    Ok(())
}

pub fn insert_tag_suggestion(
    conn: &Connection,
    input: NewTagSuggestion,
) -> Result<TagSuggestion, TagError> {
    let (proposed_name, normalized_name) = sanitize_tag_name(&input.proposed_name)?;
    conn.execute(
        "DELETE FROM tag_suggestions
         WHERE doc_id = ?1 AND normalized_name = ?2 AND status = ?3",
        params![input.doc_id, normalized_name, STATUS_PENDING],
    )?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO tag_suggestions (
            id, doc_id, proposed_name, normalized_name, matched_tag_id, source, status,
            reason, confidence, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            input.doc_id,
            proposed_name,
            normalized_name,
            input.matched_tag_id,
            input.source,
            STATUS_PENDING,
            input.reason,
            input.confidence,
            now,
            now
        ],
    )?;
    get_tag_suggestion(conn, &id)?.ok_or(TagError::SuggestionNotFound)
}

fn get_tag_suggestion(
    conn: &Connection,
    suggestion_id: &str,
) -> Result<Option<TagSuggestion>, TagError> {
    conn.query_row(
        "SELECT
            ts.id,
            ts.doc_id,
            ts.proposed_name,
            ts.normalized_name,
            ts.matched_tag_id,
            t.name,
            ts.source,
            ts.status,
            ts.reason,
            ts.confidence,
            ts.created_at,
            ts.updated_at
         FROM tag_suggestions ts
         LEFT JOIN tags t ON t.id = ts.matched_tag_id
         WHERE ts.id = ?1",
        params![suggestion_id],
        |row| {
            Ok(TagSuggestion {
                id: row.get(0)?,
                doc_id: row.get(1)?,
                proposed_name: row.get(2)?,
                normalized_name: row.get(3)?,
                matched_tag_id: row.get(4)?,
                matched_tag_name: row.get(5)?,
                source: row.get(6)?,
                status: row.get(7)?,
                reason: row.get(8)?,
                confidence: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        },
    )
    .optional()
    .map_err(TagError::from)
}

pub fn list_tag_suggestions(
    conn: &Connection,
    doc_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<TagSuggestion>, TagError> {
    let mut sql = String::from(
        "SELECT
            ts.id,
            ts.doc_id,
            ts.proposed_name,
            ts.normalized_name,
            ts.matched_tag_id,
            t.name,
            ts.source,
            ts.status,
            ts.reason,
            ts.confidence,
            ts.created_at,
            ts.updated_at
         FROM tag_suggestions ts
         LEFT JOIN tags t ON t.id = ts.matched_tag_id
         WHERE 1 = 1",
    );
    let mut params_vec: Vec<String> = Vec::new();
    if let Some(doc_id) = doc_id {
        sql.push_str(" AND ts.doc_id = ?");
        params_vec.push(doc_id.to_string());
    }
    if let Some(status) = status {
        sql.push_str(" AND ts.status = ?");
        params_vec.push(status.to_string());
    }
    sql.push_str(" ORDER BY ts.created_at DESC, ts.proposed_name COLLATE NOCASE ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(params_vec.iter()), |row| {
            Ok(TagSuggestion {
                id: row.get(0)?,
                doc_id: row.get(1)?,
                proposed_name: row.get(2)?,
                normalized_name: row.get(3)?,
                matched_tag_id: row.get(4)?,
                matched_tag_name: row.get(5)?,
                source: row.get(6)?,
                status: row.get(7)?,
                reason: row.get(8)?,
                confidence: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_batch_tag_review_items(conn: &Connection) -> Result<Vec<BatchTagReviewItem>, TagError> {
    let suggestions = list_tag_suggestions(conn, None, Some(STATUS_PENDING))?;
    if suggestions.is_empty() {
        return Ok(Vec::new());
    }

    let mut doc_titles = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, title FROM documents")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, title) = row?;
            doc_titles.insert(id, title);
        }
    }

    let mut groups: HashMap<(String, Option<String>), BatchTagReviewItem> = HashMap::new();
    for suggestion in suggestions {
        let key = (
            suggestion.normalized_name.clone(),
            suggestion.matched_tag_id.clone(),
        );
        let group = groups.entry(key).or_insert_with(|| BatchTagReviewItem {
            normalized_name: suggestion.normalized_name.clone(),
            proposed_name: suggestion.proposed_name.clone(),
            matched_tag_id: suggestion.matched_tag_id.clone(),
            matched_tag_name: suggestion.matched_tag_name.clone(),
            doc_count: 0,
            suggestion_ids: Vec::new(),
            sample_docs: Vec::new(),
            reasons: Vec::new(),
        });

        group.doc_count += 1;
        group.suggestion_ids.push(suggestion.id.clone());
        if group.sample_docs.len() < 5 {
            group.sample_docs.push(BatchTagReviewDoc {
                doc_id: suggestion.doc_id.clone(),
                title: doc_titles
                    .get(&suggestion.doc_id)
                    .cloned()
                    .unwrap_or_else(|| suggestion.doc_id.clone()),
            });
        }
        if let Some(reason) = suggestion.reason.clone() {
            if !reason.trim().is_empty() && !group.reasons.iter().any(|item| item == &reason) {
                group.reasons.push(reason);
            }
        }
    }

    let mut items = groups.into_values().collect::<Vec<_>>();
    items.sort_by(|a, b| {
        b.doc_count.cmp(&a.doc_count).then_with(|| {
            a.proposed_name
                .to_lowercase()
                .cmp(&b.proposed_name.to_lowercase())
        })
    });
    Ok(items)
}

pub fn review_tag_suggestions(
    conn: &Connection,
    actions: &[ReviewTagSuggestionAction],
) -> Result<ReviewTagSuggestionResult, TagError> {
    let mut result = ReviewTagSuggestionResult {
        accepted: 0,
        rejected: 0,
        created_tags: 0,
        mapped_to_existing: 0,
    };

    for action in actions {
        if action.suggestion_ids.is_empty() {
            continue;
        }
        let placeholders = action
            .suggestion_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT
                ts.id,
                ts.doc_id,
                ts.proposed_name,
                ts.normalized_name,
                ts.matched_tag_id,
                t.name,
                ts.source,
                ts.status,
                ts.reason,
                ts.confidence,
                ts.created_at,
                ts.updated_at
             FROM tag_suggestions ts
             LEFT JOIN tags t ON t.id = ts.matched_tag_id
             WHERE ts.id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&sql)?;
        let suggestions = stmt
            .query_map(params_from_iter(action.suggestion_ids.iter()), |row| {
                Ok(TagSuggestion {
                    id: row.get(0)?,
                    doc_id: row.get(1)?,
                    proposed_name: row.get(2)?,
                    normalized_name: row.get(3)?,
                    matched_tag_id: row.get(4)?,
                    matched_tag_name: row.get(5)?,
                    source: row.get(6)?,
                    status: row.get(7)?,
                    reason: row.get(8)?,
                    confidence: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        if suggestions.is_empty() {
            return Err(TagError::SuggestionNotFound);
        }

        let pending = suggestions
            .iter()
            .filter(|suggestion| suggestion.status == STATUS_PENDING)
            .cloned()
            .collect::<Vec<_>>();
        if pending.is_empty() {
            continue;
        }

        match action.action.as_str() {
            "reject" => {
                conn.execute(
                    &format!(
                        "UPDATE tag_suggestions
                         SET status = '{}', updated_at = ?1
                         WHERE id IN ({})",
                        STATUS_REJECTED, placeholders
                    ),
                    params_from_iter(
                        std::iter::once(Utc::now().timestamp().to_string())
                            .chain(action.suggestion_ids.iter().cloned()),
                    ),
                )?;
                result.rejected += pending.len();
            }
            "accept" => {
                let tag_ids = pending
                    .iter()
                    .map(|item| {
                        item.matched_tag_id.clone().ok_or_else(|| {
                            TagError::Conflict("accept requires matched tag ids".to_string())
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let doc_ids = pending
                    .iter()
                    .map(|item| item.doc_id.clone())
                    .collect::<Vec<_>>();
                let source = pending
                    .first()
                    .map(|item| item.source.clone())
                    .unwrap_or_else(|| "ai_batch".to_string());
                result.accepted += apply_document_tags(conn, &doc_ids, &tag_ids, &source)?;
                conn.execute(
                    &format!(
                        "UPDATE tag_suggestions
                         SET status = '{}', updated_at = ?1
                         WHERE id IN ({})",
                        STATUS_ACCEPTED, placeholders
                    ),
                    params_from_iter(
                        std::iter::once(Utc::now().timestamp().to_string())
                            .chain(action.suggestion_ids.iter().cloned()),
                    ),
                )?;
            }
            "map_to_existing_tag" => {
                let tag_id = action.tag_id.clone().ok_or_else(|| {
                    TagError::Conflict("map_to_existing_tag requires tag_id".to_string())
                })?;
                let doc_ids = pending
                    .iter()
                    .map(|item| item.doc_id.clone())
                    .collect::<Vec<_>>();
                let source = pending
                    .first()
                    .map(|item| item.source.clone())
                    .unwrap_or_else(|| "ai_batch".to_string());
                result.mapped_to_existing +=
                    apply_document_tags(conn, &doc_ids, &[tag_id.clone()], &source)?;
                conn.execute(
                    &format!(
                        "UPDATE tag_suggestions
                         SET status = '{}', matched_tag_id = ?1, updated_at = ?2
                         WHERE id IN ({})",
                        STATUS_ACCEPTED, placeholders
                    ),
                    params_from_iter(
                        std::iter::once(tag_id)
                            .chain(std::iter::once(Utc::now().timestamp().to_string()))
                            .chain(action.suggestion_ids.iter().cloned()),
                    ),
                )?;
            }
            "create_tag" => {
                let tag_name = action
                    .new_tag_name
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| pending[0].proposed_name.clone());
                let tag = ensure_tag(conn, &tag_name, true)?;
                let doc_ids = pending
                    .iter()
                    .map(|item| item.doc_id.clone())
                    .collect::<Vec<_>>();
                let source = pending
                    .first()
                    .map(|item| item.source.clone())
                    .unwrap_or_else(|| "ai_batch".to_string());
                result.created_tags += 1;
                result.accepted += apply_document_tags(conn, &doc_ids, &[tag.id.clone()], &source)?;
                conn.execute(
                    &format!(
                        "UPDATE tag_suggestions
                         SET status = '{}', matched_tag_id = ?1, updated_at = ?2
                         WHERE id IN ({})",
                        STATUS_ACCEPTED, placeholders
                    ),
                    params_from_iter(
                        std::iter::once(tag.id)
                            .chain(std::iter::once(Utc::now().timestamp().to_string()))
                            .chain(action.suggestion_ids.iter().cloned()),
                    ),
                )?;
            }
            other => {
                return Err(TagError::Conflict(format!(
                    "unsupported review action '{}'",
                    other
                )));
            }
        }
    }

    Ok(result)
}

pub fn rename_tag(conn: &Connection, tag_id: &str, new_name: &str) -> Result<TagRecord, TagError> {
    let mut tag = get_tag_core(conn, tag_id)?.ok_or(TagError::NotFound)?;
    let (name, normalized) = sanitize_tag_name(new_name)?;
    if normalized == tag.normalized_name {
        conn.execute(
            "UPDATE tags SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![tag_id, name, Utc::now().timestamp()],
        )?;
    } else {
        ensure_name_not_conflicting(conn, &normalized, Some(tag_id))?;
        conn.execute(
            "DELETE FROM tag_aliases WHERE tag_id = ?1 AND normalized_alias = ?2",
            params![tag_id, normalized],
        )?;
        conn.execute(
            "UPDATE tags SET name = ?2, normalized_name = ?3, updated_at = ?4 WHERE id = ?1",
            params![tag_id, name, normalized, Utc::now().timestamp()],
        )?;

        let (_, old_normalized) = sanitize_tag_name(&tag.name)?;
        if old_normalized != normalized {
            let _ = add_tag_alias(conn, tag_id, &tag.name);
        }
    }
    tag = get_tag_core(conn, tag_id)?.ok_or(TagError::NotFound)?;
    attach_tag_details(conn, &mut tag)?;
    Ok(tag)
}

pub fn add_tag_alias(conn: &Connection, tag_id: &str, alias: &str) -> Result<TagAlias, TagError> {
    let (alias, normalized_alias) = sanitize_tag_name(alias)?;
    let tag = get_tag_core(conn, tag_id)?.ok_or(TagError::NotFound)?;
    if tag.normalized_name == normalized_alias {
        return Err(TagError::Conflict(
            "alias matches canonical name".to_string(),
        ));
    }
    ensure_name_not_conflicting(conn, &normalized_alias, Some(tag_id))?;

    if let Some(existing) = conn
        .query_row(
            "SELECT id, tag_id, alias, normalized_alias, created_at, updated_at
             FROM tag_aliases
             WHERE tag_id = ?1 AND normalized_alias = ?2",
            params![tag_id, normalized_alias],
            |row| {
                Ok(TagAlias {
                    id: row.get(0)?,
                    tag_id: row.get(1)?,
                    alias: row.get(2)?,
                    normalized_alias: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()?
    {
        return Ok(existing);
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, tag_id, alias, normalized_alias, now, now],
    )?;

    conn.query_row(
        "SELECT id, tag_id, alias, normalized_alias, created_at, updated_at
         FROM tag_aliases
         WHERE id = ?1",
        params![id],
        |row| {
            Ok(TagAlias {
                id: row.get(0)?,
                tag_id: row.get(1)?,
                alias: row.get(2)?,
                normalized_alias: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(TagError::from)
}

pub fn remove_tag_alias(conn: &Connection, alias_id: &str) -> Result<(), TagError> {
    conn.execute("DELETE FROM tag_aliases WHERE id = ?1", params![alias_id])?;
    Ok(())
}

pub fn promote_temporary_tag(conn: &Connection, tag_id: &str) -> Result<TagRecord, TagError> {
    conn.execute(
        "UPDATE tags SET is_temporary = 0, updated_at = ?2 WHERE id = ?1",
        params![tag_id, Utc::now().timestamp()],
    )?;
    let mut tag = get_tag_core(conn, tag_id)?.ok_or(TagError::NotFound)?;
    attach_tag_details(conn, &mut tag)?;
    Ok(tag)
}

pub fn merge_tags(
    conn: &Connection,
    source_tag_id: &str,
    target_tag_id: &str,
) -> Result<TagRecord, TagError> {
    if source_tag_id == target_tag_id {
        return Err(TagError::Conflict(
            "source and target tags are identical".to_string(),
        ));
    }
    let source = get_tag_core(conn, source_tag_id)?.ok_or(TagError::NotFound)?;
    let mut target = get_tag_core(conn, target_tag_id)?.ok_or(TagError::NotFound)?;

    conn.execute(
        "INSERT OR IGNORE INTO document_tags (doc_id, tag_id, source, applied_at)
         SELECT doc_id, ?2, source, applied_at
         FROM document_tags
         WHERE tag_id = ?1",
        params![source_tag_id, target_tag_id],
    )?;
    conn.execute(
        "DELETE FROM document_tags WHERE tag_id = ?1",
        params![source_tag_id],
    )?;

    let aliases = load_aliases_by_tag_ids(conn, &[source_tag_id.to_string()])?
        .remove(source_tag_id)
        .unwrap_or_default();
    for alias in aliases {
        if alias.normalized_alias != target.normalized_name {
            let _ = add_tag_alias(conn, target_tag_id, &alias.alias);
        }
    }
    if source.normalized_name != target.normalized_name {
        let _ = add_tag_alias(conn, target_tag_id, &source.name);
    }

    conn.execute(
        "UPDATE tag_suggestions
         SET matched_tag_id = ?2, updated_at = ?3
         WHERE matched_tag_id = ?1",
        params![source_tag_id, target_tag_id, Utc::now().timestamp()],
    )?;
    conn.execute(
        "DELETE FROM tag_aliases WHERE tag_id = ?1",
        params![source_tag_id],
    )?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![source_tag_id])?;

    target = get_tag_core(conn, target_tag_id)?.ok_or(TagError::NotFound)?;
    attach_tag_details(conn, &mut target)?;
    Ok(target)
}

pub fn cleanup_unused_tags(conn: &Connection) -> Result<usize, TagError> {
    let mut stmt = conn.prepare(
        "SELECT t.id
         FROM tags t
         LEFT JOIN document_tags dt ON dt.tag_id = t.id
         LEFT JOIN tag_suggestions ts ON ts.matched_tag_id = t.id AND ts.status = 'pending'
         GROUP BY t.id
         HAVING COUNT(DISTINCT dt.doc_id) = 0 AND COUNT(DISTINCT ts.id) = 0",
    )?;
    let tag_ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    for tag_id in &tag_ids {
        conn.execute("DELETE FROM tag_aliases WHERE tag_id = ?1", params![tag_id])?;
    }
    let mut deleted = 0;
    for tag_id in &tag_ids {
        deleted += conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])?;
    }
    Ok(deleted)
}

pub fn get_related_documents_by_tags(
    conn: &Connection,
    doc_id: &str,
    limit: usize,
) -> Result<Vec<RelatedDocument>, TagError> {
    let limit = limit.max(1);
    let mut stmt = conn.prepare(
        "SELECT
            d.id,
            d.title,
            d.file_type,
            d.updated_at,
            COUNT(DISTINCT dt2.tag_id) AS shared_count
         FROM document_tags dt1
         JOIN document_tags dt2 ON dt2.tag_id = dt1.tag_id AND dt2.doc_id != dt1.doc_id
         JOIN documents d ON d.id = dt2.doc_id
         WHERE dt1.doc_id = ?1
         GROUP BY d.id
         ORDER BY shared_count DESC, d.updated_at DESC
         LIMIT ?2",
    )?;

    let base_docs = stmt
        .query_map(params![doc_id, limit as i64], |row| {
            Ok(RelatedDocument {
                doc_id: row.get(0)?,
                title: row.get(1)?,
                file_type: row.get(2)?,
                updated_at: row.get(3)?,
                shared_tag_count: row.get::<_, i64>(4)?.max(0) as usize,
                shared_tags: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if base_docs.is_empty() {
        return Ok(base_docs);
    }

    let related_ids = base_docs
        .iter()
        .map(|doc| doc.doc_id.clone())
        .collect::<Vec<_>>();
    let placeholders = related_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT dt2.doc_id, t.name
         FROM document_tags dt1
         JOIN document_tags dt2 ON dt2.tag_id = dt1.tag_id AND dt2.doc_id != dt1.doc_id
         JOIN tags t ON t.id = dt2.tag_id
         WHERE dt1.doc_id = ? AND dt2.doc_id IN ({})
         ORDER BY t.name COLLATE NOCASE ASC",
        placeholders
    );
    let mut tag_stmt = conn.prepare(&sql)?;
    let mut param_values = vec![doc_id.to_string()];
    param_values.extend(related_ids.iter().cloned());
    let tag_rows = tag_stmt.query_map(params_from_iter(param_values.iter()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut shared_map: HashMap<String, Vec<String>> = HashMap::new();
    for row in tag_rows {
        let (related_doc_id, tag_name) = row?;
        shared_map.entry(related_doc_id).or_default().push(tag_name);
    }

    let mut docs = base_docs;
    for doc in &mut docs {
        doc.shared_tags = shared_map.remove(&doc.doc_id).unwrap_or_default();
    }
    Ok(docs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_tables, insert_document};
    use crate::models::NewDocument;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    fn insert_doc(conn: &Connection, title: &str, path: &str) -> String {
        insert_document(
            conn,
            NewDocument {
                title: title.to_string(),
                author: None,
                language: None,
                file_path: path.to_string(),
                file_type: "markdown".to_string(),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn normalize_and_alias_conflicts_are_global() {
        let conn = setup_conn();
        let tag = ensure_tag(&conn, "Rust", false).unwrap();
        add_tag_alias(&conn, &tag.id, "systems").unwrap();
        assert!(ensure_tag(&conn, " systems ", false).is_ok());
        let other = ensure_tag(&conn, "Python", false).unwrap();
        let err = add_tag_alias(&conn, &other.id, "rust").unwrap_err();
        assert!(err.to_string().contains("canonical"));
    }

    #[test]
    fn rename_preserves_old_name_as_alias() {
        let conn = setup_conn();
        let tag = ensure_tag(&conn, "LLM", false).unwrap();
        let renamed = rename_tag(&conn, &tag.id, "Large Language Model").unwrap();
        assert_eq!(renamed.name, "Large Language Model");
        let resolved = resolve_tag_by_name(&conn, "llm").unwrap().unwrap();
        assert_eq!(resolved.id, tag.id);
    }

    #[test]
    fn merge_deduplicates_document_tag_assignments() {
        let conn = setup_conn();
        let doc_id = insert_doc(&conn, "Doc A", "/tmp/doc-a.md");
        let source = ensure_tag(&conn, "AI", false).unwrap();
        let target = ensure_tag(&conn, "Machine Learning", false).unwrap();
        apply_document_tags(&conn, &[doc_id.clone()], &[source.id.clone()], "manual").unwrap();
        apply_document_tags(&conn, &[doc_id.clone()], &[target.id.clone()], "manual").unwrap();
        merge_tags(&conn, &source.id, &target.id).unwrap();
        let assignments = list_document_tags(&conn, Some(&doc_id)).unwrap();
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].tag_id, target.id);
    }

    #[test]
    fn cleanup_skips_tags_with_pending_suggestions() {
        let conn = setup_conn();
        let doc_id = insert_doc(&conn, "Doc B", "/tmp/doc-b.md");
        let tag = ensure_tag(&conn, "Temporary", true).unwrap();
        insert_tag_suggestion(
            &conn,
            NewTagSuggestion {
                doc_id,
                proposed_name: "Temporary".to_string(),
                source: "ai_batch".to_string(),
                matched_tag_id: Some(tag.id.clone()),
                reason: None,
                confidence: Some(0.6),
            },
        )
        .unwrap();
        let deleted = cleanup_unused_tags(&conn).unwrap();
        assert_eq!(deleted, 0);
    }

    #[test]
    fn related_documents_are_sorted_and_exclude_current() {
        let conn = setup_conn();
        let current = insert_doc(&conn, "Current", "/tmp/current.md");
        let related_a = insert_doc(&conn, "A", "/tmp/a.md");
        let related_b = insert_doc(&conn, "B", "/tmp/b.md");
        let tag_ai = ensure_tag(&conn, "AI", false).unwrap();
        let tag_rust = ensure_tag(&conn, "Rust", false).unwrap();

        apply_document_tags(
            &conn,
            &[current.clone()],
            &[tag_ai.id.clone(), tag_rust.id.clone()],
            "manual",
        )
        .unwrap();
        apply_document_tags(
            &conn,
            &[related_a.clone()],
            &[tag_ai.id.clone(), tag_rust.id.clone()],
            "manual",
        )
        .unwrap();
        apply_document_tags(&conn, &[related_b.clone()], &[tag_ai.id.clone()], "manual").unwrap();

        let related = get_related_documents_by_tags(&conn, &current, 10).unwrap();
        assert_eq!(related.len(), 2);
        assert_eq!(related[0].doc_id, related_a);
        assert_eq!(related[0].shared_tag_count, 2);
        assert_eq!(related[1].doc_id, related_b);
        assert!(related.iter().all(|item| item.doc_id != current));
    }
}
