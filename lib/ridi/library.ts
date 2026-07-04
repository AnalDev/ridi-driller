import { ridiGet } from "./client";
import type { LibraryUnit, RidiCreds } from "./types";

const LIB = "https://library-api.ridibooks.com";

export interface LibraryCount {
  item_total_count: number;
  unit_total_count: number;
}

export async function fetchLibraryCount(creds: RidiCreds): Promise<LibraryCount> {
  return ridiGet<LibraryCount>(`${LIB}/items/main/count/`, { creds });
}

interface ItemsResponse {
  items: LibraryUnit[];
  server_info?: { server_date: string };
}

const PAGE = 300;

/**
 * Fetch every library unit (series + single books), paginating through
 * /items/main. `onPage` reports incremental progress.
 */
export async function fetchAllUnits(
  creds: RidiCreds,
  onPage?: (fetched: number, total: number) => void,
): Promise<LibraryUnit[]> {
  const { unit_total_count: total } = await fetchLibraryCount(creds);
  const units: LibraryUnit[] = [];
  for (let offset = 0; offset < total; offset += PAGE) {
    const url = `${LIB}/items/main/?offset=${offset}&limit=${PAGE}&orderBy=RECENTLY_PURCHASED&orderDirection=desc`;
    const res = await ridiGet<ItemsResponse>(url, { creds });
    if (!res.items?.length) break;
    units.push(...res.items);
    onPage?.(units.length, total);
  }
  return units;
}
