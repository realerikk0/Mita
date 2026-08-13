use super::{
    models::{
        CreateNovelProjectRequest, ManuscriptUnit, NovelExportRequest, NovelImportRequest,
        RestoreNovelRevisionRequest, SaveManuscriptUnitRequest, SaveNovelProjectRequest,
        SaveNovelResourceRequest, NOVEL_SCHEMA_VERSION,
    },
    storage,
};
use serde_json::json;
use std::{fs, thread};
use tempfile::TempDir;

fn create_request(title: &str) -> CreateNovelProjectRequest {
    CreateNovelProjectRequest {
        title: title.to_string(),
        kind: "web_novel".to_string(),
        genre: Some("东方玄幻".to_string()),
        synopsis: Some("雨夜发簪牵出旧案。".to_string()),
        template: None,
        initial_content: None,
    }
}

fn unit(novel_id: &str, id: &str, content: &str) -> ManuscriptUnit {
    ManuscriptUnit {
        schema_version: NOVEL_SCHEMA_VERSION,
        id: id.to_string(),
        novel_id: novel_id.to_string(),
        parent_id: None,
        kind: "chapter".to_string(),
        title: "第一章 雨夜发簪".to_string(),
        position: 0,
        summary: "沈砚秋得到一枚发簪。".to_string(),
        goal: "埋下第七十章回收的伏笔。".to_string(),
        word_count: content.chars().count() as u64,
        content: json!({
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": content}]}]
        }),
        revision: 0,
        created_at: "2026-08-12T00:00:00Z".to_string(),
        updated_at: "2026-08-12T00:00:00Z".to_string(),
    }
}

#[test]
fn creates_lists_and_opens_project_layout() {
    let data = TempDir::new().unwrap();
    let created = storage::create_project(data.path(), create_request("照骨天书")).unwrap();

    assert_eq!(created.project.title, "照骨天书");
    assert_eq!(created.project.schema_version, NOVEL_SCHEMA_VERSION);
    assert_eq!(created.units.len(), 1);
    assert!(created.characters.items.is_empty());

    let root = data.path().join("novels").join(&created.project.id);
    for path in [
        "manifest.json",
        "characters.json",
        "relationships.json",
        "outline.json",
        "clues.json",
        "comments.json",
        "journal.jsonl",
    ] {
        assert!(root.join(path).is_file(), "missing {path}");
    }
    for path in ["manuscript", "suggestions", "revisions", "assets"] {
        assert!(root.join(path).is_dir(), "missing {path}");
    }

    let listed = storage::list_projects(data.path()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "照骨天书");
    assert_eq!(listed[0].word_count, 0);

    let opened = storage::open_project(data.path(), &created.project.id).unwrap();
    assert_eq!(opened, created);
    assert_eq!(storage::journal_entries(&root).unwrap().len(), 2);
}

#[test]
fn counts_initial_import_content_before_the_first_edit() {
    let data = TempDir::new().unwrap();
    let mut request = create_request("导入稿");
    request.initial_content = Some(json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "雨落"},
                {"type": "text", "text": " Chapter"}
            ]
        }]
    }));

    let created = storage::create_project(data.path(), request).unwrap();
    assert_eq!(created.units[0].word_count, 3);
    assert_eq!(
        storage::list_projects(data.path()).unwrap()[0].word_count,
        3
    );
}

#[test]
fn saves_unit_with_revision_backup_and_restores_it() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let unit_id = "chapter-1";

    let first = storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: project.id.clone(),
            unit: unit(&project.id, unit_id, "第一版文字"),
            expected_revision: 0,
        },
    )
    .unwrap();
    assert_eq!(first.revision, 1);

    let second = storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: project.id.clone(),
            unit: unit(&project.id, unit_id, "第二版文字"),
            expected_revision: 1,
        },
    )
    .unwrap();
    assert_eq!(second.revision, 2);

    let revisions_dir = data
        .path()
        .join("novels")
        .join(&project.id)
        .join("revisions")
        .join(unit_id);
    fs::write(revisions_dir.join(".crash.tmp"), b"incomplete").unwrap();

    let revisions = storage::list_revisions(data.path(), &project.id, unit_id).unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].id, "1");

    let restored = storage::restore_revision(
        data.path(),
        RestoreNovelRevisionRequest {
            novel_id: project.id.clone(),
            unit_id: unit_id.to_string(),
            revision_id: "1".to_string(),
            expected_revision: 2,
        },
    )
    .unwrap();
    assert_eq!(restored.revision, 3);
    assert_eq!(restored.content, first.content);

    let revisions = storage::list_revisions(data.path(), &project.id, unit_id).unwrap();
    assert_eq!(
        revisions
            .iter()
            .map(|revision| revision.revision)
            .collect::<Vec<_>>(),
        vec![2, 1]
    );
    let opened = storage::open_project(data.path(), &project.id).unwrap();
    assert_eq!(opened.units.len(), 2);
    assert_eq!(
        opened
            .units
            .iter()
            .find(|unit| unit.id == unit_id)
            .unwrap()
            .revision,
        3
    );
    assert_eq!(opened.project.active_unit_id, unit_id);
}

#[test]
fn stale_revision_does_not_change_unit_or_journal() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let unit_id = "chapter-1";
    storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: project.id.clone(),
            unit: unit(&project.id, unit_id, "已保存"),
            expected_revision: 0,
        },
    )
    .unwrap();

    let root = data.path().join("novels").join(&project.id);
    let path = root.join("manuscript/chapter-1.json");
    let before = fs::read(&path).unwrap();
    let before_journal = fs::read(root.join("journal.jsonl")).unwrap();
    let error = storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: project.id,
            unit: unit("ignored", unit_id, "不得覆盖"),
            expected_revision: 0,
        },
    )
    .unwrap_err();

    // The novel-id mismatch is rejected before revision handling and is also non-mutating.
    assert_eq!(error.code, "invalid_data");
    assert_eq!(fs::read(path).unwrap(), before);
    assert_eq!(
        fs::read(root.join("journal.jsonl")).unwrap(),
        before_journal
    );
}

#[test]
fn stale_expected_revision_returns_structured_conflict() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let unit_id = "chapter-1";
    storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: project.id.clone(),
            unit: unit(&project.id, unit_id, "已保存"),
            expected_revision: 0,
        },
    )
    .unwrap();
    let root = data.path().join("novels").join(&project.id);
    let before = fs::read(root.join("manuscript/chapter-1.json")).unwrap();
    let before_journal = fs::read(root.join("journal.jsonl")).unwrap();

    let error = storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: project.id.clone(),
            unit: unit(&project.id, unit_id, "不得覆盖"),
            expected_revision: 0,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "revision_conflict");
    assert_eq!(error.current_revision, Some(1));
    assert!(!error.outcome_unknown);
    assert_eq!(
        fs::read(root.join("manuscript/chapter-1.json")).unwrap(),
        before
    );
    assert_eq!(
        fs::read(root.join("journal.jsonl")).unwrap(),
        before_journal
    );
}

#[test]
fn concurrent_saves_with_same_expected_revision_have_one_winner() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let data_path = data.path().to_path_buf();
    let novel_id = project.id.clone();

    let handles = ["候选甲", "候选乙"].map(|content| {
        let data_path = data_path.clone();
        let novel_id = novel_id.clone();
        thread::spawn(move || {
            storage::save_manuscript_unit(
                &data_path,
                SaveManuscriptUnitRequest {
                    novel_id: novel_id.clone(),
                    unit: unit(&novel_id, "chapter-1", content),
                    expected_revision: 0,
                },
            )
        })
    });
    let results = handles.map(|handle| handle.join().unwrap());
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    let loser = results
        .iter()
        .find_map(|result| result.as_ref().err())
        .unwrap();
    assert_eq!(loser.code, "revision_conflict");
    assert_eq!(loser.current_revision, Some(1));
}

#[test]
fn saves_versioned_resources_and_unit_scoped_suggestions() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let characters = storage::save_resource(
        data.path(),
        "characters",
        SaveNovelResourceRequest {
            novel_id: project.id.clone(),
            items: vec![json!({"id": "shen-yanqiu", "name": "沈砚秋"})],
            expected_revision: 0,
            unit_id: None,
        },
    )
    .unwrap();
    assert_eq!(characters.revision, 1);

    let suggestions = storage::save_suggestions(
        data.path(),
        SaveNovelResourceRequest {
            novel_id: project.id.clone(),
            items: vec![json!({"id": "candidate-a", "unitId": "chapter-1"})],
            expected_revision: 0,
            unit_id: Some("chapter-1".to_string()),
        },
    )
    .unwrap();
    assert_eq!(suggestions.revision, 1);

    let opened = storage::open_project(data.path(), &project.id).unwrap();
    assert_eq!(opened.characters.items.len(), 1);
    assert_eq!(opened.suggestions.items.len(), 1);
    assert_eq!(opened.project.revision, project.revision);
}

#[test]
fn suggestion_index_watermark_hides_partial_shards_and_controls_next_cas() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let suggestions_dir = data
        .path()
        .join("novels")
        .join(&project.id)
        .join("suggestions");
    let committed_at = "2026-08-12T00:00:00Z";
    let interrupted_at = "2026-08-12T00:01:00Z";

    // This is the watermark-only index format written before committed
    // snapshots were embedded in index.json.
    fs::write(
        suggestions_dir.join("index.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": NOVEL_SCHEMA_VERSION,
            "revision": 4,
            "updatedAt": committed_at,
            "items": []
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        suggestions_dir.join("chapter-partial.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": NOVEL_SCHEMA_VERSION,
            "revision": 5,
            "updatedAt": interrupted_at,
            "items": [{"id": "must-not-leak", "unitId": "chapter-partial"}]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        suggestions_dir.join("chapter-committed.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": NOVEL_SCHEMA_VERSION,
            "revision": 4,
            "updatedAt": committed_at,
            "items": [{"id": "committed", "unitId": "chapter-committed"}]
        }))
        .unwrap(),
    )
    .unwrap();

    let opened = storage::open_project(data.path(), &project.id).unwrap();
    assert_eq!(opened.suggestions.revision, 4);
    assert_eq!(opened.suggestions.items.len(), 1);
    assert_eq!(opened.suggestions.items[0]["id"], json!("committed"));

    // CAS must compare against index revision 4, not the uncommitted shard's 5.
    // A scoped follow-up commit must also not make that partial shard visible.
    let saved = storage::save_suggestions(
        data.path(),
        SaveNovelResourceRequest {
            novel_id: project.id.clone(),
            items: vec![json!({
                "id": "committed-next",
                "unitId": "chapter-committed"
            })],
            expected_revision: 4,
            unit_id: Some("chapter-committed".to_string()),
        },
    )
    .unwrap();
    assert_eq!(saved.revision, 5);
    assert_eq!(saved.items.len(), 1);
    assert_eq!(saved.items[0]["id"], json!("committed-next"));
    assert!(!saved
        .items
        .iter()
        .any(|item| item["id"] == json!("must-not-leak")));

    let reopened = storage::open_project(data.path(), &project.id).unwrap();
    assert_eq!(reopened.suggestions, saved);
}

#[test]
fn suggestion_shards_cannot_collide_with_the_index_commit_file() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;

    let saved = storage::save_suggestions(
        data.path(),
        SaveNovelResourceRequest {
            novel_id: project.id.clone(),
            items: vec![json!({"id": "index-unit-suggestion", "unitId": "index"})],
            expected_revision: 0,
            unit_id: Some("index".to_string()),
        },
    )
    .unwrap();

    let suggestions_dir = data
        .path()
        .join("novels")
        .join(&project.id)
        .join("suggestions");
    assert!(suggestions_dir.join("index.json").is_file());
    assert!(suggestions_dir.join("unit-index.json").is_file());
    assert_eq!(saved.items[0]["unitId"], json!("index"));

    // Simulate a crash after the `index` unit shard reached N+1 but before the
    // authoritative index snapshot was published. The shard must not collide
    // with or advance the committed snapshot, and CAS must still use N.
    fs::write(
        suggestions_dir.join("unit-index.json"),
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": NOVEL_SCHEMA_VERSION,
            "revision": 2,
            "updatedAt": "2026-08-12T00:01:00Z",
            "items": [{"id": "must-not-leak", "unitId": "index"}]
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        storage::open_project(data.path(), &project.id)
            .unwrap()
            .suggestions,
        saved
    );

    let recovered = storage::save_suggestions(
        data.path(),
        SaveNovelResourceRequest {
            novel_id: project.id.clone(),
            items: vec![json!({"id": "recovered", "unitId": "index"})],
            expected_revision: saved.revision,
            unit_id: Some("index".to_string()),
        },
    )
    .unwrap();
    assert_eq!(recovered.revision, 2);
    assert_eq!(
        recovered.items,
        vec![json!({"id": "recovered", "unitId": "index"})]
    );
    assert_eq!(
        storage::open_project(data.path(), &project.id)
            .unwrap()
            .suggestions,
        recovered
    );
}

#[test]
fn rejects_path_traversal_and_leaves_no_temp_files() {
    let data = TempDir::new().unwrap();
    let project = storage::create_project(data.path(), create_request("照骨天书"))
        .unwrap()
        .project;
    let error = storage::load_manuscript_unit(data.path(), &project.id, "../outside").unwrap_err();
    assert_eq!(error.code, "invalid_data");
    let error = storage::open_project(data.path(), "../outside").unwrap_err();
    assert_eq!(error.code, "invalid_data");

    let root = data.path().join("novels").join(project.id);
    let tmp_files = fs::read_dir(root)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(tmp_files, 0);
}

#[test]
fn cultivation_template_seeds_story_assets_and_hairpin_payoff() {
    let data = TempDir::new().unwrap();
    let mut request = create_request("照骨天书");
    request.template = Some("cultivation".to_string());
    let created = storage::create_project(data.path(), request).unwrap();

    assert_eq!(created.characters.items.len(), 3);
    assert_eq!(created.relationships.items.len(), 2);
    assert_eq!(created.outline.items.len(), 3);
    assert_eq!(created.clues.items.len(), 1);
    assert_eq!(created.clues.revision, 1);
    assert_eq!(created.units.len(), 3);
    assert_eq!(created.project.unit_order.len(), 3);
    assert_eq!(created.project.active_unit_id, created.units[0].id);
    assert_eq!(created.units[1].id, "chapter-3");
    assert_eq!(created.units[1].position, 2);
    assert_eq!(created.units[2].id, "chapter-70");
    assert_eq!(created.units[2].position, 69);
    assert_eq!(created.clues.items[0]["plantedUnitId"], json!("chapter-3"));
    assert_eq!(
        created.clues.items[0]["plannedResolveUnitId"],
        json!("chapter-70")
    );
    assert!(created.project.unit_order.contains(
        &created.clues.items[0]["plantedUnitId"]
            .as_str()
            .unwrap()
            .to_string()
    ));
    assert!(created.project.unit_order.contains(
        &created.clues.items[0]["plannedResolveUnitId"]
            .as_str()
            .unwrap()
            .to_string()
    ));
    assert!(created.clues.items[0]["notes"]
        .as_str()
        .unwrap()
        .contains("第70章"));
}

#[test]
fn saves_project_with_revision_guard_and_deletes_it() {
    let data = TempDir::new().unwrap();
    let created = storage::create_project(data.path(), create_request("照骨天书")).unwrap();
    let added = storage::save_manuscript_unit(
        data.path(),
        SaveManuscriptUnitRequest {
            novel_id: created.project.id.clone(),
            unit: unit(&created.project.id, "chapter-new", "新章"),
            expected_revision: 0,
        },
    )
    .unwrap();
    let mut edited = created.project.clone();
    edited.title = "照骨天书·修订".to_string();
    let saved = storage::save_project(
        data.path(),
        SaveNovelProjectRequest {
            project: edited,
            expected_revision: created.project.revision,
        },
    )
    .unwrap();
    assert_eq!(saved.title, "照骨天书·修订");
    assert!(saved.unit_order.contains(&added.id));
    assert_eq!(saved.active_unit_id, added.id);

    let mut stale = saved.clone();
    stale.title = "不得覆盖".to_string();
    let error = storage::save_project(
        data.path(),
        SaveNovelProjectRequest {
            project: stale,
            expected_revision: created.project.revision,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "revision_conflict");
    assert_eq!(error.current_revision, Some(saved.revision));

    storage::delete_project(data.path(), &saved.id).unwrap();
    assert!(storage::list_projects(data.path()).unwrap().is_empty());
    assert_eq!(
        storage::open_project(data.path(), &saved.id)
            .unwrap_err()
            .code,
        "not_found"
    );
}

#[test]
fn imports_and_exports_supported_formats_and_rejects_docx() {
    let data = TempDir::new().unwrap();
    let imported = storage::import_project(
        data.path(),
        NovelImportRequest {
            title: None,
            kind: "web_novel".to_string(),
            format: "markdown".to_string(),
            file_name: "雨夜旧簪.md".to_string(),
            content: "# 第一章\n\n沈砚秋拾起旧银簪。".to_string(),
        },
    )
    .unwrap();
    assert_eq!(imported.project.title, "雨夜旧簪");
    assert_eq!(imported.units.len(), 1);

    let markdown = storage::export_project(
        data.path(),
        NovelExportRequest {
            novel_id: imported.project.id.clone(),
            format: "markdown".to_string(),
        },
    )
    .unwrap();
    assert!(markdown.file_name.ends_with(".md"));
    assert!(markdown.content.contains("沈砚秋拾起旧银簪"));

    let archive = storage::export_project(
        data.path(),
        NovelExportRequest {
            novel_id: imported.project.id.clone(),
            format: "biyan-novel".to_string(),
        },
    )
    .unwrap();
    assert!(serde_json::from_str::<serde_json::Value>(&archive.content).is_ok());

    let mut empty_archive: serde_json::Value = serde_json::from_str(&archive.content).unwrap();
    empty_archive["units"] = json!([]);
    let before_count = storage::list_projects(data.path()).unwrap().len();
    let error = storage::import_project(
        data.path(),
        NovelImportRequest {
            title: None,
            kind: "web_novel".to_string(),
            format: "biyan-novel".to_string(),
            file_name: "empty.biyan-novel".to_string(),
            content: serde_json::to_string(&empty_archive).unwrap(),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "invalid_data");
    assert_eq!(
        storage::list_projects(data.path()).unwrap().len(),
        before_count
    );

    let error = storage::import_project(
        data.path(),
        NovelImportRequest {
            title: None,
            kind: "web_novel".to_string(),
            format: "docx".to_string(),
            file_name: "draft.docx".to_string(),
            content: String::new(),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "unsupported");
}
