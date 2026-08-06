// src/features/documents/__tests__/documentSelectFolderMenu.test.js
//
// Story 98 → 99: the repo "Kho tài liệu" folder row in the chat document tree
// has a ⋮ action menu. Story 99 UNIFIES it to a single action for every role —
// only "Gỡ toàn bộ khỏi hội thoại" (unlink every repo doc in the group from the
// conversation; the repository copy stays). The story-98 "Sửa tên nhóm tài liệu"
// option was removed: renaming a group from chat hit the group's owning-unit
// scope and failed with 404 "Không tìm thấy nhóm tài liệu", so it no longer
// appears here (group rename lives on the admin screen, correctly scoped).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import DocumentSelect from "features/documents/components/DocumentSelect";

// ── ActionMenu mock: render the enabled items from the show-flags so we can
// assert which options the folder menu exposes and trigger onAction. ──
jest.mock("components", () => ({
  ActionMenu: (props) =>
    !props.open ? null : (
      <div data-testid="action-menu">
        {props.showPreview !== false && (
          <button onClick={() => props.onAction("preview")}>
            {props.previewLabel || "Xem tài liệu"}
          </button>
        )}
        {props.showRename !== false && (
          <button onClick={() => props.onAction("rename")}>
            {props.editLabel || "Sửa tên tài liệu"}
          </button>
        )}
        {props.showDelete !== false && (
          <button onClick={() => props.onAction("delete")}>
            {props.deleteLabel || "Xoá tài liệu"}
          </button>
        )}
      </div>
    ),
}));

jest.mock("components/common", () => ({
  AlertModal: () => null,
  DeleteModal: () => null,
  EditModal: () => null,
  PreviewModal: () => null,
}));
jest.mock("assets/images/more-vert.svg", () => ({
  ReactComponent: () => <span data-testid="more-icon" />,
}));
jest.mock("hooks/useTaskPoller", () => ({ useTaskPoller: () => {} }));

const mockUnlink = jest.fn().mockResolvedValue({});
jest.mock("features/documents/api", () => ({
  getDocumentTaskStatus: jest.fn(),
  updateDocumentStatus: jest.fn(),
  unlinkRepositoryDoc: (...a) => mockUnlink(...a),
}));

const mockShowModal = jest.fn();
const mockHideModal = jest.fn();
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: mockShowModal, hideModal: mockHideModal }),
}));

const mockFetchDocuments = jest.fn().mockResolvedValue({});
jest.mock("stores/useDocumentStore", () => {
  const docState = {
    documents: [
      { id: "r2", name: "doc4.pdf", status: "COMPLETED", from_repository: true, group_id: 5, group_name: "Kế hoạch" },
      { id: "r3", name: "Doc5.doc", status: "COMPLETED", from_repository: true, group_id: 5, group_name: "Kế hoạch" },
    ],
    selectedDocumentIds: [],
    setSelectedDocumentIds: jest.fn(),
    pollingTasks: {},
    pending: [],
    fetchDocuments: (...a) => mockFetchDocuments(...a),
    updateDocumentStatus: jest.fn(),
    completePolling: jest.fn(),
    deleteDocument: jest.fn(),
    renameDocument: jest.fn(),
    connectSSE: jest.fn(),
    disconnectSSE: jest.fn(),
    sseFallback: false,
  };
  const fn = () => docState;
  fn.getState = () => docState;
  return { __esModule: true, default: fn };
});
jest.mock("stores/useChatStore", () => {
  const st = { selectedConvId: "c1" };
  const fn = () => st;
  fn.getState = () => st;
  return { __esModule: true, default: fn };
});

// useAuthStore is set per-test to control the admin gate.
let mockUser = { id: "u1" };
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: mockUser }),
}));

beforeEach(() => {
  mockUnlink.mockClear();
  mockFetchDocuments.mockClear();
  mockShowModal.mockClear();
  mockHideModal.mockClear();
});

function openFolderMenu() {
  const folderRow = screen.getByText("Kế hoạch").closest(".ds-folder-row");
  const moreBtn = folderRow.querySelector(".ds-morebtn");
  expect(moreBtn).toBeTruthy();
  fireEvent.click(moreBtn);
  return moreBtn;
}

function lastModalProps(Comp) {
  const call = [...mockShowModal.mock.calls].reverse().find((c) => c[0] === Comp);
  return call ? call[1] : null;
}

test("folderRow_hasMoreButton", () => {
  mockUser = { id: "u1", is_admin: false };
  render(<DocumentSelect />);
  const folderRow = screen.getByText("Kế hoạch").closest(".ds-folder-row");
  expect(folderRow.querySelector(".ds-morebtn")).toBeTruthy();
});

// Story 99: the folder menu is unified — only "Gỡ toàn bộ khỏi hội thoại" for
// EVERY role; "Sửa tên nhóm tài liệu" was removed (it hit the group's owning-unit
// scope and 404'd from chat).
test("folderMenu_admin_onlyRemoveAll_noRename", () => {
  mockUser = { id: "u1", is_admin: true, unit_id: 2 }; // unit admin
  render(<DocumentSelect />);
  openFolderMenu();
  expect(screen.queryByText("Sửa tên nhóm tài liệu")).not.toBeInTheDocument();
  expect(screen.getByText("Gỡ toàn bộ khỏi hội thoại")).toBeInTheDocument();
});

test("folderMenu_nonAdmin_onlyRemoveAll", () => {
  mockUser = { id: "u1", is_admin: false };
  render(<DocumentSelect />);
  openFolderMenu();
  expect(screen.queryByText("Sửa tên nhóm tài liệu")).not.toBeInTheDocument();
  expect(screen.getByText("Gỡ toàn bộ khỏi hội thoại")).toBeInTheDocument();
});

test("folderMenu_superAdmin_onlyRemoveAll", () => {
  mockUser = { id: "u1", is_admin: true, unit_id: 1 }; // super admin (root unit)
  render(<DocumentSelect />);
  openFolderMenu();
  expect(screen.queryByText("Sửa tên nhóm tài liệu")).not.toBeInTheDocument();
  expect(screen.getByText("Gỡ toàn bộ khỏi hội thoại")).toBeInTheDocument();
});

test("folderMenu_removeAll_unlinksEveryDocInGroup", async () => {
  mockUser = { id: "u1", is_admin: false };
  render(<DocumentSelect />);
  openFolderMenu();
  fireEvent.click(screen.getByText("Gỡ toàn bộ khỏi hội thoại"));
  const props = lastModalProps(require("components/common").DeleteModal);
  expect(props).toBeTruthy();
  await props.onConfirm();
  expect(mockUnlink).toHaveBeenCalledTimes(2);
  expect(mockUnlink).toHaveBeenCalledWith("u1", "c1", "r2");
  expect(mockUnlink).toHaveBeenCalledWith("u1", "c1", "r3");
});
