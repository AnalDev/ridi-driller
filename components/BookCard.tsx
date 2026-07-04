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

export default function BookCard({ rec }: { rec: Recommendation }) {
  const label = rec.kind === "unread" && rec.lastReadBId ? "이어읽기" : KIND_LABEL[rec.kind];
  return (
    <a
      href={rec.storeUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10 transition hover:ring-white/25 hover:-translate-y-0.5"
    >
      <div className="relative aspect-[2/3] w-full bg-neutral-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={rec.cover}
          alt={rec.title}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <span
          className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${KIND_COLOR[rec.kind]}`}
        >
          {label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-neutral-100 group-hover:text-white">
          {rec.title}
        </h3>
        {rec.authors.length > 0 && (
          <p className="line-clamp-1 text-xs text-neutral-400">{rec.authors.join(", ")}</p>
        )}
        <p className="mt-auto line-clamp-2 pt-1 text-xs text-neutral-500">{rec.reason}</p>
      </div>
    </a>
  );
}
