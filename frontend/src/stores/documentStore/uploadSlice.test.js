// src/stores/documentStore/uploadSlice.test.js
import { createUploadSlice } from "stores/documentStore/uploadSlice";
import {
  uploadConversationFile,
  processDocument,
} from "features/documents/api";

jest.mock("features/documents/api");

/**
 * Build a minimal Zustand-like store wired to the upload slice so we can
 * exercise the two-phase upload+process orchestration in isolation.
 */
function makeStore(initial = {}) {
  let state = {
    pending: [],
    documents: [],
    numDocuments: 0,
    pollingTasks: {},
    conversationId: "1",
    ...initial,
  };
  const set = (fn) => {
    const patch = typeof fn === "function" ? fn(state) : fn;
    state = { ...state, ...patch };
  };
  const get = () => ({ ...state, ...slice });
  const slice = createUploadSlice(set, get);
  return { slice, getState: () => state };
}

const file = (name) => ({ name });

test("uploadFiles_uploadOkProcessFails_countsDocumentOnceAsFailure", async () => {
  // One file: upload succeeds, processing fails.
  uploadConversationFile.mockResolvedValue({
    document_id: "doc-1",
    documents: [{ id: "doc-1", name: "a.pdf", status: "UPLOADED" }],
  });
  processDocument.mockRejectedValue(new Error("Lỗi kết nối từ dịch vụ AI"));

  const { slice, getState } = makeStore();
  const result = await slice.uploadFiles("1", "1", [file("a.pdf")]);

  // Per-document outcome: a doc that uploaded but failed to process is a
  // single failure — never both a success and a failure.
  expect(result.successCount).toBe(0);
  expect(result.errorCount).toBe(1);
  expect(result.successCount + result.errorCount).toBe(1);

  // The document must not be left in a perpetual loading state (UPLOADED
  // renders as a spinner). A failed process marks it ERROR so the UI stops
  // spinning and the row becomes interactive.
  const doc = getState().documents.find((d) => d.id === "doc-1");
  expect(doc.status).toBe("ERROR");
});

test("uploadFiles_uploadAndProcessOk_countsDocumentOnceAsSuccess", async () => {
  uploadConversationFile.mockResolvedValue({
    document_id: "doc-1",
    documents: [{ id: "doc-1", name: "a.pdf", status: "UPLOADED" }],
  });
  processDocument.mockResolvedValue({ status: "PROCESSING", task_id: "t-1" });

  const { slice } = makeStore();
  const result = await slice.uploadFiles("1", "1", [file("a.pdf")]);

  expect(result.successCount).toBe(1);
  expect(result.errorCount).toBe(0);
});

// ── Story 28: linked repository docs survive a new upload ────────────────────

test("uploadFiles_keepsLinkedRepoDocs_afterUpload", async () => {
  // A repository doc (from_repository) is already linked into the conversation.
  // The upload response only carries find_by_conversation docs (NO repo docs),
  // so a wholesale replace would drop it. It must be kept.
  uploadConversationFile.mockResolvedValue({
    document_id: "u1",
    documents: [{ id: "u1", name: "new.pdf", status: "UPLOADED" }],
  });
  processDocument.mockResolvedValue({ status: "PROCESSING", task_id: "t" });

  const { slice, getState } = makeStore({
    documents: [{ id: "r1", name: "kho.pdf", from_repository: true }],
  });
  await slice.uploadFiles("1", "1", [file("new.pdf")]);

  const ids = getState().documents.map((d) => d.id);
  expect(ids).toContain("r1"); // repo doc kept
  expect(ids).toContain("u1"); // new upload present
  // The kept repo doc retains its flag (DocumentSelect still treats it as repo).
  const repo = getState().documents.find((d) => d.id === "r1");
  expect(repo.from_repository).toBe(true);
});

test("uploadFiles_doesNotDuplicateRepoDoc_whenResponseAlreadyHasIt", async () => {
  // If the upload response happens to include the repo doc, it must not double.
  uploadConversationFile.mockResolvedValue({
    document_id: "u1",
    documents: [
      { id: "u1", name: "new.pdf", status: "UPLOADED" },
      { id: "r1", name: "kho.pdf", from_repository: true },
    ],
  });
  processDocument.mockResolvedValue({ status: "PROCESSING", task_id: "t" });

  const { slice, getState } = makeStore({
    documents: [{ id: "r1", name: "kho.pdf", from_repository: true }],
  });
  await slice.uploadFiles("1", "1", [file("new.pdf")]);

  const r1Count = getState().documents.filter((d) => d.id === "r1").length;
  expect(r1Count).toBe(1);
});
