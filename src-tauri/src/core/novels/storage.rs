use super::models::{
    CreateNovelProjectRequest, ManuscriptUnit, NovelBundle, NovelExportRequest, NovelExportResult,
    NovelImportRequest, NovelJournalEntry, NovelProject, NovelProjectSummary, NovelResult,
    NovelRevisionSummary, NovelStorageError, RestoreNovelRevisionRequest,
    SaveManuscriptUnitRequest, SaveNovelProjectRequest, SaveNovelResourceRequest,
    SaveNovelSuggestionsRequest, VersionedCollection, NOVEL_SCHEMA_VERSION,
};
use chrono::Utc;
use fs2::FileExt;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[cfg(test)]
use std::io::Read;

pub const NOVELS_DIR: &str = "novels";
const MANIFEST_FILE: &str = "manifest.json";
const MANUSCRIPT_DIR: &str = "manuscript";
const SUGGESTIONS_DIR: &str = "suggestions";
const REVISIONS_DIR: &str = "revisions";
const ASSETS_DIR: &str = "assets";
const JOURNAL_FILE: &str = "journal.jsonl";
const LOCKS_DIR: &str = ".locks";
const RESOURCE_FILES: &[(&str, &str)] = &[
    ("characters", "characters.json"),
    ("relationships", "relationships.json"),
    ("outline", "outline.json"),
    ("clues", "clues.json"),
    ("comments", "comments.json"),
];

struct ProjectLock(File);

impl Drop for ProjectLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

fn storage_error(code: &str, context: &str, error: impl std::fmt::Display) -> NovelStorageError {
    NovelStorageError::new(code, format!("{context}: {error}"))
}

fn count_document_words(value: &Value) -> u64 {
    let text = document_text(value);
    let mut count = 0_u64;
    let mut in_latin_or_number = false;
    for character in text.chars() {
        if ('\u{4e00}'..='\u{9fff}').contains(&character)
            || ('\u{3400}'..='\u{4dbf}').contains(&character)
        {
            count = count.saturating_add(1);
            in_latin_or_number = false;
        } else if character.is_alphanumeric() {
            if !in_latin_or_number {
                count = count.saturating_add(1);
                in_latin_or_number = true;
            }
        } else {
            in_latin_or_number = false;
        }
    }
    count
}

pub fn validate_id(kind: &str, id: &str) -> NovelResult<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(NovelStorageError::new(
            "invalid_data",
            format!("Invalid {kind} id"),
        ));
    }
    Ok(())
}

fn novels_root(data_folder: &Path) -> PathBuf {
    data_folder.join(NOVELS_DIR)
}

fn project_root(data_folder: &Path, novel_id: &str) -> NovelResult<PathBuf> {
    validate_id("novel", novel_id)?;
    Ok(novels_root(data_folder).join(novel_id))
}

fn unit_path(project: &Path, unit_id: &str) -> NovelResult<PathBuf> {
    validate_id("manuscript unit", unit_id)?;
    Ok(project.join(MANUSCRIPT_DIR).join(format!("{unit_id}.json")))
}

fn suggestion_path(project: &Path, unit_id: &str) -> NovelResult<PathBuf> {
    validate_id("manuscript unit", unit_id)?;
    Ok(project
        .join(SUGGESTIONS_DIR)
        .join(format!("{unit_id}.json")))
}

fn revision_dir(project: &Path, unit_id: &str) -> NovelResult<PathBuf> {
    validate_id("manuscript unit", unit_id)?;
    Ok(project.join(REVISIONS_DIR).join(unit_id))
}

fn resource_path(project: &Path, resource: &str) -> NovelResult<PathBuf> {
    let file = RESOURCE_FILES
        .iter()
        .find_map(|(name, file)| (*name == resource).then_some(*file))
        .ok_or_else(|| NovelStorageError::new("invalid_data", "Unknown novel resource"))?;
    Ok(project.join(file))
}

fn acquire_project_lock(project: &Path) -> NovelResult<ProjectLock> {
    let novel_id = project
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| NovelStorageError::new("invalid_data", "Novel project has no valid id"))?;
    validate_id("novel", novel_id)?;
    let lock_directory = project
        .parent()
        .ok_or_else(|| NovelStorageError::new("invalid_data", "Novel project has no parent"))?
        .join(LOCKS_DIR);
    fs::create_dir_all(&lock_directory)
        .map_err(|error| storage_error("io_error", "create novel lock directory", error))?;
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_directory.join(format!("{novel_id}.lock")))
        .map_err(|error| storage_error("io_error", "open project lock", error))?;
    file.lock_exclusive()
        .map_err(|error| storage_error("storage_error", "lock project", error))?;
    Ok(ProjectLock(file))
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> NovelResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(storage_error(
            "storage_error",
            "replace destination",
            std::io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> NovelResult<()> {
    fs::rename(source, destination)
        .map_err(|error| storage_error("storage_error", "replace destination", error))
}

fn atomic_write(path: &Path, contents: &[u8]) -> NovelResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| NovelStorageError::new("invalid_data", "File has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| storage_error("io_error", "create parent directory", error))?;
    let tmp = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("novel"),
        std::process::id(),
        Uuid::new_v4()
    ));

    let result = (|| {
        let mut file = File::create(&tmp)
            .map_err(|error| storage_error("io_error", "create temporary file", error))?;
        file.write_all(contents)
            .map_err(|error| storage_error("io_error", "write temporary file", error))?;
        file.sync_all()
            .map_err(|error| storage_error("io_error", "sync temporary file", error))?;
        drop(file);
        atomic_replace(&tmp, path)?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| storage_error("io_error", "sync parent directory", error))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> NovelResult<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    atomic_write(path, &bytes)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> NovelResult<T> {
    let bytes = fs::read(path)
        .map_err(|error| storage_error("io_error", &format!("read {}", path.display()), error))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| storage_error("invalid_json", &format!("parse {}", path.display()), error))
}

fn append_journal(project: &Path, entry: &NovelJournalEntry) -> NovelResult<()> {
    let path = project.join(JOURNAL_FILE);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| storage_error("io_error", "open novel journal", error))?;
    let data = serde_json::to_string(entry)?;
    writeln!(file, "{data}")
        .map_err(|error| storage_error("io_error", "append novel journal", error))?;
    file.sync_all()
        .map_err(|error| storage_error("io_error", "sync novel journal", error))
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn require_project(project: &Path) -> NovelResult<()> {
    if !project.join(MANIFEST_FILE).is_file() {
        return Err(NovelStorageError::new(
            "not_found",
            "Novel project not found",
        ));
    }
    Ok(())
}

fn default_resource(_resource: &str, updated_at: String) -> VersionedCollection {
    VersionedCollection::empty(Vec::new(), updated_at)
}

fn ensure_project_layout(project: &Path, updated_at: &str) -> NovelResult<()> {
    for directory in [MANUSCRIPT_DIR, SUGGESTIONS_DIR, REVISIONS_DIR, ASSETS_DIR] {
        fs::create_dir_all(project.join(directory))
            .map_err(|error| storage_error("io_error", "create novel directory", error))?;
    }
    for (resource, _) in RESOURCE_FILES {
        let path = resource_path(project, resource)?;
        if !path.exists() {
            write_json(&path, &default_resource(resource, updated_at.to_string()))?;
        }
    }
    if !project.join(JOURNAL_FILE).exists() {
        atomic_write(&project.join(JOURNAL_FILE), b"")?;
    }
    Ok(())
}

fn seed_cultivation_resources(project: &Path, updated_at: &str) -> NovelResult<()> {
    let collection = |items: Vec<Value>| VersionedCollection {
        schema_version: NOVEL_SCHEMA_VERSION,
        revision: 1,
        updated_at: updated_at.to_string(),
        items,
    };
    write_json(
        &resource_path(project, "characters")?,
        &collection(vec![
            json!({
                "id": "shen-yanqiu", "name": "沈砚秋", "role": "protagonist",
                "gender": "女", "age": "十九", "nationality": "云澜国",
                "ethnicity": "东陆人族", "appearance": "眉目清冷，常簪一枚旧银簪",
                "body": "身形修长", "personality": "克制、敏锐、护短",
                "biography": "药铺孤女，因照骨灵根卷入宗门旧案。",
                "customFields": {"境界": "炼气七层", "门派": "无", "代价": "每次照骨会遗失一段记忆"},
                "lockedFields": ["biography"], "createdAt": updated_at, "updatedAt": updated_at
            }),
            json!({
                "id": "lu-chengfeng", "name": "陆乘风", "role": "supporting",
                "gender": "男", "age": "二十三", "nationality": "云澜国",
                "ethnicity": "东陆人族", "appearance": "玄衣负剑，左眉有浅痕",
                "body": "挺拔", "personality": "寡言、守诺",
                "biography": "太虚剑宗弃徒，暗查师门失踪案。",
                "customFields": {"境界": "筑基初期", "门派": "太虚剑宗"},
                "lockedFields": [], "createdAt": updated_at, "updatedAt": updated_at
            }),
            json!({
                "id": "ning-wujiu", "name": "宁无咎", "role": "important_extra",
                "gender": "男", "age": "四十余", "nationality": "云澜国",
                "ethnicity": "东陆人族", "appearance": "温雅病容，腕缠赤线",
                "body": "清瘦", "personality": "温和而危险",
                "biography": "掌管问天楼，知道银簪真正来历。",
                "customFields": {"境界": "金丹中期", "身份": "问天楼主"},
                "lockedFields": ["biography"], "createdAt": updated_at, "updatedAt": updated_at
            }),
        ]),
    )?;
    write_json(
        &resource_path(project, "relationships")?,
        &collection(vec![
            json!({
                "id": "rel-shen-lu", "sourceCharacterId": "shen-yanqiu",
                "targetCharacterId": "lu-chengfeng", "direction": "bidirectional",
                "type": "试探中的同盟", "description": "因追查同一桩旧案结伴。",
                "strength": 62, "clueIds": ["clue-silver-hairpin"],
                "createdAt": updated_at, "updatedAt": updated_at
            }),
            json!({
                "id": "rel-ning-shen", "sourceCharacterId": "ning-wujiu",
                "targetCharacterId": "shen-yanqiu", "direction": "source_to_target",
                "type": "隐秘监视", "description": "宁无咎在等待她觉醒照骨灵根。",
                "strength": 81, "clueIds": ["clue-silver-hairpin"],
                "createdAt": updated_at, "updatedAt": updated_at
            }),
        ]),
    )?;
    write_json(
        &resource_path(project, "outline")?,
        &collection(vec![
            json!({
                "id": "outline-volume-1", "title": "卷一·照骨",
                "summary": "沈砚秋从银簪中窥见灭门残影，踏上查案之路。",
                "intent": "建立能力代价与主角的主动选择", "position": 0,
                "locked": false, "createdAt": updated_at, "updatedAt": updated_at
            }),
            json!({
                "id": "outline-hairpin-plant", "parentId": "outline-volume-1",
                "unitId": "chapter-3",
                "title": "第三章·旧银簪", "summary": "银簪对沈砚秋的血产生微弱回应。",
                "intent": "埋下身份与灭门案伏笔", "position": 3,
                "locked": true, "createdAt": updated_at, "updatedAt": updated_at
            }),
            json!({
                "id": "outline-hairpin-payoff", "title": "第七十章·簪中证词",
                "unitId": "chapter-70",
                "summary": "银簪保存的照骨残影成为反击宁无咎的关键证据。",
                "intent": "回收长线伏笔并反转旧案真相", "position": 70,
                "locked": true, "createdAt": updated_at, "updatedAt": updated_at
            }),
        ]),
    )?;
    write_json(
        &resource_path(project, "clues")?,
        &collection(vec![json!({
            "id": "clue-silver-hairpin", "title": "母亲留下的旧银簪",
            "description": "第三章看似普通的发簪，实际封存了一段照骨残影。",
            "plantedUnitId": "chapter-3", "plannedResolveUnitId": "chapter-70",
            "status": "planned", "relatedCharacterIds": ["shen-yanqiu", "ning-wujiu"],
            "notes": "第3章埋设，第70章作为反击敌人的证据回收。",
            "createdAt": updated_at, "updatedAt": updated_at
        })]),
    )
}

pub fn create_project(
    data_folder: &Path,
    request: CreateNovelProjectRequest,
) -> NovelResult<NovelBundle> {
    let seed_cultivation = request.template.as_deref() == Some("cultivation");
    let title = request.title.trim();
    if title.is_empty() {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Novel title cannot be empty",
        ));
    }
    let id = Uuid::new_v4().to_string();
    validate_id("novel", &id)?;
    if !matches!(request.kind.as_str(), "web_novel" | "novel" | "screenplay") {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Novel kind must be web_novel, novel, or screenplay",
        ));
    }
    let root = novels_root(data_folder);
    fs::create_dir_all(&root)
        .map_err(|error| storage_error("io_error", "create novels directory", error))?;
    let project = root.join(&id);
    let _lock = acquire_project_lock(&project)?;
    if project.join(MANIFEST_FILE).exists() {
        return Err(NovelStorageError::new(
            "novel_already_exists",
            "Novel project already exists",
        ));
    }
    let timestamp = now();
    ensure_project_layout(&project, &timestamp)?;
    if seed_cultivation {
        seed_cultivation_resources(&project, &timestamp)?;
    }
    let manifest = NovelProject {
        schema_version: NOVEL_SCHEMA_VERSION,
        id: id.clone(),
        title: title.to_string(),
        kind: request.kind,
        genre: request.genre.unwrap_or_default(),
        synopsis: request.synopsis.unwrap_or_default(),
        status: "draft".to_string(),
        active_unit_id: String::new(),
        unit_order: Vec::new(),
        revision: 1,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    write_json(&project.join(MANIFEST_FILE), &manifest)?;
    append_journal(
        &project,
        &NovelJournalEntry {
            operation: "createProject".to_string(),
            novel_id: id,
            unit_id: None,
            resource: Some("manifest".to_string()),
            revision: manifest.revision,
            occurred_at: timestamp.clone(),
        },
    )?;
    {
        let content = request
            .initial_content
            .unwrap_or_else(|| json!({"type": "doc", "content": [{"type": "paragraph"}]}));
        let unit_id = Uuid::new_v4().to_string();
        let unit = ManuscriptUnit {
            schema_version: NOVEL_SCHEMA_VERSION,
            id: unit_id.clone(),
            novel_id: manifest.id.clone(),
            parent_id: None,
            kind: if manifest.kind == "screenplay" {
                "scene".to_string()
            } else {
                "chapter".to_string()
            },
            title: if manifest.kind == "screenplay" {
                "场景 1".to_string()
            } else {
                "第一章".to_string()
            },
            position: 0,
            summary: String::new(),
            goal: String::new(),
            word_count: count_document_words(&content),
            content,
            revision: 0,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        };
        save_document_locked(&project, &manifest.id, unit, 0, "createInitialUnit", true)?;
    }
    if seed_cultivation {
        for (unit_id, title, position, summary, goal) in [
            (
                "chapter-3",
                "第三章 发簪入局",
                2,
                "沈砚秋把照骨簪带入宗门试炼，第一次看见长老的谎言。",
                "埋下簪尾缺口与旧案的长期伏笔。",
            ),
            (
                "chapter-70",
                "第七十章 簪照真骨",
                69,
                "簪尾缺口与旧案证词相合，沈砚秋借此反击掌门。",
                "回收第三章发簪伏笔并反转阵营关系。",
            ),
        ] {
            save_document_locked(
                &project,
                &manifest.id,
                ManuscriptUnit {
                    schema_version: NOVEL_SCHEMA_VERSION,
                    id: unit_id.to_string(),
                    novel_id: manifest.id.clone(),
                    parent_id: None,
                    kind: "chapter".to_string(),
                    title: title.to_string(),
                    position,
                    summary: summary.to_string(),
                    goal: goal.to_string(),
                    word_count: 0,
                    content: json!({"type": "doc", "content": [{"type": "paragraph"}]}),
                    revision: 0,
                    created_at: timestamp.clone(),
                    updated_at: timestamp.clone(),
                },
                0,
                "createTemplateUnit",
                false,
            )?;
        }
    }
    open_project(data_folder, &manifest.id)
}

pub fn list_projects(data_folder: &Path) -> NovelResult<Vec<NovelProjectSummary>> {
    let root = novels_root(data_folder);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut projects = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| storage_error("io_error", "scan novels directory", error))?
    {
        let entry = entry.map_err(|error| storage_error("io_error", "read novel entry", error))?;
        if !entry
            .file_type()
            .map_err(|error| storage_error("io_error", "inspect novel entry", error))?
            .is_dir()
        {
            continue;
        }
        let manifest_path = entry.path().join(MANIFEST_FILE);
        if !manifest_path.is_file() {
            continue;
        }
        let manifest: NovelProject = read_json(&manifest_path)?;
        let mut summary = NovelProjectSummary::from(&manifest);
        for unit_id in &manifest.unit_order {
            let path = unit_path(&entry.path(), unit_id)?;
            if path.is_file() {
                let unit: ManuscriptUnit = read_json(&path)?;
                summary.word_count = summary.word_count.saturating_add(unit.word_count);
            }
        }
        projects.push(summary);
    }
    projects.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(projects)
}

fn load_suggestions(project: &Path, fallback_updated_at: &str) -> NovelResult<VersionedCollection> {
    let root = project.join(SUGGESTIONS_DIR);
    if !root.exists() {
        return Ok(VersionedCollection::empty(
            Vec::new(),
            fallback_updated_at.to_string(),
        ));
    }
    let mut aggregate = VersionedCollection::empty(Vec::new(), fallback_updated_at.to_string());
    for entry in fs::read_dir(&root)
        .map_err(|error| storage_error("io_error", "scan suggestions directory", error))?
    {
        let entry =
            entry.map_err(|error| storage_error("io_error", "read suggestion entry", error))?;
        if !entry
            .file_type()
            .map_err(|error| storage_error("io_error", "inspect suggestion entry", error))?
            .is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }
        let collection: VersionedCollection = read_json(&entry.path())?;
        aggregate.revision = aggregate.revision.max(collection.revision);
        aggregate.updated_at = aggregate.updated_at.max(collection.updated_at);
        aggregate.items.extend(collection.items);
    }
    Ok(aggregate)
}

pub fn open_project(data_folder: &Path, novel_id: &str) -> NovelResult<NovelBundle> {
    let project = project_root(data_folder, novel_id)?;
    require_project(&project)?;
    let manifest: NovelProject = read_json(&project.join(MANIFEST_FILE))?;
    if manifest.id != novel_id {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Novel manifest id does not match directory",
        ));
    }
    let mut units = Vec::new();
    for unit_id in &manifest.unit_order {
        if let Some(unit) = load_manuscript_unit(data_folder, novel_id, unit_id)? {
            units.push(unit);
        }
    }
    let load_resource = |name: &str| -> NovelResult<VersionedCollection> {
        let path = resource_path(&project, name)?;
        if path.exists() {
            read_json(&path)
        } else {
            Ok(default_resource(name, manifest.updated_at.clone()))
        }
    };
    let characters = load_resource("characters")?;
    let relationships = load_resource("relationships")?;
    let outline = load_resource("outline")?;
    let clues = load_resource("clues")?;
    let comments = load_resource("comments")?;
    let suggestions = load_suggestions(&project, &manifest.updated_at)?;
    Ok(NovelBundle {
        project: manifest,
        units,
        characters,
        relationships,
        outline,
        clues,
        comments,
        suggestions,
    })
}

pub fn save_project(
    data_folder: &Path,
    request: SaveNovelProjectRequest,
) -> NovelResult<NovelProject> {
    validate_id("novel", &request.project.id)?;
    if request.project.title.trim().is_empty() {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Novel title cannot be empty",
        ));
    }
    if !matches!(
        request.project.kind.as_str(),
        "web_novel" | "novel" | "screenplay"
    ) {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Novel kind must be web_novel, novel, or screenplay",
        ));
    }
    for unit_id in &request.project.unit_order {
        validate_id("manuscript unit", unit_id)?;
    }
    if !request.project.active_unit_id.is_empty() {
        validate_id("manuscript unit", &request.project.active_unit_id)?;
        if !request
            .project
            .unit_order
            .iter()
            .any(|unit_id| unit_id == &request.project.active_unit_id)
        {
            return Err(NovelStorageError::new(
                "invalid_data",
                "The active manuscript unit must be present in unitOrder",
            ));
        }
    }

    let project_root = project_root(data_folder, &request.project.id)?;
    require_project(&project_root)?;
    let _lock = acquire_project_lock(&project_root)?;
    require_project(&project_root)?;
    let path = project_root.join(MANIFEST_FILE);
    let current: NovelProject = read_json(&path)?;
    if current.revision != request.expected_revision {
        return Err(NovelStorageError::conflict(
            request.expected_revision,
            current.revision,
        ));
    }
    let timestamp = now();
    let mut saved = request.project;
    let requested_unit_ids = saved.unit_order.iter().collect::<BTreeSet<_>>();
    if requested_unit_ids.len() != saved.unit_order.len() {
        return Err(NovelStorageError::new(
            "invalid_data",
            "unitOrder cannot contain duplicate manuscript units",
        ));
    }
    let current_unit_ids = current.unit_order.iter().collect::<BTreeSet<_>>();
    let structure_is_current = requested_unit_ids == current_unit_ids;
    saved.schema_version = NOVEL_SCHEMA_VERSION;
    saved.id = current.id;
    saved.created_at = current.created_at;
    // Manuscript saves own structural fields. A metadata edit based on an old
    // project DTO must never orphan a chapter created by another window. A
    // caller with the complete current set may still reorder or activate units.
    if !structure_is_current {
        saved.unit_order = current.unit_order;
        saved.active_unit_id = current.active_unit_id;
    }
    saved.revision = current.revision.saturating_add(1);
    saved.updated_at = timestamp.clone();
    write_json(&path, &saved).map_err(NovelStorageError::with_outcome_unknown)?;
    append_journal(
        &project_root,
        &NovelJournalEntry {
            operation: "saveProject".to_string(),
            novel_id: saved.id.clone(),
            unit_id: None,
            resource: Some("manifest".to_string()),
            revision: saved.revision,
            occurred_at: timestamp.clone(),
        },
    )
    .map_err(NovelStorageError::with_outcome_unknown)?;
    Ok(saved)
}

pub fn delete_project(data_folder: &Path, novel_id: &str) -> NovelResult<()> {
    let project = project_root(data_folder, novel_id)?;
    require_project(&project)?;
    // This stable lock is stored beside project directories, so it remains
    // valid while the project itself is removed.
    let _lock = acquire_project_lock(&project)?;
    require_project(&project)?;
    fs::remove_dir_all(&project).map_err(|error| {
        storage_error("storage_error", "delete novel project", error).with_outcome_unknown()
    })?;
    #[cfg(unix)]
    File::open(novels_root(data_folder))
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            storage_error("storage_error", "sync novels directory", error).with_outcome_unknown()
        })?;
    Ok(())
}

pub fn load_manuscript_unit(
    data_folder: &Path,
    novel_id: &str,
    unit_id: &str,
) -> NovelResult<Option<ManuscriptUnit>> {
    let project = project_root(data_folder, novel_id)?;
    require_project(&project)?;
    let path = unit_path(&project, unit_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let unit: ManuscriptUnit = read_json(&path)?;
    if unit.id != unit_id {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Manuscript unit id does not match file name",
        ));
    }
    Ok(Some(unit))
}

fn touch_manifest(
    project: &Path,
    unit_id: Option<&str>,
    timestamp: &str,
    activate_unit: bool,
) -> NovelResult<()> {
    let path = project.join(MANIFEST_FILE);
    let mut manifest: NovelProject = read_json(&path)?;
    manifest.updated_at = timestamp.to_string();
    if let Some(unit_id) = unit_id {
        if !manifest.unit_order.iter().any(|value| value == unit_id) {
            manifest.unit_order.push(unit_id.to_string());
        }
        if activate_unit {
            manifest.active_unit_id = unit_id.to_string();
        }
    }
    write_json(&path, &manifest)
}

fn save_document_locked(
    project: &Path,
    novel_id: &str,
    mut unit: ManuscriptUnit,
    expected_revision: u64,
    operation: &str,
    activate_unit: bool,
) -> NovelResult<ManuscriptUnit> {
    validate_id("manuscript unit", &unit.id)?;
    if unit.novel_id != novel_id {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Manuscript unit belongs to a different novel",
        ));
    }
    if !unit.content.is_object() {
        return Err(NovelStorageError::new(
            "invalid_data",
            "Manuscript document must be a JSON object",
        ));
    }
    let path = unit_path(project, &unit.id)?;
    let current = if path.exists() {
        Some(read_json::<ManuscriptUnit>(&path)?)
    } else {
        None
    };
    let current_revision = current.as_ref().map_or(0, |value| value.revision);
    if current_revision != expected_revision {
        return Err(NovelStorageError::conflict(
            expected_revision,
            current_revision,
        ));
    }
    if let Some(current) = &current {
        let revisions = revision_dir(project, &unit.id)?;
        fs::create_dir_all(&revisions)
            .map_err(|error| storage_error("io_error", "create revisions directory", error))?;
        write_json(
            &revisions.join(format!("{}.json", current.revision)),
            current,
        )?;
    }
    let timestamp = now();
    unit.schema_version = NOVEL_SCHEMA_VERSION;
    unit.revision = current_revision.saturating_add(1);
    unit.updated_at = timestamp.clone();
    if current.is_none() && unit.created_at.trim().is_empty() {
        unit.created_at = timestamp.clone();
    }
    write_json(&path, &unit).map_err(NovelStorageError::with_outcome_unknown)?;
    touch_manifest(project, Some(&unit.id), &timestamp, activate_unit)
        .map_err(NovelStorageError::with_outcome_unknown)?;
    append_journal(
        project,
        &NovelJournalEntry {
            operation: operation.to_string(),
            novel_id: novel_id.to_string(),
            unit_id: Some(unit.id.clone()),
            resource: Some("manuscript".to_string()),
            revision: unit.revision,
            occurred_at: timestamp.clone(),
        },
    )
    .map_err(NovelStorageError::with_outcome_unknown)?;
    Ok(unit)
}

pub fn save_manuscript_unit(
    data_folder: &Path,
    request: SaveManuscriptUnitRequest,
) -> NovelResult<ManuscriptUnit> {
    let project = project_root(data_folder, &request.novel_id)?;
    require_project(&project)?;
    let _lock = acquire_project_lock(&project)?;
    require_project(&project)?;
    save_document_locked(
        &project,
        &request.novel_id,
        request.unit,
        request.expected_revision,
        "saveManuscriptUnit",
        true,
    )
}

pub fn save_resource(
    data_folder: &Path,
    resource: &str,
    request: SaveNovelResourceRequest,
) -> NovelResult<VersionedCollection> {
    let project = project_root(data_folder, &request.novel_id)?;
    require_project(&project)?;
    let path = resource_path(&project, resource)?;
    let _lock = acquire_project_lock(&project)?;
    require_project(&project)?;
    let current: VersionedCollection = if path.exists() {
        read_json(&path)?
    } else {
        default_resource(resource, now())
    };
    if current.revision != request.expected_revision {
        return Err(NovelStorageError::conflict(
            request.expected_revision,
            current.revision,
        ));
    }
    let timestamp = now();
    let saved = VersionedCollection {
        schema_version: NOVEL_SCHEMA_VERSION,
        revision: current.revision.saturating_add(1),
        updated_at: timestamp.clone(),
        items: request.items,
    };
    write_json(&path, &saved).map_err(NovelStorageError::with_outcome_unknown)?;
    touch_manifest(&project, None, &timestamp, false)
        .map_err(NovelStorageError::with_outcome_unknown)?;
    append_journal(
        &project,
        &NovelJournalEntry {
            operation: "saveResource".to_string(),
            novel_id: request.novel_id,
            unit_id: None,
            resource: Some(resource.to_string()),
            revision: saved.revision,
            occurred_at: timestamp.clone(),
        },
    )
    .map_err(NovelStorageError::with_outcome_unknown)?;
    Ok(saved)
}

pub fn save_suggestions(
    data_folder: &Path,
    request: SaveNovelSuggestionsRequest,
) -> NovelResult<VersionedCollection> {
    let project = project_root(data_folder, &request.novel_id)?;
    require_project(&project)?;
    let _lock = acquire_project_lock(&project)?;
    require_project(&project)?;
    let current = load_suggestions(&project, &now())?;
    if current.revision != request.expected_revision {
        return Err(NovelStorageError::conflict(
            request.expected_revision,
            current.revision,
        ));
    }
    let timestamp = now();
    let revision = current.revision.saturating_add(1);
    let grouped = if request.unit_id.is_none() {
        let mut grouped: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for item in &request.items {
            let unit_id = item.get("unitId").and_then(Value::as_str).ok_or_else(|| {
                NovelStorageError::new("invalid_data", "Every AI suggestion must include a unitId")
            })?;
            validate_id("manuscript unit", unit_id)?;
            grouped
                .entry(unit_id.to_string())
                .or_default()
                .push(item.clone());
        }
        Some(grouped)
    } else {
        None
    };
    let index = VersionedCollection {
        schema_version: NOVEL_SCHEMA_VERSION,
        revision,
        updated_at: timestamp.clone(),
        items: Vec::new(),
    };

    if let Some(unit_id) = &request.unit_id {
        let saved = VersionedCollection {
            schema_version: NOVEL_SCHEMA_VERSION,
            revision,
            updated_at: timestamp.clone(),
            items: request.items,
        };
        write_json(&suggestion_path(&project, unit_id)?, &saved)
            .map_err(NovelStorageError::with_outcome_unknown)?;
    } else {
        let entries = fs::read_dir(project.join(SUGGESTIONS_DIR))
            .map_err(|error| storage_error("storage_error", "scan suggestions directory", error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| storage_error("storage_error", "read suggestion entry", error))?;
        let grouped = grouped.unwrap_or_default();
        for (unit_id, items) in &grouped {
            write_json(
                &suggestion_path(&project, unit_id)?,
                &VersionedCollection {
                    schema_version: NOVEL_SCHEMA_VERSION,
                    revision,
                    updated_at: timestamp.clone(),
                    items: items.clone(),
                },
            )
            .map_err(NovelStorageError::with_outcome_unknown)?;
        }
        for entry in entries {
            let unit_id = entry
                .path()
                .file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_string);
            if entry.path().is_file()
                && unit_id.as_deref() != Some("index")
                && unit_id.is_some_and(|unit_id| !grouped.contains_key(&unit_id))
            {
                fs::remove_file(entry.path()).map_err(|error| {
                    storage_error("storage_error", "remove stale suggestions", error)
                        .with_outcome_unknown()
                })?;
            }
        }
    }
    // Publish the aggregate revision only after all requested shards exist.
    // Errors after the first shard write are conservatively marked unknown.
    write_json(&project.join(SUGGESTIONS_DIR).join("index.json"), &index)
        .map_err(NovelStorageError::with_outcome_unknown)?;
    touch_manifest(&project, None, &timestamp, false)
        .map_err(NovelStorageError::with_outcome_unknown)?;
    append_journal(
        &project,
        &NovelJournalEntry {
            operation: "saveSuggestions".to_string(),
            novel_id: request.novel_id,
            unit_id: request.unit_id,
            resource: Some("suggestions".to_string()),
            revision,
            occurred_at: timestamp.clone(),
        },
    )
    .map_err(NovelStorageError::with_outcome_unknown)?;
    load_suggestions(&project, &timestamp).map_err(NovelStorageError::with_outcome_unknown)
}

pub fn list_revisions(
    data_folder: &Path,
    novel_id: &str,
    unit_id: &str,
) -> NovelResult<Vec<NovelRevisionSummary>> {
    let project = project_root(data_folder, novel_id)?;
    require_project(&project)?;
    let directory = revision_dir(&project, unit_id)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut revisions = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| storage_error("io_error", "scan revisions directory", error))?
    {
        let entry =
            entry.map_err(|error| storage_error("io_error", "read revision entry", error))?;
        if !entry
            .file_type()
            .map_err(|error| storage_error("io_error", "inspect revision entry", error))?
            .is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("json")
            || entry
                .path()
                .file_stem()
                .and_then(|value| value.to_str())
                .and_then(|value| value.parse::<u64>().ok())
                .is_none()
        {
            continue;
        }
        let revision: ManuscriptUnit = read_json(&entry.path())?;
        revisions.push(NovelRevisionSummary {
            id: revision.revision.to_string(),
            novel_id: novel_id.to_string(),
            unit_id: unit_id.to_string(),
            revision: revision.revision,
            created_at: revision.updated_at,
            word_count: revision.word_count,
        });
    }
    revisions.sort_by(|left, right| right.revision.cmp(&left.revision));
    Ok(revisions)
}

pub fn restore_revision(
    data_folder: &Path,
    request: RestoreNovelRevisionRequest,
) -> NovelResult<ManuscriptUnit> {
    let project = project_root(data_folder, &request.novel_id)?;
    require_project(&project)?;
    validate_id("revision", &request.revision_id)?;
    let revision_path =
        revision_dir(&project, &request.unit_id)?.join(format!("{}.json", request.revision_id));
    if !revision_path.is_file() {
        return Err(NovelStorageError::new(
            "not_found",
            "Manuscript revision not found",
        ));
    }
    let restored: ManuscriptUnit = read_json(&revision_path)?;
    let _lock = acquire_project_lock(&project)?;
    require_project(&project)?;
    save_document_locked(
        &project,
        &request.novel_id,
        restored,
        request.expected_revision,
        "restoreManuscriptRevision",
        true,
    )
}

fn plain_text_document(content: &str) -> Value {
    let mut paragraphs = content
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .map(|paragraph| {
            json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": paragraph}]
            })
        })
        .collect::<Vec<_>>();
    if paragraphs.is_empty() {
        paragraphs.push(json!({"type": "paragraph"}));
    }
    json!({"type": "doc", "content": paragraphs})
}

fn markdown_document(content: &str) -> Value {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut nodes = Vec::new();
    let mut paragraph = Vec::new();
    let flush = |paragraph: &mut Vec<String>, nodes: &mut Vec<Value>| {
        if !paragraph.is_empty() {
            let text = paragraph.join(" ");
            nodes.push(json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": text}]
            }));
            paragraph.clear();
        }
    };
    for line in normalized.lines() {
        let trimmed = line.trim();
        let heading_level = trimmed.chars().take_while(|value| *value == '#').count();
        if (1..=3).contains(&heading_level) && trimmed.chars().nth(heading_level) == Some(' ') {
            flush(&mut paragraph, &mut nodes);
            let text = trimmed[heading_level + 1..].trim();
            nodes.push(json!({
                "type": "heading",
                "attrs": {"level": heading_level},
                "content": [{"type": "text", "text": text}]
            }));
        } else if let Some(quote) = trimmed.strip_prefix('>') {
            flush(&mut paragraph, &mut nodes);
            nodes.push(json!({
                "type": "blockquote",
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": quote.trim()}]
                }]
            }));
        } else if trimmed == "---" || trimmed == "***" {
            flush(&mut paragraph, &mut nodes);
            nodes.push(json!({"type": "sceneBreak"}));
        } else if trimmed.is_empty() {
            flush(&mut paragraph, &mut nodes);
        } else {
            paragraph.push(trimmed.to_string());
        }
    }
    flush(&mut paragraph, &mut nodes);
    if nodes.is_empty() {
        nodes.push(json!({"type": "paragraph"}));
    }
    json!({"type": "doc", "content": nodes})
}

fn replace_unit_references(value: &mut Value, mapping: &BTreeMap<String, String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if (key == "unitId" || key.ends_with("UnitId")) && child.is_string() {
                    if let Some(replacement) = child.as_str().and_then(|id| mapping.get(id)) {
                        *child = Value::String(replacement.clone());
                    }
                } else {
                    replace_unit_references(child, mapping);
                }
            }
        }
        Value::Array(values) => {
            for child in values {
                replace_unit_references(child, mapping);
            }
        }
        _ => {}
    }
}

pub fn import_project(data_folder: &Path, request: NovelImportRequest) -> NovelResult<NovelBundle> {
    if request.format == "docx" {
        return Err(NovelStorageError::new(
            "unsupported",
            "DOCX import is not supported yet",
        ));
    }
    if !matches!(request.format.as_str(), "markdown" | "txt" | "biyan-novel") {
        return Err(NovelStorageError::new(
            "unsupported",
            "Unsupported novel import format",
        ));
    }

    if request.format != "biyan-novel" {
        let fallback_title = Path::new(&request.file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名作品");
        let title = request
            .title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_title.to_string());
        let initial_content = if request.format == "markdown" {
            markdown_document(&request.content)
        } else {
            plain_text_document(&request.content)
        };
        return create_project(
            data_folder,
            CreateNovelProjectRequest {
                title,
                kind: request.kind,
                genre: None,
                synopsis: None,
                template: None,
                initial_content: Some(initial_content),
            },
        );
    }

    let imported: NovelBundle = serde_json::from_str(&request.content).map_err(|error| {
        storage_error(
            "invalid_data",
            "The .biyan-novel file has invalid JSON",
            error,
        )
    })?;
    if imported.project.schema_version != NOVEL_SCHEMA_VERSION {
        return Err(NovelStorageError::new(
            "unsupported",
            "Unsupported .biyan-novel schema version",
        ));
    }
    if imported.units.is_empty() {
        return Err(NovelStorageError::new(
            "invalid_data",
            "A .biyan-novel archive must contain at least one manuscript unit",
        ));
    }
    let first_content = imported
        .units
        .first()
        .map(|unit| unit.content.clone())
        .unwrap_or_else(|| json!({"type": "doc", "content": [{"type": "paragraph"}]}));
    let override_title = request
        .title
        .clone()
        .filter(|value| !value.trim().is_empty());
    let title = override_title
        .clone()
        .unwrap_or_else(|| imported.project.title.clone());
    let created = create_project(
        data_folder,
        CreateNovelProjectRequest {
            title,
            kind: imported.project.kind.clone(),
            genre: Some(imported.project.genre.clone()),
            synopsis: Some(imported.project.synopsis.clone()),
            template: None,
            initial_content: Some(first_content),
        },
    )?;
    let novel_id = created.project.id.clone();
    let initial_unit_id = created
        .units
        .first()
        .map(|unit| unit.id.clone())
        .ok_or_else(|| NovelStorageError::new("storage_error", "Initial unit was not created"))?;
    let mut unit_mapping = BTreeMap::new();
    for (index, imported_unit) in imported.units.iter().enumerate() {
        let target_id = if index == 0 {
            initial_unit_id.clone()
        } else if validate_id("manuscript unit", &imported_unit.id).is_ok() {
            imported_unit.id.clone()
        } else {
            Uuid::new_v4().to_string()
        };
        unit_mapping.insert(imported_unit.id.clone(), target_id);
    }

    let mut saved_units = Vec::new();
    for (index, mut imported_unit) in imported.units.into_iter().enumerate() {
        imported_unit.id = unit_mapping
            .get(&imported_unit.id)
            .cloned()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        imported_unit.novel_id = novel_id.clone();
        imported_unit.parent_id = imported_unit
            .parent_id
            .and_then(|id| unit_mapping.get(&id).cloned());
        let saved = save_manuscript_unit(
            data_folder,
            SaveManuscriptUnitRequest {
                novel_id: novel_id.clone(),
                unit: imported_unit,
                expected_revision: if index == 0 { 1 } else { 0 },
            },
        )?;
        saved_units.push(saved);
    }

    let save_imported_collection =
        |resource: &str, mut items: Vec<Value>| -> NovelResult<VersionedCollection> {
            for item in &mut items {
                replace_unit_references(item, &unit_mapping);
            }
            save_resource(
                data_folder,
                resource,
                SaveNovelResourceRequest {
                    novel_id: novel_id.clone(),
                    expected_revision: 0,
                    items,
                    unit_id: None,
                },
            )
        };
    save_imported_collection("characters", imported.characters.items)?;
    save_imported_collection("relationships", imported.relationships.items)?;
    save_imported_collection("outline", imported.outline.items)?;
    save_imported_collection("clues", imported.clues.items)?;
    save_imported_collection("comments", imported.comments.items)?;

    let mut suggestions = imported.suggestions.items;
    for suggestion in &mut suggestions {
        replace_unit_references(suggestion, &unit_mapping);
    }
    save_suggestions(
        data_folder,
        SaveNovelResourceRequest {
            novel_id: novel_id.clone(),
            expected_revision: 0,
            items: suggestions,
            unit_id: None,
        },
    )?;

    let current = open_project(data_folder, &novel_id)?;
    let mut project = current.project.clone();
    project.title = override_title.unwrap_or(imported.project.title);
    project.genre = imported.project.genre;
    project.synopsis = imported.project.synopsis;
    project.status = imported.project.status;
    project.unit_order = saved_units.iter().map(|unit| unit.id.clone()).collect();
    project.active_unit_id = unit_mapping
        .get(&imported.project.active_unit_id)
        .cloned()
        .or_else(|| project.unit_order.first().cloned())
        .unwrap_or_default();
    save_project(
        data_folder,
        SaveNovelProjectRequest {
            project,
            expected_revision: current.project.revision,
        },
    )?;
    open_project(data_folder, &novel_id)
}

fn document_text(value: &Value) -> String {
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    let node_type = value.get("type").and_then(Value::as_str);
    if matches!(node_type, Some("hardBreak" | "sceneBreak")) {
        return "\n".to_string();
    }
    let separator = match node_type {
        Some("doc" | "blockquote" | "bulletList" | "orderedList" | "listItem") => "\n",
        _ => "",
    };
    value
        .get("content")
        .and_then(Value::as_array)
        .map(|children| {
            children
                .iter()
                .map(document_text)
                .collect::<Vec<_>>()
                .join(separator)
        })
        .unwrap_or_default()
}

fn markdown_text(value: &Value) -> String {
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    let content = value
        .get("content")
        .and_then(Value::as_array)
        .map(|children| children.iter().map(markdown_text).collect::<String>())
        .unwrap_or_default();
    match value.get("type").and_then(Value::as_str) {
        Some("heading") => {
            let level = value
                .get("attrs")
                .and_then(|attrs| attrs.get("level"))
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6);
            format!("{} {}\n\n", "#".repeat(level as usize), content)
        }
        Some("paragraph") => format!("{content}\n\n"),
        Some("blockquote") => format!(
            "{}\n\n",
            content
                .trim()
                .lines()
                .map(|line| format!("> {line}"))
                .collect::<Vec<_>>()
                .join("\n")
        ),
        Some("sceneBreak") => "---\n\n".to_string(),
        _ => content,
    }
}

fn safe_file_stem(value: &str) -> String {
    let stem = value
        .trim()
        .chars()
        .map(|character| {
            if matches!(
                character,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    if stem.is_empty() {
        "untitled".to_string()
    } else {
        stem
    }
}

pub fn export_project(
    data_folder: &Path,
    request: NovelExportRequest,
) -> NovelResult<NovelExportResult> {
    let bundle = open_project(data_folder, &request.novel_id)?;
    let stem = safe_file_stem(&bundle.project.title);
    match request.format.as_str() {
        "biyan-novel" => Ok(NovelExportResult {
            file_name: format!("{stem}.biyan-novel"),
            mime_type: "application/vnd.biyan.novel+json".to_string(),
            content: serde_json::to_string_pretty(&bundle)?,
        }),
        "txt" => Ok(NovelExportResult {
            file_name: format!("{stem}.txt"),
            mime_type: "text/plain;charset=utf-8".to_string(),
            content: bundle
                .units
                .iter()
                .map(|unit| format!("{}\n\n{}", unit.title, document_text(&unit.content).trim()))
                .collect::<Vec<_>>()
                .join("\n\n"),
        }),
        "markdown" => Ok(NovelExportResult {
            file_name: format!("{stem}.md"),
            mime_type: "text/markdown;charset=utf-8".to_string(),
            content: bundle
                .units
                .iter()
                .map(|unit| {
                    format!(
                        "# {}\n\n{}",
                        unit.title,
                        markdown_text(&unit.content).trim()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n"),
        }),
        _ => Err(NovelStorageError::new(
            "unsupported",
            "Unsupported novel export format",
        )),
    }
}

#[cfg(test)]
pub(super) fn journal_entries(project: &Path) -> NovelResult<Vec<NovelJournalEntry>> {
    let mut raw = String::new();
    File::open(project.join(JOURNAL_FILE))
        .map_err(|error| storage_error("io_error", "open novel journal", error))?
        .read_to_string(&mut raw)
        .map_err(|error| storage_error("io_error", "read novel journal", error))?;
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(NovelStorageError::from))
        .collect()
}
