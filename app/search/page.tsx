import type { Metadata } from "next";
import StoreSearch from "@/components/StoreSearch";

export const metadata: Metadata = {
  title: "도서 검색 · 리디 드릴러",
  description: "알라딘, 교보문고, 리디에서 도서와 정식 무료 eBook을 검색합니다.",
};

export default function SearchPage() {
  return <StoreSearch />;
}
