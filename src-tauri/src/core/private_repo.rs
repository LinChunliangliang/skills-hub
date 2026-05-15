use anyhow::{Context, Result};
use base64::Engine as _;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

use super::content_hash::hash_dir;
use super::installer::install_local_skill;
use super::skill_store::{SkillRecord, SkillStore, SkillTargetRecord};
use super::sync_engine::{copy_dir_recursive, sync_dir_copy_with_overwrite};
use super::tool_adapters::{adapter_by_key, is_tool_installed};

const SETTING_URL: &str = "private_source_url";
const SETTING_TOKEN: &str = "private_source_token";
const SETTING_REPO: &str = "private_source_repo";
const SETTING_PATH: &str = "private_source_skills_path";
const SHA_PREFIX: &str = "private_sha:";
const SKILL_ID_PREFIX: &str = "private_skill_id:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateSourceConfig {
    pub url: String,
    pub token: String,
    pub repo: String,
    pub skills_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrivateSkillDto {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
    pub sha: String,
    /// "not_installed" | "installed" | "update_available"
    pub install_status: String,
    pub skill_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportSkillResult {
    pub name: String,
    pub skill_id: String,
}

#[derive(Debug, Deserialize)]
struct GogsFileContent {
    content: String,
}

#[derive(Deserialize)]
struct GogsUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GogsEntry {
    #[serde(rename = "type")]
    kind: String,
    name: String,
    path: String,
    sha: String,
    size: u64,
}

// ── Config persistence ────────────────────────────────────────────────────────

pub fn load_config(store: &SkillStore) -> Result<Option<PrivateSourceConfig>> {
    let url = store.get_setting(SETTING_URL)?;
    let token = store.get_setting(SETTING_TOKEN)?;
    let repo = store.get_setting(SETTING_REPO)?;
    let path = store.get_setting(SETTING_PATH)?;
    match (url, token, repo, path) {
        (Some(u), Some(t), Some(r), Some(p)) if !u.is_empty() => {
            Ok(Some(PrivateSourceConfig { url: u, token: t, repo: r, skills_path: p }))
        }
        _ => Ok(None),
    }
}

pub fn save_config(store: &SkillStore, cfg: &PrivateSourceConfig) -> Result<()> {
    store.set_setting(SETTING_URL, &cfg.url)?;
    store.set_setting(SETTING_TOKEN, &cfg.token)?;
    store.set_setting(SETTING_REPO, &cfg.repo)?;
    store.set_setting(SETTING_PATH, &cfg.skills_path)?;
    Ok(())
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

fn make_client(token: &str) -> Result<Client> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "Authorization",
        format!("token {}", token).parse().context("invalid token header value")?,
    );
    Client::builder()
        .user_agent("Mozilla/5.0 (compatible; skills-hub)")
        .default_headers(headers)
        .build()
        .context("build http client")
}

pub fn test_connection(cfg: &PrivateSourceConfig) -> Result<String> {
    let client = make_client(&cfg.token)?;
    let base = cfg.url.trim_end_matches('/');
    let url = format!("{}/api/v1/user", base);
    let resp = client
        .get(&url)
        .send()
        .context("connection failed")?
        .error_for_status()
        .context("server returned error status")?;
    let user: GogsUser = resp.json().context("parse user response")?;
    Ok(user.login)
}

// ── Directory scan ────────────────────────────────────────────────────────────

fn list_dir(client: &Client, base: &str, repo: &str, path: &str) -> Result<Vec<GogsEntry>> {
    let url = if path.is_empty() {
        format!("{}/api/v1/repos/{}/contents", base, repo)
    } else {
        format!("{}/api/v1/repos/{}/contents/{}", base, repo, path)
    };
    let resp = client
        .get(&url)
        .send()
        .context("list directory request failed")?
        .error_for_status()
        .context("list directory: server error")?;
    resp.json::<Vec<GogsEntry>>().context("parse directory listing")
}

fn collect_md_files(client: &Client, base: &str, repo: &str) -> Vec<(String, String)> {
    let mut queue: Vec<String> = vec![String::new()]; // start at repo root
    let mut visited = std::collections::HashSet::new();
    let mut result = Vec::new();
    while let Some(dir_path) = queue.pop() {
        if !visited.insert(dir_path.clone()) {
            continue; // skip symlink cycles
        }
        let entries = match list_dir(client, base, repo, &dir_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries {
            if entry.kind == "file" && entry.name.ends_with(".md") && entry.size > 0 {
                result.push((entry.path, entry.sha));
            } else if entry.kind == "dir" && !visited.contains(&entry.path) {
                queue.push(entry.path);
            }
        }
    }
    result
}

fn fetch_file_content(client: &Client, base: &str, repo: &str, path: &str) -> Result<String> {
    let url = format!("{}/api/v1/repos/{}/contents/{}", base, repo, path);
    let resp = client
        .get(&url)
        .send()
        .context("fetch file request failed")?
        .error_for_status()
        .context("fetch file: server error")?;
    let file: GogsFileContent = resp.json().context("parse file content response")?;
    let raw = file.content.replace('\n', "");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.as_bytes())
        .context("base64 decode failed")?;
    String::from_utf8(bytes).context("utf-8 decode failed")
}

// ── Frontmatter parsing ───────────────────────────────────────────────────────

fn parse_frontmatter(content: &str) -> Option<(String, Option<String>)> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") {
        return None;
    }
    let mut name: Option<String> = None;
    let mut desc: Option<String> = None;
    let mut i = 1usize;
    let mut found_end = false;
    while i < lines.len() {
        let l = lines[i].trim();
        if l == "---" {
            found_end = true;
            break;
        }
        if let Some(v) = l.strip_prefix("name:") {
            let v = v.trim().trim_matches('"').trim_matches('\'');
            if !v.is_empty() {
                name = Some(v.to_string());
            }
        } else if let Some(v) = l.strip_prefix("description:") {
            let v = v.trim();
            if !v.is_empty() && v != "|" && v != ">" {
                desc = Some(v.trim_matches('"').trim_matches('\'').to_string());
            }
        }
        i += 1;
    }
    if !found_end {
        return None;
    }
    name.map(|n| (n, desc))
}

// ── Settings keys ─────────────────────────────────────────────────────────────

fn sha_key(repo: &str, path: &str) -> String {
    format!("{}{}/{}", SHA_PREFIX, repo, path)
}

fn skill_id_key(repo: &str, path: &str) -> String {
    format!("{}{}/{}", SKILL_ID_PREFIX, repo, path)
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn list_skills(store: &SkillStore, cfg: &PrivateSourceConfig) -> Result<Vec<PrivateSkillDto>> {
    let client = make_client(&cfg.token)?;
    let base = cfg.url.trim_end_matches('/');

    let raw_files = collect_md_files(&client, base, &cfg.repo);

    let mut result = Vec::new();
    for (path, sha) in raw_files {
        let content = match fetch_file_content(&client, base, &cfg.repo, &path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let (name, description) = match parse_frontmatter(&content) {
            Some(pair) => pair,
            None => continue,
        };

        let stored_sha = store.get_setting(&sha_key(&cfg.repo, &path)).unwrap_or(None);
        let stored_skill_id =
            store.get_setting(&skill_id_key(&cfg.repo, &path)).unwrap_or(None);

        let install_status = match &stored_sha {
            None => "not_installed".to_string(),
            Some(prev) if prev == &sha => "installed".to_string(),
            _ => "update_available".to_string(),
        };

        result.push(PrivateSkillDto {
            name,
            description,
            path,
            sha,
            install_status,
            skill_id: stored_skill_id,
        });
    }
    Ok(result)
}

pub fn import_skill<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    store: &SkillStore,
    cfg: &PrivateSourceConfig,
    path: &str,
    sha: &str,
) -> Result<ImportSkillResult> {
    let client = make_client(&cfg.token)?;
    let base = cfg.url.trim_end_matches('/');
    let content = fetch_file_content(&client, base, &cfg.repo, path)?;
    let (name, _) = parse_frontmatter(&content)
        .ok_or_else(|| anyhow::anyhow!("file has no valid SKILL frontmatter"))?;

    // Create a temp directory with SKILL.md inside for the installer.
    let tmp_dir = std::env::temp_dir().join(format!("skills-hub-private-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&tmp_dir).context("create temp dir")?;
    let skill_md = tmp_dir.join("SKILL.md");
    std::fs::write(&skill_md, content.as_bytes()).context("write SKILL.md")?;

    let result = install_local_skill(app, store, &tmp_dir, Some(name.clone()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    let install = result.context("install skill from private repo")?;

    // Record SHA and skill_id for future update detection.
    store.set_setting(&sha_key(&cfg.repo, path), sha)?;
    store.set_setting(&skill_id_key(&cfg.repo, path), &install.skill_id)?;

    Ok(ImportSkillResult { name, skill_id: install.skill_id })
}

pub fn update_skill<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    store: &SkillStore,
    cfg: &PrivateSourceConfig,
    path: &str,
    sha: &str,
) -> Result<ImportSkillResult> {
    let _ = app; // needed for install_local_skill signature compatibility
    let skill_id = store
        .get_setting(&skill_id_key(&cfg.repo, path))?
        .ok_or_else(|| anyhow::anyhow!("skill not tracked — import it first"))?;

    let record = store
        .get_skill_by_id(&skill_id)?
        .ok_or_else(|| anyhow::anyhow!("skill record not found in database"))?;

    let central_path = PathBuf::from(&record.central_path);
    if !central_path.exists() {
        anyhow::bail!("central path missing: {:?}", central_path);
    }

    let client = make_client(&cfg.token)?;
    let base = cfg.url.trim_end_matches('/');
    let content = fetch_file_content(&client, base, &cfg.repo, path)?;
    let (name, description) = parse_frontmatter(&content)
        .ok_or_else(|| anyhow::anyhow!("file has no valid SKILL frontmatter"))?;

    // Write to a staging directory then swap (same pattern as installer update).
    let parent = central_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("invalid central path"))?;
    let staging = parent.join(format!(".skills-hub-private-update-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&staging).context("create staging dir")?;
    std::fs::write(staging.join("SKILL.md"), content.as_bytes()).context("write staging SKILL.md")?;

    std::fs::remove_dir_all(&central_path)
        .with_context(|| format!("remove old central dir {:?}", central_path))?;
    if let Err(err) = std::fs::rename(&staging, &central_path) {
        copy_dir_recursive(&staging, &central_path)
            .with_context(|| format!("fallback copy {:?} -> {:?}", staging, central_path))?;
        let _ = std::fs::remove_dir_all(&staging);
        log::warn!("[private_repo] rename fallback: {}", err);
    }

    let content_hash = hash_dir(&central_path).ok();
    let now = now_ms();
    let updated_record = SkillRecord {
        id: record.id.clone(),
        name: name.clone(),
        description: description.or(record.description),
        source_type: record.source_type.clone(),
        source_ref: record.source_ref.clone(),
        source_subpath: record.source_subpath.clone(),
        source_revision: record.source_revision.clone(),
        central_path: record.central_path.clone(),
        content_hash: content_hash.clone(),
        created_at: record.created_at,
        updated_at: now,
        last_sync_at: record.last_sync_at,
        last_seen_at: now,
        status: "ok".to_string(),
    };
    store.upsert_skill(&updated_record)?;

    // Re-sync copy-mode targets (symlinks update automatically).
    let targets = store.list_skill_targets(&skill_id)?;
    for t in targets {
        if t.scope == "global" {
            if let Some(adapter) = adapter_by_key(&t.tool) {
                if !is_tool_installed(&adapter).unwrap_or(false) {
                    continue;
                }
            }
        }
        if t.mode == "copy" || t.tool == "cursor" {
            let target_path = PathBuf::from(&t.target_path);
            if let Ok(sync_res) = sync_dir_copy_with_overwrite(&central_path, &target_path, true) {
                let _ = store.upsert_skill_target(&SkillTargetRecord {
                    id: t.id.clone(),
                    skill_id: t.skill_id.clone(),
                    tool: t.tool.clone(),
                    scope: t.scope.clone(),
                    project_path: t.project_path.clone(),
                    target_path: sync_res.target_path.to_string_lossy().to_string(),
                    mode: "copy".to_string(),
                    status: "ok".to_string(),
                    last_error: None,
                    synced_at: Some(now),
                });
            }
        }
    }

    // Update stored SHA.
    store.set_setting(&sha_key(&cfg.repo, path), sha)?;

    Ok(ImportSkillResult { name, skill_id })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
