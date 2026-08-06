// src/features/documents/components/repoPicker/repoTree.js
//
// Pure helpers for the 2-level repository picker tree (story 16). Framework-free
// so they unit-test without rendering (ADR-008). The tree has flat documents
// (group_id null, shown in the left column) and folders (groups) whose
// documents appear in the right column.

/**
 * @typedef {{ id: string, name: string, group_id: number|null }} RepoDoc
 * @typedef {{ id: number, name: string }} RepoGroup
 */

/** Documents with no group — the "flat" left-column entries. */
export function flatDocs(documents) {
  return (documents || []).filter((d) => d.group_id == null);
}

/** Documents inside a given folder (group). */
export function docsInGroup(documents, groupId) {
  return (documents || []).filter((d) => Number(d.group_id) === Number(groupId));
}

/** Toggle a single doc id in the selection set, returning a new array. */
export function toggleDoc(selectedIds, docId) {
  const next = new Set(selectedIds.map(String));
  const id = String(docId);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return Array.from(next);
}

/**
 * Toggle a whole folder: if all its docs are selected, deselect them; else
 * select them all.
 */
export function toggleGroup(selectedIds, documents, groupId) {
  const ids = docsInGroup(documents, groupId).map((d) => String(d.id));
  const set = new Set(selectedIds.map(String));
  const allOn = ids.length > 0 && ids.every((id) => set.has(id));
  if (allOn) ids.forEach((id) => set.delete(id));
  else ids.forEach((id) => set.add(id));
  return Array.from(set);
}

/** Select-all / clear-all across every document. */
export function toggleAll(selectedIds, documents) {
  const ids = (documents || []).map((d) => String(d.id));
  const set = new Set(selectedIds.map(String));
  const allOn = ids.length > 0 && ids.every((id) => set.has(id));
  return allOn ? [] : ids;
}

/**
 * Tri-state of a folder's checkbox: "all" | "some" | "none".
 */
export function groupState(selectedIds, documents, groupId) {
  const ids = docsInGroup(documents, groupId).map((d) => String(d.id));
  if (ids.length === 0) return "none";
  const set = new Set(selectedIds.map(String));
  const on = ids.filter((id) => set.has(id)).length;
  if (on === 0) return "none";
  if (on === ids.length) return "all";
  return "some";
}

/** Tri-state of the master "select all" checkbox. */
export function allState(selectedIds, documents) {
  const ids = (documents || []).map((d) => String(d.id));
  if (ids.length === 0) return "none";
  const set = new Set(selectedIds.map(String));
  const on = ids.filter((id) => set.has(id)).length;
  if (on === 0) return "none";
  if (on === ids.length) return "all";
  return "some";
}
