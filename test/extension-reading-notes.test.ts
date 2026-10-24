import { describe, expect, it } from "vitest";
import { mergeReadingNotes, readingNoteRecord } from "../extension/src/reading-notes.js";

describe("RIDI reading note capture", () => {
  it("normalizes a timeline annotation into a local bibliography record", () => {
    expect(readingNoteRecord({
      href: "https://ridibooks.com/reading-note/detail/443000873#annotation_482113646",
      text: "형광펜 나카모토 2010",
      marker: "형광펜",
      title: "사토시의 서",
      notedAt: "2022.03.28.",
      capturedAt: "2026-10-24T12:00:00.000Z",
    })).toEqual(expect.objectContaining({
      key: "ridi:443000873:annotation:482113646",
      bookId: "443000873",
      annotationId: "482113646",
      title: "사토시의 서",
      noteType: "highlight",
      noteText: "나카모토 2010",
      notedAt: "2022-03-28",
    }));
  });

  it("rejects detail links that are not individual annotations", () => {
    expect(readingNoteRecord({
      href: "https://ridibooks.com/reading-note/detail/443000873",
      text: "사토시의 서",
      title: "사토시의 서",
      notedAt: "2022.03.28.",
    })).toBeNull();
  });

  it("merges repeated captures without duplicating notes", () => {
    const oldRecord = { key: "ridi:1:annotation:2", title: "책", noteText: "이전", notedAt: "2024-01-01" };
    const newRecord = { ...oldRecord, noteText: "수정", capturedAt: "2026-10-24T12:00:00.000Z" };
    expect(mergeReadingNotes([oldRecord], [newRecord])).toEqual([newRecord]);
  });
});
