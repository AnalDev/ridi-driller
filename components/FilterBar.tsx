"use client";

import { useState } from "react";
import {
  SORT_OPTIONS,
  type SortKey,
  type TriState,
  type ViewState,
} from "@/lib/view";

interface Facet {
  value: string;
  count: number;
}
interface Facets {
  types: Facet[];
  categories: Facet[];
  tags: Facet[];
}

const TRI_LABELS: Record<TriState, string> = {
  all: "전체",
  only: "만",
  exclude: "제외",
};

function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  const states: TriState[] = ["all", "only", "exclude"];
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-neutral-400">{label}</span>
      <div className="flex overflow-hidden rounded-md ring-1 ring-white/10">
        {states.map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`px-2 py-1 ${
              value === s
                ? "bg-emerald-500 text-neutral-950"
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {TRI_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipRow({
  items,
  selected,
  onToggle,
  max = 18,
}: {
  items: Facet[];
  selected: string[];
  onToggle: (v: string) => void;
  max?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((f) => {
        const on = selected.includes(f.value);
        return (
          <button
            key={f.value}
            onClick={() => onToggle(f.value)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${
              on
                ? "bg-emerald-500 text-neutral-950"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {f.value}
            <span className={on ? "text-neutral-800" : "text-neutral-500"}> {f.count}</span>
          </button>
        );
      })}
      {items.length > max && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="rounded-full px-2.5 py-1 text-xs text-emerald-300 hover:bg-white/5"
        >
          {expanded ? "접기" : `+${items.length - max}`}
        </button>
      )}
    </div>
  );
}

export default function FilterBar({
  view,
  setView,
  facets,
  tab,
  resultCount,
}: {
  view: ViewState;
  setView: (updater: (v: ViewState) => ViewState) => void;
  facets: Facets;
  tab: string;
  resultCount: number;
}) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<ViewState>) => setView((v) => ({ ...v, ...p }));
  const toggleIn = (key: "types" | "categories" | "tags", value: string) =>
    setView((v) => {
      const arr = v[key];
      return {
        ...v,
        [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value],
      };
    });

  const sortOpts = SORT_OPTIONS.filter((o) => !o.tabs || o.tabs.includes(tab));
  const activeFilters =
    (view.adult !== "all" ? 1 : 0) +
    (view.completed !== "all" ? 1 : 0) +
    (view.hideMagazine ? 1 : 0) +
    view.types.length +
    view.categories.length +
    view.tags.length +
    (view.minRating > 0 ? 1 : 0);

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-neutral-900/50">
      {/* top row: search + sort + toggle */}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <input
          value={view.search}
          onChange={(e) => patch({ search: e.target.value })}
          placeholder="제목·작가 검색"
          className="min-w-40 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
        />
        <select
          value={view.sortKey}
          onChange={(e) => patch({ sortKey: e.target.value as SortKey })}
          className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-2 text-sm text-neutral-200"
        >
          {sortOpts.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => patch({ sortDir: view.sortDir === "asc" ? "desc" : "asc" })}
          className="rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5"
          title={view.sortDir === "asc" ? "오름차순" : "내림차순"}
        >
          {view.sortDir === "asc" ? "↑" : "↓"}
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5"
        >
          필터{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </button>
      </div>

      {/* expandable filter panel */}
      {open && (
        <div className="space-y-3 border-t border-white/10 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <TriToggle
              label="성인"
              value={view.adult}
              onChange={(v) => patch({ adult: v })}
            />
            <TriToggle
              label="완결"
              value={view.completed}
              onChange={(v) => patch({ completed: v })}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={view.hideMagazine}
                onChange={(e) => patch({ hideMagazine: e.target.checked })}
                className="accent-emerald-500"
              />
              잡지 제외
            </label>
            <div className="flex items-center gap-2 text-xs text-neutral-300">
              <span>별점 ≥ {view.minRating.toFixed(1)}</span>
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={view.minRating}
                onChange={(e) => patch({ minRating: Number(e.target.value) })}
                className="accent-emerald-500"
              />
            </div>
          </div>

          {facets.types.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-neutral-500">타입</p>
              <ChipRow
                items={facets.types}
                selected={view.types}
                onToggle={(v) => toggleIn("types", v)}
              />
            </div>
          )}
          {facets.categories.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-neutral-500">카테고리</p>
              <ChipRow
                items={facets.categories}
                selected={view.categories}
                onToggle={(v) => toggleIn("categories", v)}
              />
            </div>
          )}
          {facets.tags.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-neutral-500">태그</p>
              <ChipRow
                items={facets.tags}
                selected={view.tags}
                onToggle={(v) => toggleIn("tags", v)}
              />
            </div>
          )}

          <div className="flex justify-between pt-1 text-xs text-neutral-500">
            <span>{resultCount.toLocaleString()}건</span>
            <button
              onClick={() =>
                setView((v) => ({
                  ...v,
                  adult: "all",
                  completed: "all",
                  hideMagazine: false,
                  types: [],
                  categories: [],
                  tags: [],
                  minRating: 0,
                }))
              }
              className="text-emerald-300 hover:underline"
            >
              필터 초기화
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
