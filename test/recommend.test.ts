import { describe, it, expect } from "vitest";
import { buildRecommendations, type RecommendInput } from "@/lib/ridi/recommend";
import type { BookMeta, LastRead, SearchAuthorBook } from "@/lib/ridi/types";
import { meta, seriesProp, unit, searchBook } from "./factories";

function run(over: Partial<RecommendInput>) {
  return buildRecommendations({
    units: [],
    meta: new Map(),
    lastRead: new Map(),
    authorBooks: new Map(),
    ...over,
  });
}

describe("signal 1 — missing volumes (newVolume)", () => {
  it("flags a series where owned < opened and recommends the newest volume", () => {
    const m = meta({
      id: "rep",
      series: {
        id: "S1",
        volume: 5,
        property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "V8" }),
      },
    });
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 5, unit_id: 1 })],
      meta: new Map([["rep", m]]),
    });
    expect(out.newVolume).toHaveLength(1);
    const r = out.newVolume[0];
    expect(r.bId).toBe("V8");
    expect(r.missing).toBe(3);
    expect(r.ownedCount).toBe(5);
    expect(r.totalCount).toBe(8);
    expect(r.reason).toContain("3권");
  });

  it("uses completed vs ongoing wording", () => {
    const mk = (completed: boolean) =>
      meta({
        id: "rep",
        series: {
          id: "S1",
          volume: 5,
          property: seriesProp({
            opened_book_count: 8,
            opened_last_volume_id: "V8",
            is_completed: completed,
          }),
        },
      });
    const done = run({
      units: [unit({ b_id: "rep", unit_count: 5 })],
      meta: new Map([["rep", mk(true)]]),
    }).newVolume[0];
    const ongoing = run({
      units: [unit({ b_id: "rep", unit_count: 5 })],
      meta: new Map([["rep", mk(false)]]),
    }).newVolume[0];
    expect(done.reason).toContain("완결");
    expect(ongoing.reason).toContain("새 권 발매");
  });

  it("does not flag a fully-owned series", () => {
    const m = meta({
      id: "rep",
      series: { id: "S1", volume: 8, property: seriesProp({ opened_book_count: 8 }) },
    });
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 8 })],
      meta: new Map([["rep", m]]),
    });
    expect(out.newVolume).toHaveLength(0);
  });

  it("ranks a nearly-complete series above one you barely started", () => {
    const near = meta({
      id: "near",
      series: { id: "A", volume: 7, property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "a8" }) },
    });
    const barely = meta({
      id: "barely",
      series: { id: "B", volume: 2, property: seriesProp({ opened_book_count: 64, opened_last_volume_id: "b64" }) },
    });
    const out = run({
      units: [
        unit({ b_id: "near", unit_count: 7, unit_id: 1 }),
        unit({ b_id: "barely", unit_count: 2, unit_id: 2 }),
      ],
      meta: new Map([
        ["near", near],
        ["barely", barely],
      ]),
    });
    expect(out.newVolume[0].bId).toBe("a8"); // 7/8 owned beats 2/64
  });
});

describe("signal 2 — unread / continue", () => {
  const repMeta = meta({
    id: "rep",
    series: {
      id: "S1",
      volume: 7,
      property: seriesProp({ opened_book_count: 7 }),
      price_info: { buy: { total_book_count: 7 } },
    },
  });

  it("continue: last-read volume < owned, reports read/owned/total + timestamp", () => {
    const read: BookMeta = meta({
      id: "read6",
      series: { id: "S1", volume: 6, property: seriesProp({ opened_book_count: 7 }) },
    });
    const lastRead = new Map<string, LastRead | null>([
      ["S1", { bookId: "read6", lastReadAt: "2025-09-12T04:22:58+09:00" }],
    ]);
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 7 })],
      meta: new Map([
        ["rep", repMeta],
        ["read6", read],
      ]),
      lastRead,
    });
    expect(out.unread).toHaveLength(1);
    const r = out.unread[0];
    expect(r.lastReadBId).toBe("read6");
    expect(r.lastReadVolume).toBe(6);
    expect(r.ownedCount).toBe(7);
    expect(r.totalCount).toBe(7);
    expect(r.lastReadAt).toBe("2025-09-12T04:22:58+09:00");
    expect(r.reason).toContain("최근 읽은 권 6");
  });

  it("never opened: last-read null → 미독", () => {
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 7 })],
      meta: new Map([["rep", repMeta]]),
      lastRead: new Map([["S1", null]]),
    });
    expect(out.unread).toHaveLength(1);
    expect(out.unread[0].lastReadBId).toBeUndefined();
  });

  it("continue outranks never-opened", () => {
    const read = meta({ id: "r2", series: { id: "S1", volume: 1, property: seriesProp() } });
    const cont = run({
      units: [unit({ b_id: "rep", unit_count: 7 })],
      meta: new Map([["rep", repMeta], ["r2", read]]),
      lastRead: new Map([["S1", { bookId: "r2", lastReadAt: "2025-01-01T00:00:00Z" }]]),
    }).unread[0];
    const never = run({
      units: [unit({ b_id: "rep", unit_count: 7 })],
      meta: new Map([["rep", repMeta]]),
      lastRead: new Map([["S1", null]]),
    }).unread[0];
    expect(cont.score).toBeGreaterThan(never.score);
  });
});

describe("signal 3 — author's other works", () => {
  // library owns series S1 (rep) by 작가A
  const owned = meta({
    id: "rep",
    series: { id: "S1", volume: 1, property: seriesProp({ title: "보유작" }) },
    authors: [{ id: 1, name: "작가A", role: "author" }],
  });
  const base = () => ({
    units: [unit({ b_id: "rep", unit_count: 1 })],
    meta: new Map([["rep", owned]]),
  });

  it("excludes owned series, owned b_id, and owned titles; includes genuinely new works", () => {
    const authorBooks = new Map<string, SearchAuthorBook[]>([
      [
        "작가A",
        [
          searchBook({ b_id: "own1", series_id: "S1", title: "보유작" }), // owned series
          searchBook({ b_id: "rep", series_id: "SX", title: "다른판" }), // owned b_id
          searchBook({ b_id: "new1", series_id: "S2", title: "신작하나" }), // NEW
        ],
      ],
    ]);
    const out = run({ ...base(), authorBooks });
    expect(out.authorNew.map((r) => r.bId)).toEqual(["new1"]);
  });

  it("dedupes multiple volumes of the same new series", () => {
    const authorBooks = new Map<string, SearchAuthorBook[]>([
      [
        "작가A",
        [
          searchBook({ b_id: "v1", series_id: "S2", title: "신작 1권" }),
          searchBook({ b_id: "v2", series_id: "S2", title: "신작 2권" }),
        ],
      ],
    ]);
    const out = run({ ...base(), authorBooks });
    expect(out.authorNew).toHaveLength(1);
  });

  it("attaches publish date from enriched book metadata", () => {
    const authorBooks = new Map<string, SearchAuthorBook[]>([
      ["작가A", [searchBook({ b_id: "new1", series_id: "S2", title: "신작하나" })]],
    ]);
    const newMeta = meta({
      id: "new1",
      publish: { ebook_publish: "2026-07-01T00:00:00+09:00" },
    });
    const out = run({
      ...base(),
      meta: new Map([
        ["rep", owned],
        ["new1", newMeta],
      ]),
      authorBooks,
    });
    expect(out.authorNew[0].publishDate).toBe("2026-07-01T00:00:00+09:00");
  });

  it("merges setbooks: a regular edition wins over the 세트 of the same title", () => {
    const authorBooks = new Map<string, SearchAuthorBook[]>([
      [
        "작가A",
        [
          searchBook({ b_id: "set", series_id: "S3", title: "명작", is_setbook: true }),
          searchBook({ b_id: "reg", series_id: "S4", title: "명작", is_setbook: false }),
        ],
      ],
    ]);
    const out = run({ ...base(), authorBooks });
    expect(out.authorNew).toHaveLength(1);
    expect(out.authorNew[0].bId).toBe("reg");
    expect(out.authorNew[0].isSetbook).toBe(false);
  });

  it("ranks authors you own more of, and higher-rated works, first", () => {
    // 작가A owned once, 작가B owned twice → B ranks higher
    const ownedB = meta({
      id: "repB",
      series: { id: "SB", volume: 1, property: seriesProp({ title: "B보유" }) },
      authors: [{ id: 2, name: "작가B", role: "author" }],
    });
    const units = [
      unit({ b_id: "rep", unit_count: 1, unit_id: 1 }),
      unit({ b_id: "repB", unit_count: 1, unit_id: 2 }),
      unit({ b_id: "repB2", unit_count: 1, unit_id: 3 }),
    ];
    const repB2 = meta({
      id: "repB2",
      series: { id: "SB2", volume: 1, property: seriesProp({ title: "B보유2" }) },
      authors: [{ id: 2, name: "작가B", role: "author" }],
    });
    const authorBooks = new Map<string, SearchAuthorBook[]>([
      ["작가A", [searchBook({ b_id: "na", series_id: "NA", title: "A신작", buyer_rating_score: 3 })]],
      ["작가B", [searchBook({ b_id: "nb", series_id: "NB", title: "B신작", buyer_rating_score: 5 })]],
    ]);
    const out = run({
      units,
      meta: new Map([
        ["rep", owned],
        ["repB", ownedB],
        ["repB2", repB2],
      ]),
      authorBooks,
    });
    expect(out.authorNew[0].bId).toBe("nb");
  });
});

describe("체험판 (trial) exclusion + paid-count", () => {
  it("uses paid book count so a free 체험판 does not create a false missing volume", () => {
    const m = meta({
      id: "rep",
      series: {
        id: "S",
        volume: 7,
        property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "V" }),
        price_info: { buy: { total_book_count: 7 } },
      },
    });
    const out = run({ units: [unit({ b_id: "rep", unit_count: 7 })], meta: new Map([["rep", m]]) });
    expect(out.newVolume).toHaveLength(0); // owns all 7 paid; +1 opened is a 체험판
  });

  it("still flags genuinely missing paid volumes", () => {
    const m = meta({
      id: "rep",
      series: {
        id: "S",
        volume: 5,
        property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "V" }),
        price_info: { buy: { total_book_count: 7 } },
      },
    });
    const out = run({ units: [unit({ b_id: "rep", unit_count: 6 })], meta: new Map([["rep", m]]) });
    expect(out.newVolume).toHaveLength(1);
    expect(out.newVolume[0].missing).toBe(1); // paid 7 - owned 6
    expect(out.newVolume[0].totalCount).toBe(7);
  });

  it("falls back to opened_book_count when price info is absent", () => {
    const m = meta({
      id: "rep",
      series: { id: "S", volume: 5, property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "V" }) },
    });
    const out = run({ units: [unit({ b_id: "rep", unit_count: 5 })], meta: new Map([["rep", m]]) });
    expect(out.newVolume[0].missing).toBe(3);
  });

  it("skips a unit that is itself a 체험판 (property flag or title)", () => {
    const byProp = meta({
      id: "t1",
      property: { is_trial: true },
      series: { id: "S", volume: 1, property: seriesProp({ opened_book_count: 3, opened_last_volume_id: "x" }) },
    });
    const byTitle = meta({
      id: "t2",
      title: { main: "[체험판] 어떤 만화" },
      series: { id: "S2", volume: 1, property: seriesProp({ opened_book_count: 3, opened_last_volume_id: "y" }) },
    });
    const out = run({
      units: [unit({ b_id: "t1", unit_count: 1 }), unit({ b_id: "t2", unit_count: 1 })],
      meta: new Map([["t1", byProp], ["t2", byTitle]]),
    });
    expect(out.newVolume).toHaveLength(0);
    expect(out.unread).toHaveLength(0);
    expect(out.finished).toHaveLength(0);
  });

  it("excludes 체험판 titles from author works", () => {
    const owned = meta({
      id: "rep",
      series: { id: "S1", volume: 1, property: seriesProp({ title: "보유작" }) },
      authors: [{ id: 1, name: "작가A", role: "author" }],
    });
    const authorBooks = new Map([
      [
        "작가A",
        [searchBook({ b_id: "t", title: "[체험판] 신작" }), searchBook({ b_id: "n", series_id: "S2", title: "진짜신작" })],
      ],
    ]);
    const out = run({ units: [unit({ b_id: "rep", unit_count: 1 })], meta: new Map([["rep", owned]]), authorBooks });
    expect(out.authorNew.map((r) => r.bId)).toEqual(["n"]);
  });
});

describe("세트 / 합본 handling", () => {
  it("does not flag missing volumes for a 완결 세트 the user owns", () => {
    const m = meta({
      id: "set",
      title: { main: "[완결 세트] 대작 전권" },
      series: { id: "S", volume: 1, property: seriesProp({ opened_book_count: 20, opened_last_volume_id: "L" }) },
    });
    const out = run({ units: [unit({ b_id: "set", unit_count: 1 })], meta: new Map([["set", m]]) });
    expect(out.newVolume).toHaveLength(0);
  });
});

describe("다 읽은 책 (finished)", () => {
  it("lists a series read up to the latest owned volume", () => {
    const rep = meta({
      id: "rep",
      series: {
        id: "S",
        volume: 7,
        property: seriesProp({ opened_book_count: 7 }),
        price_info: { buy: { total_book_count: 7 } },
      },
    });
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 7 })],
      meta: new Map([["rep", rep]]),
      lastRead: new Map([["S", { bookId: "rep", lastReadAt: "2025-09-12T00:00:00Z" }]]),
    });
    expect(out.finished).toHaveLength(1);
    expect(out.unread).toHaveLength(0);
    expect(out.finished[0].lastReadAt).toBe("2025-09-12T00:00:00Z");
  });

  it("read-all-owned but missing paid volumes → 안 읽은 책, NOT 다 읽은 책", () => {
    const m = meta({
      id: "rep",
      series: {
        id: "S",
        volume: 5,
        property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "V" }),
        price_info: { buy: { total_book_count: 7 } },
      },
    });
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 5 })],
      meta: new Map([["rep", m]]),
      lastRead: new Map([["S", { bookId: "rep", lastReadAt: "2025-01-01T00:00:00Z" }]]),
    });
    // not finished — 미보유 2권(paid 7 - owned 5)이 남아있으므로
    expect(out.finished).toHaveLength(0);
    const u = out.unread[0];
    expect(u).toBeDefined();
    expect(u.missing).toBe(2);
    expect(u.reason).toContain("미보유 2권");
    expect(out.newVolume).toHaveLength(1); // also surfaced as 미보유 신권
  });
});

describe("tag + rating harvest", () => {
  it("attaches tags/rating from an author's search results to the owned series rec", () => {
    const m = meta({
      id: "rep",
      series: {
        id: "S1",
        volume: 5,
        property: seriesProp({ opened_book_count: 8, opened_last_volume_id: "V8" }),
      },
      authors: [{ id: 1, name: "작가A", role: "author" }],
    });
    // the owned series shows up in its author's search results with tags + rating
    const authorBooks = new Map<string, SearchAuthorBook[]>([
      [
        "작가A",
        [
          searchBook({
            b_id: "own",
            series_id: "S1",
            title: "보유작",
            tags_info: [
              { tag_id: 1, tag_name: "완결" },
              { tag_id: 2, tag_name: "성장" },
            ],
            buyer_rating_score: 4.7,
          }),
        ],
      ],
    ]);
    const out = run({
      units: [unit({ b_id: "rep", unit_count: 5 })],
      meta: new Map([["rep", m]]),
      authorBooks,
    });
    const nv = out.newVolume[0];
    expect(nv.tags).toContain("완결");
    expect(nv.rating).toBe(4.7);
  });
});
