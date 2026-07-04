"use client";

import { useCallback, useEffect, useState } from "react";
import Onboarding from "@/components/Onboarding";
import Dashboard from "@/components/Dashboard";

type Count = { item_total_count: number; unit_total_count: number };

export default function Home() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  const [count, setCount] = useState<Count | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/session");
      const data = await res.json();
      if (data.loggedIn) {
        setCount(data.count);
        setState("in");
      } else {
        setState("out");
      }
    } catch {
      setState("out");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    setState("out");
    setCount(null);
  }

  if (state === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center text-neutral-500">
        불러오는 중…
      </main>
    );
  }

  if (state === "out") {
    return (
      <main className="flex-1">
        <Onboarding onDone={check} />
      </main>
    );
  }

  return (
    <main className="flex-1">
      <Dashboard count={count!} onLogout={logout} />
    </main>
  );
}
