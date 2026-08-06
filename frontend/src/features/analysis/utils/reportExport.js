// src/features/analysis/utils/reportExport.js
import { DRAFT_TEMPLATES } from "../components/TemplatePickerModal";

/** Document IDs from info_table.selected (array or report object shape). */
export function selectedDocumentIds(selected) {
  if (Array.isArray(selected)) return selected;
  if (selected && Array.isArray(selected.document_ids)) return selected.document_ids;
  return [];
}

/** Resolve template_id from persisted report metadata or report name. */
export function resolveTemplateId(item) {
  const fromSelected = item?.selected?.template_id;
  if (fromSelected) return fromSelected;
  const name = item?.name || "";
  for (const tpl of DRAFT_TEMPLATES) {
    if (name.includes(tpl.label)) return tpl.id;
  }
  return "speech_draft";
}

/** Trigger a browser download from a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
