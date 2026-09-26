"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/status";
import { classifyTxError } from "@/lib/chain/tx-errors";
import { shortHex } from "@/lib/format";

export interface Operator {
  address: string;
  role: string;
  exp: number;
}

/** The signed-in operator from the session cookie; null when not signed in or unreachable. */
async function currentOperator(): Promise<Operator | null> {
  const res = await fetch("/api/operator/session", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { operator: Operator | null }).operator;
}

/**
 * Operator sign-in: the connected wallet signs a server challenge; the server checks its
 * on-chain role (admin or guardian) and opens a 30-minute session. Required for anything
 * that spends the server's keys (live rounds, keeper steps). Signing sends no transaction.
 */
export function useOperatorSession() {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signMessageAsync } = useSignMessage();

  const refresh = useCallback(async () => setOperator(await currentOperator()), []);

  useEffect(() => {
    let alive = true;
    void currentOperator().then((op) => alive && setOperator(op));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await fetch("/api/operator/challenge", { cache: "no-store" });
      const challenge = (await c.json()) as { message?: string; error?: string };
      if (!c.ok || !challenge.message) throw new Error(challenge.error ?? "Challenge unavailable");
      const signature = await signMessageAsync({ message: challenge.message });
      const res = await fetch("/api/operator/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: challenge.message, signature }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Sign-in failed (${res.status})`);
      await refresh();
    } catch (err) {
      const e = classifyTxError(err);
      setError(e.kind === "rejected" ? "Signature rejected in the wallet." : e.message);
    } finally {
      setBusy(false);
    }
  }, [refresh, signMessageAsync]);

  const signOut = useCallback(async () => {
    await fetch("/api/operator/session", { method: "DELETE" });
    setOperator(null);
  }, []);

  return { operator, error, busy, signIn, signOut };
}

export function OperatorSessionBar({ session }: { session: ReturnType<typeof useOperatorSession> }) {
  const { isConnected } = useAccount();
  const { operator, error, busy, signIn, signOut } = session;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
      {operator ? (
        <>
          <StatusMark tone="pass">operator · {operator.role}</StatusMark>
          <span className="font-mono text-ink-2">{shortHex(operator.address, 4, 4)}</span>
          <button type="button" onClick={signOut} className="text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink">
            Sign out
          </button>
        </>
      ) : (
        <>
          <StatusMark tone="neutral">operator sign-in required</StatusMark>
          <Button variant="secondary" onClick={signIn} disabled={!isConnected || busy}>
            {busy ? "Waiting for signature…" : "Sign in with wallet"}
          </Button>
          {!isConnected && <span className="text-ink-3">connect the admin or guardian wallet first</span>}
        </>
      )}
      {error && <span className="text-fail">{error}</span>}
    </div>
  );
}
