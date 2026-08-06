// src/stores/__tests__/viewerCacheStore.test.js
import useViewerCacheStore, {
  MAX_CACHED_DOCS,
} from "stores/useViewerCacheStore";

const reset = () => useViewerCacheStore.getState().clearViewerCache();

describe("useViewerCacheStore", () => {
  beforeEach(reset);

  test("test_getFile_caches_and_skips_second_load", async () => {
    const blob = new Blob(["pdf"]);
    const loader = jest.fn(async () => blob);
    const a = await useViewerCacheStore.getState().getFile("d1", loader);
    const b = await useViewerCacheStore.getState().getFile("d1", loader);
    expect(a).toBe(blob);
    expect(b).toBe(blob);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("test_concurrent_getFile_dedupes_inflight_load", async () => {
    let resolve;
    const loader = jest.fn(
      () => new Promise((r) => { resolve = r; })
    );
    const p1 = useViewerCacheStore.getState().getFile("d1", loader);
    const p2 = useViewerCacheStore.getState().getFile("d1", loader);
    resolve("blob-1");
    expect(await p1).toBe("blob-1");
    expect(await p2).toBe("blob-1");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("test_failed_load_is_not_cached", async () => {
    const loader = jest
      .fn()
      .mockRejectedValueOnce(new Error("tunnel down"))
      .mockResolvedValueOnce("blob-2");
    await expect(
      useViewerCacheStore.getState().getFile("d1", loader)
    ).rejects.toThrow("tunnel down");
    // The failure must not poison the cache — a retry loads again.
    await expect(
      useViewerCacheStore.getState().getFile("d1", loader)
    ).resolves.toBe("blob-2");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("test_pages_cached_independently_of_file", async () => {
    const filesLoader = jest.fn(async () => "file-blob");
    const pagesLoader = jest.fn(async () => ({ pages: [1], page_count: 1 }));
    await useViewerCacheStore.getState().getFile("d1", filesLoader);
    await useViewerCacheStore.getState().getPages("d1", pagesLoader);
    await useViewerCacheStore.getState().getPages("d1", pagesLoader);
    expect(filesLoader).toHaveBeenCalledTimes(1);
    expect(pagesLoader).toHaveBeenCalledTimes(1);
  });

  test("test_evicts_least_recently_used_beyond_cap", async () => {
    const loader = (v) => jest.fn(async () => v);
    const first = loader("doc-0");
    await useViewerCacheStore.getState().getFile("doc-0", first);
    for (let i = 1; i <= MAX_CACHED_DOCS; i++) {
      await useViewerCacheStore.getState().getFile(`doc-${i}`, loader(`doc-${i}`));
    }
    // doc-0 was evicted (cap exceeded) — its loader runs again.
    const again = loader("doc-0-reloaded");
    await expect(
      useViewerCacheStore.getState().getFile("doc-0", again)
    ).resolves.toBe("doc-0-reloaded");
    expect(again).toHaveBeenCalledTimes(1);
    // The most recent doc is still cached.
    const cachedLoader = jest.fn(async () => "nope");
    await expect(
      useViewerCacheStore.getState().getFile(`doc-${MAX_CACHED_DOCS}`, cachedLoader)
    ).resolves.toBe(`doc-${MAX_CACHED_DOCS}`);
    expect(cachedLoader).not.toHaveBeenCalled();
  });

  test("test_clearViewerCache_empties_everything", async () => {
    const loader = jest.fn(async () => "x");
    await useViewerCacheStore.getState().getFile("d1", loader);
    useViewerCacheStore.getState().clearViewerCache();
    await useViewerCacheStore.getState().getFile("d1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
