// src/features/chat/__tests__/repoIconFolderStar.test.js
//
// Story 61: the chat panel "Chọn từ kho tài liệu" button must use the folder-star
// icon (Figma 841-48816), the same "kho tài liệu" glyph as the admin nav — not the
// generic file sheet. Chat.js is too heavy to render in jsdom (ADR-008), so lock
// the icon wiring against the source, the same approach story 44 used for its label.
import fs from "fs";
import path from "path";

const CHAT_PATH = path.join(__dirname, "..", "pages", "Chat.js");

test("repoIcon_chatButton_usesFolderStarIcon", () => {
  const src = fs.readFileSync(CHAT_PATH, "utf8");
  expect(src).toContain("assets/images/folder-star.svg");
  expect(src).toContain("FolderStarIcon");
});

test("repoIcon_chat_dropsFileSvg", () => {
  // file.svg was only used for this one button in Chat.js → it should be gone.
  const src = fs.readFileSync(CHAT_PATH, "utf8");
  expect(src).not.toContain("assets/images/file.svg");
});
