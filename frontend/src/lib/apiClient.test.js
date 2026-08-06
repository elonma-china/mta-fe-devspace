// src/lib/apiClient.test.js
import { requestPostBlob } from "./apiClient";

function blobResponse(contentDisposition) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) =>
        name.toLowerCase() === "content-disposition" ? contentDisposition : null,
    },
    blob: async () => new Blob(["pk"]),
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
});

test("test_request_post_blob_reads_the_rfc5987_filename", async () => {
  global.fetch.mockResolvedValue(
    blobResponse(
      "attachment; filename=\"phatbieu_20260725_1435.docx\"; " +
        "filename*=UTF-8''phatbieu_20260725_1435.docx"
    )
  );
  const { blob, filename } = await requestPostBlob("/draft/export", { body: {} });
  expect(filename).toBe("phatbieu_20260725_1435.docx");
  expect(blob).toBeInstanceOf(Blob);
});

test("test_request_post_blob_percent_decodes_the_rfc5987_filename", async () => {
  global.fetch.mockResolvedValue(
    blobResponse("attachment; filename=\"bao_cao.docx\"; filename*=UTF-8''b%C3%A1o.docx")
  );
  const { filename } = await requestPostBlob("/draft/export", { body: {} });
  expect(filename).toBe("báo.docx");
});

test("test_request_post_blob_falls_back_to_the_quoted_filename", async () => {
  global.fetch.mockResolvedValue(
    blobResponse('attachment; filename="tonghop_20260725_0912.docx"')
  );
  const { filename } = await requestPostBlob("/draft/export", { body: {} });
  expect(filename).toBe("tonghop_20260725_0912.docx");
});

test("test_request_post_blob_returns_null_filename_when_header_is_absent", async () => {
  global.fetch.mockResolvedValue(blobResponse(null));
  const { blob, filename } = await requestPostBlob("/draft/export", { body: {} });
  expect(filename).toBeNull();
  expect(blob).toBeInstanceOf(Blob);
});
