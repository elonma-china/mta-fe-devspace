// src/features/documents/__tests__/uploadFileSection.test.js
import React from "react";
import { render, screen } from "@testing-library/react";

import UploadFileSection from "features/documents/components/UploadFileSection";
import { getEnv } from "config";

jest.mock("assets/images/upload-file.svg", () => ({
  ReactComponent: () => <span data-testid="upload-icon" />,
}));

// Control the env lookup: when no value is configured, getEnv returns the
// component's widened DEFAULT (story 24). We assert the file input's accept.
jest.mock("config", () => ({
  getEnv: jest.fn(),
}));

beforeEach(() => {
  // Default: behave like an unset env → return the caller's default arg.
  getEnv.mockReset().mockImplementation((_key, def) => def);
});

function acceptOf(container) {
  return container.querySelector('input[type="file"]').getAttribute("accept");
}

test("uploadFileSection_default_acceptsWidenedTypes", () => {
  const { container } = render(<UploadFileSection onUpload={jest.fn()} />);
  const accept = acceptOf(container);
  // Widened beyond the old pdf/doc/docx — office + text + image formats.
  for (const ext of [
    ".pdf",
    ".docx",
    ".xlsx",
    ".pptx",
    ".txt",
    ".csv",
    ".md",
    ".png",
    ".jpg",
  ]) {
    expect(accept).toContain(ext);
  }
});

test("uploadFileSection_envOverride_drivesAccept", () => {
  getEnv.mockImplementation(() => ".pdf,.csv");
  const { container } = render(<UploadFileSection onUpload={jest.fn()} />);
  expect(acceptOf(container)).toBe(".pdf,.csv");
});

// Story 112: the dropzone title is configurable via `dropTitle` so the admin
// "Sửa tài liệu" modal can match Figma 841-48773, while every other consumer
// (chat upload, repo upload) keeps the original text.
test("uploadFileSection_defaultDropTitle_keepsOriginalText", () => {
  render(<UploadFileSection onUpload={jest.fn()} />);
  expect(
    screen.getByText(/nhấn tải lên để thêm tài liệu để bắt đầu/i),
  ).toBeInTheDocument();
});

test("uploadFileSection_dropTitleProp_overridesTitle", () => {
  render(<UploadFileSection onUpload={jest.fn()} dropTitle="TIÊU ĐỀ TUỲ CHỈNH" />);
  expect(screen.getByText("TIÊU ĐỀ TUỲ CHỈNH")).toBeInTheDocument();
});
