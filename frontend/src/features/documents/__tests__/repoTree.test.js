// src/features/documents/__tests__/repoTree.test.js
import {
  flatDocs,
  docsInGroup,
  toggleDoc,
  toggleGroup,
  toggleAll,
  groupState,
  allState,
} from "features/documents/components/repoPicker/repoTree";

const DOCS = [
  { id: "f1", name: "doc2.pdf", group_id: null },
  { id: "f2", name: "Doc3.doc", group_id: null },
  { id: "g1a", name: "doc4.pdf", group_id: 1 },
  { id: "g1b", name: "Doc5.doc", group_id: 1 },
  { id: "g2a", name: "Doc9.doc", group_id: 2 },
];

describe("repoTree", () => {
  test("flatDocs_returnsOnlyUngrouped", () => {
    expect(flatDocs(DOCS).map((d) => d.id)).toEqual(["f1", "f2"]);
  });

  test("docsInGroup_filtersByGroup", () => {
    expect(docsInGroup(DOCS, 1).map((d) => d.id)).toEqual(["g1a", "g1b"]);
  });

  test("toggleDoc_addsAndRemoves", () => {
    expect(toggleDoc([], "f1")).toEqual(["f1"]);
    expect(toggleDoc(["f1"], "f1")).toEqual([]);
  });

  test("toggleGroup_selectsAllChildrenThenClears", () => {
    const sel = toggleGroup([], DOCS, 1);
    expect(new Set(sel)).toEqual(new Set(["g1a", "g1b"]));
    expect(toggleGroup(sel, DOCS, 1)).toEqual([]);
  });

  test("groupState_triState", () => {
    expect(groupState([], DOCS, 1)).toBe("none");
    expect(groupState(["g1a"], DOCS, 1)).toBe("some");
    expect(groupState(["g1a", "g1b"], DOCS, 1)).toBe("all");
  });

  test("toggleAll_selectsEverythingThenClears", () => {
    const all = toggleAll([], DOCS);
    expect(all).toHaveLength(5);
    expect(toggleAll(all, DOCS)).toEqual([]);
  });

  test("allState_triState", () => {
    expect(allState([], DOCS)).toBe("none");
    expect(allState(["f1"], DOCS)).toBe("some");
    expect(allState(DOCS.map((d) => d.id), DOCS)).toBe("all");
  });
});
