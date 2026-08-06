// src/features/admin/pages/DocumentManagement.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./UserManagement.css";
import "./DocumentManagement.css";
import { ReactComponent as AddIcon } from "assets/images/add.svg";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { ReactComponent as EditIcon } from "assets/images/edit.svg";
import { ReactComponent as FolderStarIcon } from "assets/images/folder-star.svg";
import { ReactComponent as ReportIcon } from "assets/images/report.svg";
import { ReactComponent as EyeIcon } from "assets/images/eye.svg";
import { SearchBar } from "components";
import { AlertModal, DataTable, DeleteModal, MultiSelectDropdown } from "components/common";
import { useDocGroupStore } from "stores/useDocGroupStore";
import { useDocRepoStore } from "stores/useDocRepoStore";
import useModalStore from "stores/useModalStore";
import useAuthStore from "stores/useAuthStore";
import usePageTitleStore from "stores/usePageTitleStore";
import { docScreenTitle } from "features/admin/utils/screenTitle";
import DocGroupFormModal from "features/admin/components/DocGroupFormModal";
import DocumentEditModal from "features/admin/components/DocumentEditModal";
import DocumentUploadModal from "features/admin/components/DocumentUploadModal";
// Story 39: reuse the chat DocumentViewer to preview a repo doc in-place. Import
// the component directly (NOT via a barrel) so it renders in jsdom tests.
import DocumentViewer from "features/documents/components/viewer/DocumentViewer";
// Story 40: reuse the chat viewer's draggable divider + clamp helpers so the
// preview pane is horizontally resizable (Figma sticky-note 1044-27235).
import ResizeHandle from "features/documents/components/viewer/ResizeHandle";
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
} from "features/documents/components/viewer/viewerUtils";
import {
  getAdminDocumentPages,
  fetchAdminDocumentFile,
  fetchAdminPageImage,
  getUnits,
} from "features/admin/api";
import { isRepoSuperAdmin, ROOT_UNIT_ID } from "lib/roles";

// Story 68: the commander role ("Chỉ huy") acts as a super-admin within the
// repository domain (must focus a unit, may pick any) even though is_admin is
// false — so the focus flow keys off isRepoSuperAdmin, not is_admin alone.

const NAV_ITEMS = [
  { key: "documents", label: "Quản lý kho tài liệu", Icon: FolderStarIcon },
  { key: "groups", label: "Quản lý nhóm tài liệu", Icon: ReportIcon },
];

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("vi-VN");
}

// Story 34: map a document's processing status to a human label, and decide
// when the "Số hoá lại" action is offered (not-yet-digitized or failed).
const STATUS_LABELS = {
  UPLOADED: "Chưa số hoá",
  PENDING: "Chưa số hoá",
  PROCESSING: "Đang xử lý",
  COMPLETED: "Đã số hoá",
  APPROVED: "Đã duyệt",
  ERROR: "Lỗi xử lý",
};
const REPROCESSABLE_STATUSES = new Set(["UPLOADED", "PENDING", "ERROR"]);

// Bug 1: statuses that are NOT terminal — a document sitting on one of these has
// an outcome nobody has written down yet, so the status poll below must keep
// asking. COMPLETED / ERROR / APPROVED are terminal (see
// document.py::repository_document_status, which short-circuits on exactly those).
const NON_TERMINAL_STATUSES = new Set(["PROCESSING", "PENDING", "UPLOADED"]);

// Story 49: map a status to a colour variant so the column reads at a glance
// (approved=green, completed=blue, processing=amber, not-digitized=grey,
// error=red). Unknown → neutral grey (never breaks the badge).
const STATUS_VARIANTS = {
  UPLOADED: "pending",
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  APPROVED: "approved",
  ERROR: "error",
};

function statusLabel(status) {
  if (!status) return "-";
  return STATUS_LABELS[String(status).toUpperCase()] || status;
}

function statusVariant(status) {
  return STATUS_VARIANTS[String(status || "").toUpperCase()] || "neutral";
}

// Story 49: a coloured pill for the "Trạng thái" column.
function StatusBadge({ status, label }) {
  return (
    <span className={`dm-status dm-status--${statusVariant(status)}`}>
      {label}
    </span>
  );
}

function canReprocess(status) {
  return REPROCESSABLE_STATUSES.has(String(status || "").toUpperCase());
}

export default function DocumentManagement() {
  const [activeTab, setActiveTab] = useState("documents");
  // Story 45: the group whose name was clicked in the groups tab. While set, the
  // documents tab is filtered to this group and uploads default into it. Null =
  // entered via the left nav (current behaviour: no preset, no default group).
  const [groupContextId, setGroupContextId] = useState(null);

  const { showModal, hideModal } = useModalStore();

  // Document groups are server-backed (store-driven).
  const {
    items: groups,
    total: groupTotal,
    page: groupPage,
    pageSize: groupPageSize,
    loading: groupLoading,
    error: groupError,
    fetchGroups,
    setPage: setGroupPage,
    createGroup,
    updateGroup,
    deleteGroup,
  } = useDocGroupStore();
  const [groupSearch, setGroupSearch] = useState("");

  // Repository documents are server-backed (store-driven).
  const {
    items: documents,
    total: docTotal,
    page: docPage,
    pageSize: docPageSize,
    groupIds: docGroupIds,
    loading: docLoading,
    error: docError,
    focusUnitId,
    fetchDocuments,
    setPage: setDocPage,
    setGroupFilter,
    resetFilters: resetDocFilters,
    setFocusUnit,
    resetFocus,
    uploadDocument,
    updateDocument,
    deleteDocument,
    replaceDocumentFile,
    processing: docProcessing,
    processDocument,
    syncDocumentStatus,
    approveDocument,
    // Story 54: mark a doc read when opened (clears its unread highlight +
    // decrements the header badge); refresh the badge count on tab enter.
    markDocumentRead,
    fetchUnreadCount,
  } = useDocRepoStore();
  const [docSearch, setDocSearch] = useState("");

  const { user } = useAuthStore();

  // Story 117: push the header title for the active tab (single source of truth).
  const setPageTitle = usePageTitleStore((s) => s.setTitle);
  // Story 123: render the title inside the panel (top of the left menu).
  const pageTitle = usePageTitleStore((s) => s.title);
  const focusUnitName = useDocRepoStore((s) => s.focusUnitName);
  useEffect(() => {
    setPageTitle(
      docScreenTitle(activeTab, { focusUnitName, unitName: user?.unit_name })
    );
    return () => setPageTitle("");
  }, [activeTab, focusUnitName, user?.unit_name, setPageTitle]);

  // Story 68: VIEW/focus (browse every unit, pick a focus) keys off the repo
  // super-admin — TRUE for both the super admin and the commander ("Chỉ huy").
  const superAdmin = isRepoSuperAdmin(user);
  // Story 101: WRITE (Upload / Thêm nhóm / row Sửa·Xoá·Số hoá) is gated on
  // `is_admin` — the super admin and unit admins have it; the commander
  // (is_admin=false) is VIEW-ONLY, so all write controls are hidden for it.
  const canWrite = Boolean(user?.is_admin);

  // Story 39: the document currently open in the in-place viewer ({id, name}),
  // or null. Repo docs are read via admin-scoped routes (require_admin +
  // find_visible), injected into the shared DocumentViewer as `loaders` so it
  // needs no chat conversation context.
  const [viewerDoc, setViewerDoc] = useState(null);
  // Story 91: units for the toolbar unit dropdown (super-admin only). Replaces
  // the old "Đơn vị" button + UnitFocusModal popup.
  const [units, setUnits] = useState([]);
  // Story 40: viewer-pane width fraction (right side), draggable via ResizeHandle.
  // Resets to the default each open (not persisted), mirroring the chat viewer.
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const splitRef = useRef(null);
  const getSplitRect = React.useCallback(
    () => splitRef.current?.getBoundingClientRect(),
    []
  );
  const viewerLoaders = useMemo(
    () =>
      viewerDoc
        ? {
            pages: () => getAdminDocumentPages(viewerDoc.id),
            file: () => fetchAdminDocumentFile(viewerDoc.id),
            pageImage: (pageNo) => fetchAdminPageImage(viewerDoc.id, pageNo),
          }
        : null,
    [viewerDoc]
  );
  // NOTE: the focus unit persists across this screen's lifetime (sessionStorage,
  // hydrated in the store) so F5 keeps the chosen unit. It is cleared on LOGOUT
  // (see App.handleLogout), not on unmount.

  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));
  // Story 91: options for the single-select unit dropdown (super-admin toolbar).
  const unitOptions = units.map((u) => ({ value: u.id, label: u.name }));

  // Load groups when either tab is active: the groups tab lists them, the
  // documents tab needs them for the filter dropdown + edit modal.
  useEffect(() => {
    if (activeTab === "groups") {
      // Story 80: super-admin/commander default to ALL units' groups (no forced
      // focus — mirrors the documents tab, story 78); a unit admin lists their own
      // (unitId null → backend uses their unit). A super-admin may still focus a
      // unit (filter) → list just that unit's groups.
      fetchGroups({ page: 1, unitId: superAdmin ? focusUnitId : null });
    }
    if (activeTab === "documents") {
      // Story 54: refresh the unread badge when entering the repository screen.
      fetchUnreadCount();
      // Story 45: entered via a group name → preset the filter to that group;
      // entered via the left nav (groupContextId null) → reset as before. The
      // preset must SURVIVE this on-enter reset, so it replaces it (one fetch),
      // not run after resetDocFilters() which would clear it.
      const applyEntryFilter = () => {
        if (groupContextId != null) {
          fetchDocuments({ search: "", groupIds: [groupContextId] });
        } else {
          resetDocFilters();
        }
      };
      if (superAdmin) {
        // Story 78: default to the ALL-UNITS list (no forced focus). When a unit
        // IS focused (filter), load that unit's groups for the dropdowns (story 77).
        if (focusUnitId != null) fetchGroups({ page: 1, unitId: focusUnitId });
        applyEntryFilter();
      } else {
        // Unit admin: never send a focus unit. Clear any leftover focus (e.g.
        // persisted from a prior super-admin session in the same tab) so the
        // list isn't scoped to a foreign unit → BE 403 (story-12 bug).
        resetFocus();
        fetchGroups({ page: 1, unitId: null });
        applyEntryFilter();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Story 46: poll non-terminal docs so "Đang xử lý" auto-advances to "Đã số hoá"
  // (or "Lỗi xử lý") without a manual refresh. `GET /admin/documents/{id}/status`
  // reads the AI ingest task and writes the terminal status back — and it is the
  // ONLY thing that ever does (document.py::repository_document_status says so in
  // as many words). Nothing server-side finalizes a document, so whatever this
  // poll misses stays PROCESSING in Postgres indefinitely, which is not cosmetic:
  // the AI retrieves COMPLETED documents only, so a doc stuck here is silently
  // absent from every answer.
  //
  // Bug 1 (2026-07-30) — measured on the real stack: a .txt that ingests in a few
  // seconds still read PROCESSING in the list 200s later, and flipped the instant
  // a single /status call was made. Three ways the old poll left docs behind:
  //   1. it stopped after 100 ticks (~5 min) — a scanned PDF outlives that;
  //   2. it only matched the exact string "PROCESSING", so a queued doc
  //      (PENDING — what _process_repo_document stores when the task is not
  //      running yet) was never pulled at all;
  //   3. it never resumed after the tab was backgrounded.
  // So: cover every non-terminal status, run until they are all terminal, and
  // back off instead of giving up (3s while the user is likely watching, then
  // 10s) so a 30-minute OCR still lands without the browser hammering the API.
  const processingIds = useMemo(
    () =>
      documents
        .filter((d) => NON_TERMINAL_STATUSES.has(String(d.status).toUpperCase()))
        .map((d) => d.id),
    [documents]
  );
  const processingKey = processingIds.join(",");
  useEffect(() => {
    if (activeTab !== "documents" || processingIds.length === 0) return undefined;
    let ticks = 0;
    let timer = null;
    const FAST_MS = 3000;
    const SLOW_MS = 10000;
    const FAST_TICKS = 40; // ~2 min at 3s, then back off — never stop
    const tick = () => {
      ticks += 1;
      // `document.hidden`: a backgrounded tab has no one to inform, and browsers
      // throttle its timers anyway. Skip the round-trip and resume on focus.
      if (!document.hidden) {
        processingIds.forEach((id) => syncDocumentStatus(id));
      }
      if (ticks === FAST_TICKS) {
        clearInterval(timer);
        timer = setInterval(tick, SLOW_MS);
      }
    };
    timer = setInterval(tick, FAST_MS);
    // Coming back to the tab pulls immediately rather than waiting out the
    // current interval — this is the moment the user expects to see the truth.
    const onVisible = () => {
      if (!document.hidden) processingIds.forEach((id) => syncDocumentStatus(id));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, processingKey]);

  // Debounced server-side search (~300ms) for the groups tab.
  useEffect(() => {
    if (activeTab !== "groups") return undefined;
    const t = setTimeout(() => fetchGroups({ search: groupSearch }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSearch]);

  // Debounced server-side search (~300ms) for the documents tab. Story 78: a
  // super-admin with no focus now searches across ALL units (no longer skipped).
  useEffect(() => {
    if (activeTab !== "documents") return undefined;
    const t = setTimeout(() => fetchDocuments({ search: docSearch }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docSearch]);

  // Story 91: load the units for the toolbar unit dropdown (super-admin only).
  useEffect(() => {
    if (!superAdmin) return;
    getUnits({ page: 1, page_size: 100 })
      .then((data) => setUnits(data?.items || []))
      .catch(() => setUnits([]));
  }, [superAdmin]);

  // Story 102: the super admin AND commander default-focus the ROOT unit "Tổng"
  // (the command level) on entering the repository — instead of the all-units
  // view (story 78). This is their home: creating a group / uploading targets
  // Tổng immediately (no "…chọn đơn vị" error). Fires ONCE per mount, once the
  // units list is loaded (so the name comes from the unit, not hard-coded). They
  // may still pick another unit afterwards (behaves like a unit admin there).
  const didInitFocus = useRef(false);
  useEffect(() => {
    if (didInitFocus.current || !superAdmin) return;
    const root = units.find((u) => u.id === ROOT_UNIT_ID);
    if (!root) return; // wait until the units list has loaded
    didInitFocus.current = true;
    setFocusUnit(ROOT_UNIT_ID, root.name);
    fetchGroups({ page: 1, unitId: ROOT_UNIT_ID });
    fetchDocuments({ page: 1 }); // zustand set is sync → uses ROOT focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdmin, units]);

  // Story 91: the toolbar unit picker is now a single-select dropdown (like the
  // "Nhóm tài liệu" lookup). No selection = all units; picking one focuses it;
  // clearing returns to all. setFocusUnit(id|null) refetches the list either way.
  function onUnitFilterChange(next) {
    // Switching unit invalidates the open doc → close the viewer (story 39).
    setViewerDoc(null);
    const id = next && next.length ? next[0] : null;
    if (id != null) {
      const name = units.find((u) => u.id === id)?.name || "";
      setFocusUnit(id, name);
      fetchGroups({ page: 1, unitId: id }); // groups are unit-scoped (story 77)
    } else {
      setFocusUnit(null, ""); // back to all units (refetches; story 78)
      fetchGroups({ page: 1, unitId: null });
    }
  }

  // Story 45: open the repository tab scoped to a group (clicked from the groups
  // list). The [activeTab] effect reads groupContextId to preset the filter.
  function enterGroupRepo(group) {
    // Story 80: from the all-units groups list, focus the group's unit so the
    // documents tab (and its group filter) is scoped to that unit.
    if (superAdmin && group.unit_id != null) {
      setFocusUnit(group.unit_id, group.unit_name || "");
    }
    setGroupContextId(group.id);
    setActiveTab("documents");
    setGroupSearch("");
    setDocSearch("");
    setViewerDoc(null);
  }

  function openUploadModal() {
    // Story 90: a super-admin/commander defaults to the ALL-UNITS view (no unit
    // focused, story 78), but an upload needs a target unit. Instead of letting
    // the upload fail with the BE's cryptic "…trước khi xem kho" error, prompt
    // the admin to pick a unit first (via the "Đơn vị" button).
    if (superAdmin && focusUnitId == null) {
      showModal(AlertModal, {
        title: "Chọn đơn vị",
        message:
          'Vui lòng chọn đơn vị (nút "Đơn vị") trước khi tải tài liệu lên.',
      });
      return;
    }
    const targetGroupName =
      groupContextId != null
        ? groups.find((g) => g.id === groupContextId)?.name
        : undefined;
    showModal(DocumentUploadModal, {
      // Story 45: when in a group-scoped view, default the upload into that group
      // and show its name (read-only) so the user knows where it lands.
      targetGroupName,
      // Story 47: called once PER file (the modal loops over a multi-file
      // selection). Do NOT hideModal here — the modal closes itself once all
      // files succeed; closing per file would abort the rest of the batch.
      onUpload: async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        await uploadDocument(formData, groupContextId ?? undefined);
      },
    });
  }

  function openDocumentModal(doc) {
    showModal(DocumentEditModal, {
      initialValues: {
        id: doc.id,
        name: doc.name,
        doc_number: doc.doc_number,
        summary: doc.summary,
        group_id: doc.group_id,
        // Story 48: the modal offers "Đánh dấu đã duyệt" only for a COMPLETED doc.
        status: doc.status,
      },
      groups,
      onSubmit: async (payload, file, approve) => {
        // Always save metadata. If a replacement file was chosen, overwrite the
        // file content too (ghi đè, giữ chỗ trong danh sách). Story 48: after
        // saving, mark APPROVED when the admin ticked "đã duyệt" (COMPLETED only).
        await updateDocument(doc.id, payload);
        if (file) {
          // Story 62: replacing the file re-creates the document under a NEW id
          // (the old id is deleted) and re-digitizes it, so approving the old id
          // here 404s and the new content isn't reviewed yet. Skip approve on
          // replace — the admin re-approves once it finishes digitizing.
          await replaceDocumentFile(doc.id, file);
        } else if (approve) {
          await approveDocument(doc.id);
        }
        hideModal();
      },
    });
  }

  function askDeleteDocument(doc) {
    showModal(DeleteModal, {
      title: "Xoá văn bản",
      message: "Bạn chắc chắn muốn xoá văn bản này?",
      confirmLabel: "Đồng ý",
      onConfirm: async () => {
        try {
          await deleteDocument(doc.id);
          hideModal();
        } catch (e) {
          showModal(AlertModal, {
            title: "Lỗi",
            message: e?.message || "Xoá văn bản thất bại",
          });
        }
      },
    });
  }

  function openGroupModal(group) {
    const isEdit = Boolean(group);
    showModal(DocGroupFormModal, {
      mode: isEdit ? "edit" : "add",
      initialValues: isEdit ? { id: group.id, name: group.name } : undefined,
      onSubmit: async (payload) => {
        if (isEdit) {
          await updateGroup(group.id, payload);
        } else {
          // Story 81: only a unit admin reaches create (super-admin/commander's
          // group CRUD is hidden) → unit_id null = the admin's own unit (BE
          // resolves it). Story 80's super "pick a unit" pre-step was removed.
          await createGroup({ ...payload, unit_id: focusUnitId });
        }
        hideModal();
      },
    });
  }

  function askDeleteGroup(group) {
    showModal(DeleteModal, {
      title: "Xoá nhóm tài liệu",
      message:
        "Bạn chắc chắn muốn xoá nhóm tài liệu sẽ xoá toàn bộ tài liệu gắn với tên nhóm này?",
      confirmLabel: "Đồng ý",
      onConfirm: async () => {
        try {
          await deleteGroup(group.id);
          hideModal();
        } catch (e) {
          showModal(AlertModal, {
            title: "Lỗi",
            message: e?.message || "Xoá nhóm tài liệu thất bại",
          });
        }
      },
    });
  }

  // Story 54: opening a document marks it read for THIS admin (clears the unread
  // highlight + decrements the header badge optimistically), then shows it in the
  // in-place viewer. Used by both the "Xem" action and a row click.
  const openViewer = (d) => {
    setViewerDoc({ id: d.id, name: d.name });
    markDocumentRead(d.id);
  };

  // Story 50: the "Tên văn bản", "Trạng thái" and "Thao tác" cells are shared by
  // BOTH the full table and the compact set shown while the viewer is open, so
  // their renderers are defined once here and reused — only the column width
  // differs between the two sets (DRY; keeps the two arrays in sync).
  const renderNameCell = (d) => d.name || "-";
  // Story 49: render a coloured badge per status. A doc being (re)processed in
  // the UI shows the PROCESSING badge even if its persisted status differs.
  const renderStatusCell = (d) =>
    docProcessing?.[d.id] ? (
      <StatusBadge status="PROCESSING" label="Đang xử lý" />
    ) : (
      <StatusBadge status={d.status} label={statusLabel(d.status)} />
    );
  const renderActionsCell = (d) => (
    // Story 39: actions live inside a clickable row → stopPropagation so an
    // action icon doesn't also open the viewer (row onClick).
    // Story 40: keep the icons on ONE line (.dm-actions flex/nowrap) so the
    // column doesn't wrap/misalign when the preview narrows the table.
    <span className="dm-actions">
      {/* Story 39: "Xem" opens the in-place viewer — available to everyone who
          can reach this screen (incl. the view-only commander). */}
      <EyeIcon
        onClick={(e) => {
          e.stopPropagation();
          openViewer(d);
        }}
        title="Xem"
      />
      {/* Story 101: Xoá / Sửa / Số hoá lại are writes → writers only (is_admin);
          hidden for the view-only commander. Figma 859-24594: Xoá rồi Sửa. */}
      {canWrite && (
        <>
          <DeleteIcon
            onClick={(e) => {
              e.stopPropagation();
              askDeleteDocument(d);
            }}
            title="Xoá"
          />
          <EditIcon
            onClick={(e) => {
              e.stopPropagation();
              openDocumentModal(d);
            }}
            title="Sửa"
          />
          {/* Story 34: (re)digitize a doc that is not processed yet or failed. */}
          {canReprocess(d.status) && !docProcessing?.[d.id] && (
            <ReportIcon
              onClick={(e) => {
                e.stopPropagation();
                processDocument(d.id);
              }}
              title="Số hoá lại"
            />
          )}
        </>
      )}
    </span>
  );

  // Full table (viewer closed): 7 columns. Widths sum to 1308 = 100% (story 49:
  // story 34 added "Trạng thái" 120 without updating the old 1188 divisor → 110%
  // overflow that hid "Thao tác" under the viewer; 1308 = exactly 100%).
  // Story 56: no inline font-weight on the cells — the read/unread row class
  // (.dm-row--unread) drives both weight and colour (unread = teal+semibold, read
  // = dark+regular), matching Figma 1088-24989. An inline weight would override
  // the class.
  // Story 78: super-admin/commander see an extra "Đơn vị" column (which unit each
  // document belongs to) in the all-units view. Widths are kept proportional by
  // computing the divisor from the numerators actually present (1308 without the
  // unit column, 1468 with it = exactly 100%).
  const documentColumnDefs = [
    {
      label: "Trích yếu",
      render: (d) => d.summary || "-",
      num: 312,
      wordBreak: "break-word",
    },
    {
      label: "Số văn bản",
      render: (d) => d.doc_number || "-",
      num: 180,
      wordBreak: "break-all",
    },
    {
      label: "Nhóm tài liệu",
      render: (d) => d.group_name || "-",
      num: 180,
      wordBreak: "break-all",
    },
    ...(superAdmin
      ? [
          {
            label: "Đơn vị",
            render: (d) => d.unit_name || "-",
            num: 160,
            wordBreak: "break-word",
          },
        ]
      : []),
    {
      label: "Ngày tải tài liệu lên",
      render: (d) => formatDate(d.created_at),
      num: 168,
    },
    {
      label: "Tên văn bản",
      render: renderNameCell,
      num: 200,
      wordBreak: "break-all",
    },
    {
      // Story 34: surface the digitization status so the admin can spot docs
      // stuck "Chưa số hoá" and reprocess them.
      label: "Trạng thái",
      render: renderStatusCell,
      num: 120,
    },
    {
      label: "Thao tác",
      render: renderActionsCell,
      num: 148,
    },
  ];
  const columnDivisor = documentColumnDefs.reduce((s, c) => s + c.num, 0);
  const documentColumns = documentColumnDefs.map(({ num, ...c }) => ({
    ...c,
    width: `calc(100% * ${num} / ${columnDivisor})`,
  }));

  // Story 50: compact set shown while the in-place viewer is open (list pane only
  // ~58% wide, viewer 42%). Only the essentials — name to identify, status, and
  // the actions — so the narrow table reads cleanly without ugly wrapping or a
  // horizontal scrollbar. Widths sum to 100% (Tên 45 · Trạng thái 25 · Thao tác 30).
  const compactDocumentColumns = [
    {
      label: "Tên văn bản",
      render: renderNameCell,
      width: "calc(100% * 45 / 100)",
      wordBreak: "break-all",
    },
    {
      label: "Trạng thái",
      render: renderStatusCell,
      width: "calc(100% * 25 / 100)",
    },
    {
      label: "Thao tác",
      render: renderActionsCell,
      width: "calc(100% * 30 / 100)",
    },
  ];

  const groupColumns = [
    {
      label: "Tên nhóm tài liệu",
      // Story 45: the name is a link → open the repository tab filtered by this
      // group (uploads from there default into it). The "Thao tác" icons live in
      // a separate column, so editing/deleting never triggers this navigation.
      render: (g) => (
        <button
          type="button"
          className="dm-group-link"
          onClick={() => enterGroupRepo(g)}
        >
          {g.name || "-"}
        </button>
      ),
      width: "auto",
      style: { fontWeight: 600 },
    },
    // Story 80: super-admin/commander see which unit each group belongs to in the
    // all-units view (mirrors the documents "Đơn vị" column, story 78).
    ...(superAdmin
      ? [
          {
            label: "Đơn vị",
            render: (g) => g.unit_name || "-",
            width: "20%",
            style: { fontWeight: 500 },
          },
        ]
      : []),
    // Story 101: only writers (super admin + unit admin) get the Sửa/Xóa column;
    // the commander is view-only, so it's hidden for them.
    ...(canWrite
      ? [
          {
            label: "Thao tác",
            width: "8vw",
            style: { fontWeight: 450 },
            render: (g) => (
              <>
                <EditIcon onClick={() => openGroupModal(g)} title="Sửa" />
                <DeleteIcon onClick={() => askDeleteGroup(g)} title="Xoá" />
              </>
            ),
          },
        ]
      : []),
  ];

  function renderDocumentsPanel() {
    // Story 78: super-admin/commander default to the ALL-UNITS list (no forced
    // focus); they may still focus a single unit via the toolbar as a filter.
    const listContent = (
      <>
        <div className="toolbar">
          <SearchBar
            placeholder="Tìm kiếm"
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
          />
          <MultiSelectDropdown
            options={groupOptions}
            selected={docGroupIds}
            onChange={(next) => setGroupFilter(next)}
            placeholder="Nhóm tài liệu"
            searchPlaceholder="Tìm nhóm tài liệu"
            emptyMessage="Chưa có nhóm tài liệu nào."
          />
          {/* Story 91: unit picker = single-select dropdown like "Nhóm tài liệu"
              (replaces the old "Đơn vị" button + UnitFocusModal popup + separate
              "Tất cả đơn vị" button). No selection = all units. */}
          {superAdmin && (
            <MultiSelectDropdown
              single
              options={unitOptions}
              selected={focusUnitId != null ? [focusUnitId] : []}
              onChange={onUnitFilterChange}
              placeholder="Tất cả đơn vị"
              searchPlaceholder="Tìm đơn vị"
              emptyMessage="Chưa có đơn vị nào."
            />
          )}
          {/* Story 101: commander is view-only → hide Upload (writers only). */}
          {canWrite && (
            <button
              type="button"
              className="add-user-btn"
              onClick={openUploadModal}
            >
              <AddIcon />
              <span className="add-user-btn__label">Upload văn bản</span>
            </button>
          )}
        </div>

        <DataTable
          // Story 50: while the viewer is open the list pane is narrow (~58%) —
          // collapse to the compact column set so the table stays readable and
          // never overflows; show the full 7 columns when the viewer is closed.
          columns={viewerDoc ? compactDocumentColumns : documentColumns}
          data={documents}
          loading={docLoading}
          error={docError}
          emptyMessage="Chưa có tài liệu nào."
          page={docPage}
          limit={docPageSize}
          totalCount={docTotal}
          onPageChange={(p) => setDocPage(p)}
          totalTextFormat={(t) =>
            `Tổng cộng ${t.toLocaleString("vi-VN")} tài liệu`
          }
          // Story 39: click a row to view it; the open doc's row stays highlighted.
          // Story 54: opening also marks it read (clears the unread highlight).
          onRowClick={(row) => openViewer(row)}
          activeRowId={viewerDoc?.id ?? null}
          // Story 54: bold + dot the rows this admin has not read yet (Figma
          // 1088-24989). Compact set (viewer open) keeps the same highlight.
          rowClassName={(row) => (row.is_unread ? "dm-row--unread" : "")}
        />
      </>
    );

    // Story 39: when a document is open, split the panel — list on the left,
    // the in-place viewer on the right (Figma 1044-26920).
    // Story 40: a draggable ResizeHandle between them resizes the preview width
    // (ratioFromPointer reports the LIST fraction → viewer fraction = 1 - r).
    if (!viewerDoc) return listContent;
    return (
      <div className="dm-split" ref={splitRef}>
        <div className="dm-list">{listContent}</div>
        <ResizeHandle
          onResize={(r) => setSplitRatio(clampSplitRatio(1 - r))}
          getContainerRect={getSplitRect}
        />
        <div
          className="dm-viewer"
          // Story 60: no Math.round — keep sub-percent precision so the
          // committed pane lands exactly where the drag ghost did (N4: divider
          // tracks the cursor instead of snapping in ~1% steps).
          style={{ flex: `0 0 ${(splitRatio * 100).toFixed(2)}%` }}
        >
          <DocumentViewer
            documentId={viewerDoc.id}
            documentName={viewerDoc.name}
            loaders={viewerLoaders}
            onClose={() => setViewerDoc(null)}
          />
        </div>
      </div>
    );
  }

  function renderGroupsPanel() {
    return (
      <>
        <div className="toolbar">
          <SearchBar
            placeholder="Tìm theo tên nhóm tài liệu"
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
          />
          {/* Story 101: only writers (super admin at command level + unit admin
              in their own unit) create groups. The commander is view-only. */}
          {canWrite && (
            <button
              type="button"
              className="add-user-btn"
              onClick={() => openGroupModal(null)}
            >
              <AddIcon />
              <span className="add-user-btn__label">Thêm nhóm tài liệu</span>
            </button>
          )}
        </div>

        <DataTable
          columns={groupColumns}
          data={groups}
          loading={groupLoading}
          error={groupError}
          emptyMessage="Chưa có nhóm tài liệu nào."
          page={groupPage}
          limit={groupPageSize}
          totalCount={groupTotal}
          onPageChange={(p) => setGroupPage(p)}
          totalTextFormat={(t) =>
            `Tổng cộng ${t.toLocaleString("vi-VN")} nhóm tài liệu`
          }
        />
      </>
    );
  }

  return (
    <div className="user-mgmt-layout">
      <aside className="um-sidebar">
        <div className="um-sidebar__header">
          <h2 className="um-sidebar__title">
            {pageTitle ||
              docScreenTitle(activeTab, {
                focusUnitName,
                unitName: user?.unit_name,
              })}
          </h2>
        </div>
        <nav className="um-sidebar__nav">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`um-nav-item${activeTab === key ? " um-nav-item--active" : ""}`}
              onClick={() => {
                setActiveTab(key);
                // Story 45: entering via the left nav is the plain flow — drop any
                // group context so the documents tab is NOT preset/filtered and
                // uploads don't default into a group.
                setGroupContextId(null);
                // Local search inputs reset here; the store filter (groupIds +
                // server search) is reset by the [activeTab] effect on enter.
                setGroupSearch("");
                setDocSearch("");
                // Story 39: leaving the documents tab closes the viewer.
                setViewerDoc(null);
              }}
            >
              <Icon className="um-nav-item__icon" />
              <span className="um-nav-item__label">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="user-mgmt">
        {activeTab === "documents"
          ? renderDocumentsPanel()
          : renderGroupsPanel()}
      </div>
    </div>
  );
}
