// [fork-only] 由 packages/branding/scripts/gen-migration-baseline.mjs 生成,请勿手改。
//   REQ-084① 迁移污染检测基线 [feat: voice-preclear-batch] 2026-08-18
//   重新生成:node packages/branding/scripts/gen-migration-baseline.mjs
//   源:packages/core/src/database/migration/(文件名去 .ts)
//
// 上游 sync 后若 core 新增了 migration,必须重跑本脚本 —— db-schema-guard.test.ts 的
// drift 闸(T2)会在目录里出现基线外 id 时直接红,防止忘记更新导致【自家新库被误判超前】。
//
// 本清单是 append-only 并集:**只增不减**。上游删掉/改名的旧 id 也要留着 ——
// 老用户库的 migration 表里仍有它,从基线拿掉就等于把那些好库判成超前。

/** 本 fork core 已知的全部 migration id(共 38 条)。 */
export const MIGRATION_BASELINE: string[] = [
  "20260127222353_familiar_lady_ursula",
  "20260211171708_add_project_commands",
  "20260213144116_wakeful_the_professor",
  "20260225215848_workspace",
  "20260227213759_add_session_workspace_id",
  "20260228203230_blue_harpoon",
  "20260303231226_add_workspace_fields",
  "20260309230000_move_org_to_state",
  "20260312043431_session_message_cursor",
  "20260323234822_events",
  "20260410174513_workspace-name",
  "20260413175956_chief_energizer",
  "20260423070820_add_icon_url_override",
  "20260427172553_slow_nightmare",
  "20260428004200_add_session_path",
  "20260501142318_next_venus",
  "20260504145000_add_sync_owner",
  "20260507164347_add_workspace_time",
  "20260510033149_session_usage",
  "20260511000411_data_migration_state",
  "20260511173437_session-metadata",
  "20260601010001_normalize_storage_paths",
  "20260601202201_amazing_prowler",
  "20260602002951_lowly_union_jack",
  "20260602182828_add_project_directories",
  "20260603001617_session_message_projection_indexes",
  "20260603040000_session_message_projection_order",
  "20260603141458_session_input_inbox",
  "20260603160727_jittery_ezekiel_stane",
  "20260604172448_event_sourced_session_input",
  "20260605003541_add_session_context_snapshot",
  "20260605042240_add_context_epoch_agent",
  "20260611035744_credential",
  "20260611192811_lush_chimera",
  "20260612174303_project_dir_strategy",
  "20260622142730_simplify_session_context_epoch",
  "20260622170816_reset_v2_session_state",
  "20260622202450_simplify_session_input",
]
