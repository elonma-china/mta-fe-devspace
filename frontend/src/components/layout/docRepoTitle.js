// src/components/layout/docRepoTitle.js

/**
 * Title for the admin document-repository screen. The unit being VIEWED wins:
 * a super-admin who focuses another unit shows that unit (focusUnitName), while
 * a unit admin shows their own unit (unitName). Empty → no unit suffix.
 *
 * @param {{ focusUnitName?: string, unitName?: string }} args
 * @returns {string}
 */
export function docRepoTitle({ focusUnitName, unitName } = {}) {
  const display = focusUnitName || unitName;
  return display
    // Story 122: unit NAME only — the label "đơn vị" was redundant (the unit
    // picker already shows it), matching UnitRepository's title (story 116 #6).
    ? `Quản lý kho tài liệu - ${display}`
    : "Quản lý kho tài liệu";
}
