import type { Recommendation } from "@/lib/ridi/types";

const KIND_LABEL: Record<Recommendation["kind"], string> = {
  newVolume: "미보유 권",
  unread: "미독",
  authorNew: "작가 신작",
};

const KIND_COLOR: Record<Recommendation["kind"], string> = {
  newVolume: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  unread: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  authorNew: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
};

export interface CardItem {
  bId: string;
  title: string;
  cover: string;
  coverHi: string;
  authors: string[];
  reason?: string;
  storeUrl: string;
  kind?: Recommendation["kind"];
  contentType?: string;
  rating?: number;
  isCompleted?: boolean;
  isAdult?: boolean;
  lastReadBId?: string;
  // 신간 page highlighting
  highlight?: "owned" | "author" | null;
}

export default function BookCard({ item }: { item: CardItem }) {
  const label =
    item.kind === "unread" && item.lastReadBId
      ? "이어읽기"
      : item.kind
        ? KIND_LABEL[item.kind]
        : null;

  const ring =
    item.highlight === "owned"
      ? "ring-2 ring-amber-400/70"
      : item.highlight === "author"
        ? "ring-2 ring-sky-400/60"
        : "ring-1 ring-white/10 hover:ring-white/25";

  return (
    <a
      href={item.storeUrl}
      target="_blank"
      rel="noreferrer"
      className={`group flex flex-col overflow-hidden rounded-xl bg-neutral-900 transition hover:-translate-y-0.5 ${ring}`}
    >
      <div className="relative aspect-[2/3] w-full bg-neutral-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.cover}
          srcSet={`${item.cover} 480w, ${item.coverHi} 960w`}
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 25vw, 16vw"
          alt={item.title}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        {label && (
          <span
            className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${KIND_COLOR[item.kind!]}`}
          >
            {label}
          </span>
        )}
        {item.highlight === "owned" && (
          <span className="absolute right-2 top-2 rounded-md bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-neutral-950">
            보유중
          </span>
        )}
        {item.highlight === "author" && (
          <span className="absolute right-2 top-2 rounded-md bg-sky-400 px-2 py-0.5 text-[11px] font-bold text-neutral-950">
            내 작가
          </span>
        )}
        {typeof item.rating === "number" && item.rating > 0 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
            ★ {item.rating.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-neutral-100 group-hover:text-white">
          {item.title}
        </h3>
        {item.authors.length > 0 && (
          <p className="line-clamp-1 text-xs text-neutral-400">{item.authors.join(", ")}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          {item.contentType && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400">
              {item.contentType}
            </span>
          )}
          {item.isCompleted && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400">
              완결
            </span>
          )}
          {item.isAdult && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">
              19
            </span>
          )}
        </div>
        {item.reason && (
          <p className="line-clamp-2 text-xs text-neutral-500">{item.reason}</p>
        )}
      </div>
    </a>
  );
}
