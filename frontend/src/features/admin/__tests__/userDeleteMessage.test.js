// src/features/admin/__tests__/userDeleteMessage.test.js
import {
  buildUserDeleteMessage,
  GENERIC_DELETE_MESSAGE,
} from "features/admin/utils/userDeleteMessage";

test("buildUserDeleteMessage_noRelatedData_returnsGeneric", () => {
  expect(
    buildUserDeleteMessage({ documents: 0, conversations: 0, owns_repo_units: [] })
  ).toBe(GENERIC_DELETE_MESSAGE);
  expect(buildUserDeleteMessage(null)).toBe(GENERIC_DELETE_MESSAGE);
  expect(buildUserDeleteMessage(undefined)).toBe(GENERIC_DELETE_MESSAGE);
});

test("buildUserDeleteMessage_withDocsAndConvs_mentionsCounts", () => {
  const msg = buildUserDeleteMessage({
    documents: 3,
    conversations: 2,
    owns_repo_units: [],
  });
  expect(msg).toContain("3 tài liệu");
  expect(msg).toContain("2 hội thoại");
  expect(msg).toContain("sạch dữ liệu");
});

test("buildUserDeleteMessage_ownsRepoUnits_addsKeptNote", () => {
  const msg = buildUserDeleteMessage({
    documents: 1,
    conversations: 0,
    owns_repo_units: ["Đơn vị A", "Đơn vị B"],
  });
  expect(msg).toContain("Đơn vị A");
  expect(msg).toContain("Đơn vị B");
  expect(msg).toContain("giữ");
});

test("buildUserDeleteMessage_onlyRepoUnits_noCounts_stillWarns", () => {
  const msg = buildUserDeleteMessage({
    documents: 0,
    conversations: 0,
    owns_repo_units: ["Đơn vị X"],
  });
  expect(msg).toContain("Đơn vị X");
  expect(msg).not.toBe(GENERIC_DELETE_MESSAGE);
});
