// src/features/chat/__tests__/repoPickerLabel.test.js
//
// Story 44: the chat panel nav label that opens the repository picker must read
// "Chọn từ kho tài liệu" (renamed from "Chọn tài liệu kho"). Chat.js is heavy to
// render in jsdom, so we lock the label against the source — a cheap, reliable
// regression guard for a static string rename.
import fs from "fs";
import path from "path";

const CHAT_PATH = path.join(__dirname, "..", "pages", "Chat.js");

test("repoPickerLabel_usesRenamedText", () => {
  const src = fs.readFileSync(CHAT_PATH, "utf8");
  expect(src).toContain("Chọn từ kho tài liệu");
});

test("repoPickerLabel_dropsOldText", () => {
  const src = fs.readFileSync(CHAT_PATH, "utf8");
  expect(src).not.toContain("Chọn tài liệu kho");
});
