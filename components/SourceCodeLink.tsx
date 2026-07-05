const SOURCE_CODE_URL = "https://github.com/AnalDev/ridi-driller";

export default function SourceCodeLink() {
  return (
    <a
      href={SOURCE_CODE_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-neutral-100"
    >
      소스코드
    </a>
  );
}
