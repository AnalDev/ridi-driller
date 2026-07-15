import Link from "next/link";

export default function StoreSearchLink() {
  return (
    <Link
      href="/search"
      className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-500/10"
    >
      도서 검색
    </Link>
  );
}
