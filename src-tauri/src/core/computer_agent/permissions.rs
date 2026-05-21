use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use jan_utils::normalize_path;

const WORKSPACE_DIR: &str = "agent-workspaces";
const HIDDEN_THREAD_ID_ARG: &str = "_mitaThreadId";

#[derive(Debug, Clone)]
pub struct ComputerAgentScope {
    pub workspace_root: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
}

impl ComputerAgentScope {
    pub fn new(
        mita_data_folder: &Path,
        thread_id: &str,
        configured_roots: &[String],
    ) -> Result<Self, String> {
        let thread_id = sanitize_thread_id(thread_id)?;
        let raw_workspace_root = mita_data_folder.join(WORKSPACE_DIR).join(&thread_id);
        let workspace_root = normalize_scope_path(
            canonicalize_existing_or_parent(&raw_workspace_root).unwrap_or(raw_workspace_root),
        );

        let mut allowed_roots = vec![workspace_root.clone()];
        for root in configured_roots {
            let trimmed = root.trim();
            if trimmed.is_empty() {
                continue;
            }
            let path = PathBuf::from(trimmed);
            if !path.exists() {
                log::warn!("Skipping computer-agent allowed root that does not exist: {trimmed}");
                continue;
            }
            let canonical = normalize_scope_path(path.canonicalize().map_err(|e| {
                format!("Failed to resolve allowed root '{}': {}", path.display(), e)
            })?);
            if !allowed_roots.iter().any(|root| root == &canonical) {
                allowed_roots.push(canonical);
            }
        }

        Ok(Self {
            workspace_root,
            allowed_roots,
        })
    }

    pub fn ensure_workspace(&self) -> Result<(), String> {
        fs::create_dir_all(&self.workspace_root)
            .map_err(|e| format!("Failed to create agent workspace: {e}"))
    }

    pub fn resolve_existing(&self, input: Option<&str>) -> Result<PathBuf, String> {
        let candidate = self.resolve_candidate(input.unwrap_or(""));
        let canonical = normalize_scope_path(candidate.canonicalize().map_err(|e| {
            format!(
                "Path '{}' must exist and be accessible: {}",
                candidate.display(),
                e
            )
        })?);
        self.ensure_allowed(&canonical)?;
        Ok(canonical)
    }

    pub fn resolve_directory_for_create(&self, input: Option<&str>) -> Result<PathBuf, String> {
        self.ensure_workspace()?;
        let candidate = self.resolve_candidate(input.unwrap_or(""));

        let existing_or_parent = if candidate.exists() {
            candidate.clone()
        } else {
            candidate
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| self.workspace_root.clone())
        };

        let canonical_scope = canonicalize_existing_or_parent(&existing_or_parent)?;
        self.ensure_allowed(&canonical_scope)?;

        Ok(normalize_path(&candidate))
    }

    pub fn resolve_new_path(&self, input: &str) -> Result<PathBuf, String> {
        if input.trim().is_empty() {
            return Err("Path is required".to_string());
        }
        self.ensure_workspace()?;
        let candidate = self.resolve_candidate(input);
        let parent = candidate
            .parent()
            .ok_or_else(|| format!("Path '{}' has no parent", candidate.display()))?;
        let canonical_parent = canonicalize_existing_or_parent(parent)?;
        self.ensure_allowed(&canonical_parent)?;
        Ok(normalize_path(&candidate))
    }

    pub fn resolve_existing_directory(&self, input: Option<&str>) -> Result<PathBuf, String> {
        let path = self.resolve_existing(input)?;
        if !path.is_dir() {
            return Err(format!("Path '{}' is not a directory", path.display()));
        }
        Ok(path)
    }

    pub fn ensure_allowed(&self, path: &Path) -> Result<(), String> {
        let normalized = normalize_scope_path(path.to_path_buf());
        if self
            .allowed_roots
            .iter()
            .any(|root| is_within_root(&normalized, root))
        {
            return Ok(());
        }

        Err(format!(
            "Path '{}' is outside the approved Computer Agent roots",
            normalized.display()
        ))
    }

    fn resolve_candidate(&self, input: &str) -> PathBuf {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return self.workspace_root.clone();
        }
        let candidate = PathBuf::from(trimmed);
        if candidate.is_absolute() {
            normalize_path(&candidate)
        } else {
            normalize_path(&self.workspace_root.join(candidate))
        }
    }
}

pub fn is_within_root(path: &Path, root: &Path) -> bool {
    let path = normalize_scope_path(path.to_path_buf());
    let root = normalize_scope_path(root.to_path_buf());

    #[cfg(windows)]
    {
        let path = path
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        let root = root
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        return path == root
            || path
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('\\'));
    }

    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

pub fn hidden_thread_id_arg() -> &'static str {
    HIDDEN_THREAD_ID_ARG
}

pub fn sanitize_file_stem(input: &str) -> String {
    let mut out = String::new();
    let mut last_was_sep = false;

    for ch in input.trim().chars() {
        let keep = ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' ');
        let next = if keep { ch } else { '-' };

        if next == '-' || next == '_' || next == ' ' || next == '.' {
            if last_was_sep {
                continue;
            }
            last_was_sep = true;
        } else {
            last_was_sep = false;
        }

        out.push(next);
    }

    let stem = out
        .trim_matches(|ch: char| ch == '-' || ch == '_' || ch == '.' || ch == ' ')
        .replace(' ', "-");

    if stem.is_empty() {
        "mita-note".to_string()
    } else {
        stem.chars().take(80).collect()
    }
}

pub fn unique_txt_path(directory: &Path, suggested_name: &str) -> PathBuf {
    let stem = sanitize_file_stem(suggested_name);
    let mut candidate = directory.join(format!("{stem}.txt"));
    if !candidate.exists() {
        return candidate;
    }

    for i in 2..=999 {
        candidate = directory.join(format!("{stem}-{i}.txt"));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!(
        "{stem}-{}.txt",
        chrono::Utc::now().timestamp_millis()
    ))
}

fn sanitize_thread_id(thread_id: &str) -> Result<String, String> {
    let cleaned: String = thread_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .collect();

    if cleaned.is_empty() {
        Err("Computer tool call is missing a valid thread id".to_string())
    } else {
        Ok(cleaned)
    }
}

fn canonicalize_existing_or_parent(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map(normalize_scope_path)
            .map_err(|e| format!("Failed to resolve '{}': {}", path.display(), e));
    }

    let mut current = normalize_path(path);
    let mut suffix = PathBuf::new();

    while !current.exists() {
        let Some(name) = current.file_name().map(|name| name.to_os_string()) else {
            break;
        };
        suffix = PathBuf::from(name).join(suffix);
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent.to_path_buf();
    }

    if !current.exists() {
        return Err(format!("No existing parent found for '{}'", path.display()));
    }

    let canonical = current
        .canonicalize()
        .map_err(|e| format!("Failed to resolve '{}': {}", current.display(), e))?;
    Ok(normalize_scope_path(canonical.join(suffix)))
}

fn normalize_scope_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let path_str = path.to_string_lossy();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return normalize_path(Path::new(stripped));
        }
    }

    let normalized = normalize_path(&path);
    normalize_components(&normalized)
}

fn normalize_components(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}
