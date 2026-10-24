import { afterEach, describe, expect, it, vi } from "vitest";

const LIBRARY_URL = "https://library-api.ridibooks.com/items/main/count/";
const REFRESH_URL = "https://account.ridibooks.com/ridi/token";

async function loadApi() {
  vi.resetModules();
  return import("../extension/src/api.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RIDI extension authentication", () => {
  it("refreshes an expired access token and retries the original request once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ unit_total_count: 7 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchLibraryCount } = await loadApi();

    await expect(fetchLibraryCount()).resolves.toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(LIBRARY_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(REFRESH_URL);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(LIBRARY_URL);
  });

  it("coalesces concurrent 401 responses into one refresh request", async () => {
    const attempts = new Map<string, number>();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === REFRESH_URL) {
        refreshCalls += 1;
        await Promise.resolve();
        return new Response(null, { status: 204 });
      }
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      return attempt === 1 ? new Response(null, { status: 401 }) : Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { authGet } = await loadApi();

    await expect(
      Promise.all([authGet(`${LIBRARY_URL}?request=1`), authGet(`${LIBRARY_URL}?request=2`)]),
    ).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it("does not use token refresh for a Cloudflare 403 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchLibraryCount, RidiCloudflareError } = await loadApi();

    await expect(fetchLibraryCount()).rejects.toBeInstanceOf(RidiCloudflareError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(REFRESH_URL, expect.anything());
  });

  it("restores an expired access cookie when a refresh cookie is available", async () => {
    let refreshed = false;
    const cookieGet = vi.fn(({ name }: { name: string }, callback: (cookie: object | null) => void) => {
      if (name === "ridi-rt") {
        callback({ expirationDate: Date.now() / 1000 + 3600 });
        return;
      }
      callback({ expirationDate: Date.now() / 1000 + (refreshed ? 3600 : -3600) });
    });
    vi.stubGlobal("chrome", { cookies: { get: cookieGet } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        refreshed = true;
        return new Response(null, { status: 204 });
      }),
    );
    const { getSession } = await loadApi();

    await expect(getSession()).resolves.toMatchObject({ loggedIn: true, refreshable: true, refreshed: true });
  });

  it("paginates the current RIDI interest GraphQL API", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      bookId: String(index + 1),
      isNotificationOn: index === 0,
      newReleaseCount: index === 0 ? 2 : 0,
      bookShell: { book: { title: { main: `관심 ${index + 1}` } } },
    }));
    const second = [{
      bookId: "101",
      isNotificationOn: false,
      bookShell: { book: { title: { main: "관심 101" } } },
    }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { userInterestBook: { items: first, totalItemCount: 101 } } }))
      .mockResolvedValueOnce(Response.json({ data: { userInterestBook: { items: second, totalItemCount: 101 } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchInterestBooks } = await loadApi();

    const progress = vi.fn();
    const books = await fetchInterestBooks(progress);

    expect(books).toHaveLength(101);
    expect(books[0]).toMatchObject({ bookId: "1", title: "관심 1", newReleaseCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.variables.pagination).toEqual({ limit: 100, offset: 100 });
    expect(progress).toHaveBeenLastCalledWith(101, 101);
  });

  it("paginates every new-release genre and merges duplicate book ids", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const genre = Number(url.searchParams.get("category_includes"));
      const offset = Number(url.searchParams.get("offset"));
      if (genre === 1500 && offset === 0) {
        return Response.json({ data: {
          items: [
            { book: { book_id: "same", title: "공통 1권", serial: { title: "공통" }, authors: [] } },
            { book: { book_id: "trial", title: "체험판", trial: true, authors: [] } },
          ],
          pagination: { next_page: "/v2/new-releases?offset=2" },
        } });
      }
      if (genre === 1500 && offset === 2) {
        return Response.json({ data: {
          items: [{ book: { book_id: "comic", title: "만화", authors: [] } }],
          pagination: { next_page: null },
        } });
      }
      if (genre === 1600) {
        return Response.json({ data: {
          items: [{ book: { book_id: "same", title: "공통", authors: [] } }],
          pagination: { next_page: null },
        } });
      }
      return Response.json({ data: { items: [], pagination: { next_page: null } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAllNewReleases } = await loadApi();

    const records = await fetchAllNewReleases();

    expect(records).toHaveLength(2);
    expect(records.find((record) => record.bId === "same")).toMatchObject({
      genreIds: [1500, 1600],
      genreLabels: ["만화", "웹툰"],
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("offset=2"))).toBe(true);
  });

  it("paginates a complete shelf by its count endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ count: 301 }))
      .mockResolvedValueOnce(Response.json({ shelf: { name: "읽을 책" }, items: Array.from({ length: 300 }, (_, index) => ({ unit_id: index + 1, b_ids: [index + 10] })) }))
      .mockResolvedValueOnce(Response.json({ shelf: { name: "읽을 책" }, items: [{ unit_id: 301, b_ids: [999] }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAllShelfUnits } = await loadApi();

    const result = await fetchAllShelfUnits("shelf-uuid");

    expect(result).toMatchObject({ name: "읽을 책", total: 301 });
    expect(result.units).toHaveLength(301);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("offset=300&limit=300");
  });
});
