// 서재·신간 인라인 목록과 서지 관리 화면이 함께 쓰는 검색어 해석기.
//
// 문법 (화면의 도움말과 같다)
//   낱말 낱말      모두 포함 (AND)
//   A | B         둘 중 하나 (OR). `OR` 로 써도 된다
//   -낱말          제외
//   "여러 낱말"    따옴표 안을 한 덩어리로
//   작가:이름      그 항목에서만 찾기 (제목·작가·출판사·메모)
//
// 일치 방식은 부분 일치다. 비교할 때 유니코드 정규화(NFKC)를 하고 대소문자와 공백을 무시한다.
// 그래서 "원 피스"로 "원피스"를, "ＡＢＣ"로 "abc"를 찾는다. 문장부호는 그대로 둔다.

export const SEARCH_FIELDS = {
  title: ["제목", "작품", "작품명", "title"],
  author: ["작가", "저자", "author"],
  publisher: ["출판사", "출판", "publisher"],
  memo: ["메모", "노트", "memo", "note"],
};

export const FIELD_LABELS = { title: "제목", author: "작가", publisher: "출판사", memo: "메모" };

// 지나치게 긴 입력이 목록 전체를 느리게 만들지 않도록 해석 범위를 제한한다.
const MAX_GROUPS = 4;
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 60;

const FIELD_BY_ALIAS = new Map(
  Object.entries(SEARCH_FIELDS).flatMap(([field, aliases]) => aliases.map((alias) => [alias, field])),
);

export function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

/** 따옴표 묶음을 지키며 공백으로 나눈다. `|` 는 앞뒤 공백이 없어도 따로 떼어 낸다. */
function tokenize(text) {
  const tokens = [];
  const pattern = /(-?(?:[^\s"|:]+:)?"[^"]*"?)|(\|)|([^\s|]+)/gu;
  for (const match of String(text ?? "").matchAll(pattern)) tokens.push(match[0]);
  return tokens;
}

function parseTerm(token) {
  let rest = token;
  const exclude = rest.startsWith("-") && rest.length > 1;
  if (exclude) rest = rest.slice(1);
  let field = null;
  const colon = rest.indexOf(":");
  if (colon > 0) {
    const alias = rest.slice(0, colon).toLowerCase();
    if (FIELD_BY_ALIAS.has(alias)) {
      field = FIELD_BY_ALIAS.get(alias);
      rest = rest.slice(colon + 1);
    }
  }
  const quoted = rest.startsWith('"');
  const display = (quoted ? rest.replace(/^"|"$/gu, "") : rest).trim().slice(0, MAX_TERM_LENGTH);
  const value = normalizeSearchText(display);
  if (!value) return null;
  return { raw: token, field, exclude, value, display };
}

/**
 * @param {string} text
 * @returns {{ groups: Array<Array<{ raw: string, field: string | null, exclude: boolean, value: string, display: string }>>, truncated: boolean }}
 */
export function parseSearchQuery(text) {
  const groups = [[]];
  let count = 0;
  let truncated = false;
  for (const token of tokenize(text)) {
    if (token === "|" || token === "OR") {
      if (groups.at(-1).length === 0) continue;
      if (groups.length >= MAX_GROUPS) {
        truncated = true;
        break;
      }
      groups.push([]);
      continue;
    }
    const term = parseTerm(token);
    if (!term) continue;
    if (count >= MAX_TERMS) {
      truncated = true;
      break;
    }
    groups.at(-1).push(term);
    count += 1;
  }
  return { groups: groups.filter((group) => group.length > 0), truncated };
}

/** @param {ReturnType<typeof parseSearchQuery> | null | undefined} parsed */
export function isEmptyQuery(parsed) {
  return !parsed || parsed.groups.length === 0;
}

/**
 * @param {ReturnType<typeof parseSearchQuery>} parsed
 * @param {Record<string, unknown>} fields 항목별 원문 (title, author, publisher, memo …)
 * @param {string} [defaultField] 항목을 적지 않은 낱말을 찾을 곳. "all" 이면 모든 항목
 */
export function matchesSearchQuery(parsed, fields, defaultField = "all") {
  if (isEmptyQuery(parsed)) return true;
  const cache = new Map();
  const text = (field) => {
    if (!cache.has(field)) {
      const source = field === "all" ? Object.values(fields).join(" ") : fields[field];
      cache.set(field, normalizeSearchText(source));
    }
    return cache.get(field);
  };
  const hit = (term) => text(term.field ?? defaultField).includes(term.value);
  return parsed.groups.some((group) => {
    // 제외어만 있는 묶음도 유효하다 ("-합본" = 합본이 아닌 것 전부).
    return group.every((term) => (term.exclude ? !hit(term) : hit(term)));
  });
}

/**
 * 해석 결과를 사람이 읽는 조건 목록으로. 화면에서 낱말별로 지울 수 있게 원문 토큰을 함께 준다.
 * @param {ReturnType<typeof parseSearchQuery>} parsed
 */
export function describeSearchQuery(parsed) {
  if (isEmptyQuery(parsed)) return [];
  return parsed.groups.flatMap((group, groupIndex) =>
    group.map((term, termIndex) => ({
      raw: term.raw,
      or: groupIndex > 0 && termIndex === 0,
      exclude: term.exclude,
      field: term.field,
      label: `${term.field ? `${FIELD_LABELS[term.field]}: ` : ""}${term.display}`,
    })),
  );
}

/** 검색어에서 토큰 하나를 지운다. 남은 `|` 가 맨 앞·맨 뒤·연속으로 놓이지 않게 정리한다. */
export function removeSearchToken(text, raw) {
  const tokens = tokenize(text);
  const index = tokens.indexOf(raw);
  if (index < 0) return String(text ?? "").trim();
  tokens.splice(index, 1);
  const isOr = (token) => token === "|" || token === "OR";
  const cleaned = tokens.filter((token, position) => !isOr(token) || (position > 0 && !isOr(tokens[position - 1])));
  while (cleaned.length > 0 && isOr(cleaned.at(-1))) cleaned.pop();
  return cleaned.join(" ");
}

export const SEARCH_HELP = "띄어쓰기 = 모두 포함 · A | B = 둘 중 하나 · -낱말 = 제외 · \"여러 낱말\" = 한 덩어리 · 작가:이름 / 제목: / 출판사:";
