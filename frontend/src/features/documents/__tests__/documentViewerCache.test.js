// src/features/documents/__tests__/documentViewerCache.test.js
import React from "react";
import { render, waitFor } from "@testing-library/react";

jest.mock("react-markdown", () => (props) => <div>{props.children}</div>);
jest.mock("assets/images/x.svg", () => ({
  ReactComponent: () => <span data-testid="x-icon" />,
}));

import DocumentViewer from "../components/viewer/DocumentViewer";
import useViewerCacheStore from "stores/useViewerCacheStore";

describe("DocumentViewer uses the viewer cache", () => {
  beforeEach(() => {
    useViewerCacheStore.getState().clearViewerCache();
    global.URL.createObjectURL = jest.fn(() => "blob:cached");
    global.URL.revokeObjectURL = jest.fn();
  });

  test("test_remount_same_document_loads_file_and_pages_once", async () => {
    const pdfBlob = new Blob(["%PDF"], { type: "application/pdf" });
    const loaders = {
      pages: jest.fn(async () => ({
        pages: [{ page_number: 1, content: "trang 1" }],
        page_count: 1,
      })),
      file: jest.fn(async () => pdfBlob),
    };

    const { unmount } = render(
      <DocumentViewer documentId="doc-1" documentName="tt.pdf" loaders={loaders} />
    );
    await waitFor(() => expect(loaders.file).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(loaders.pages).toHaveBeenCalledTimes(1));
    unmount();

    // Reopen the same document — the cache must serve both fetches.
    render(
      <DocumentViewer documentId="doc-1" documentName="tt.pdf" loaders={loaders} />
    );
    // Give any (wrong) refetch a chance to fire before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(loaders.file).toHaveBeenCalledTimes(1);
    expect(loaders.pages).toHaveBeenCalledTimes(1);
  });

  test("test_different_document_still_loads", async () => {
    const mk = () => ({
      pages: jest.fn(async () => ({ pages: [], page_count: 0 })),
      file: jest.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
    });
    const l1 = mk();
    const l2 = mk();
    const { unmount } = render(
      <DocumentViewer documentId="doc-1" documentName="a.pdf" loaders={l1} />
    );
    await waitFor(() => expect(l1.file).toHaveBeenCalledTimes(1));
    unmount();
    render(<DocumentViewer documentId="doc-2" documentName="b.pdf" loaders={l2} />);
    await waitFor(() => expect(l2.file).toHaveBeenCalledTimes(1));
  });
});
