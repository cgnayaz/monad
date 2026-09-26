"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { keccak256, stringToBytes } from "viem";
import { useAccount, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { OperatorSessionBar, useOperatorSession } from "@/components/wallet/operator-session";
import { Button, LinkButton } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { StatusMark } from "@/components/ui/status";
import { decisionRegistryAbi } from "@/lib/chain/abis";
import { explorer, monadTestnet } from "@/lib/chain/monad";
import { classifyTxError } from "@/lib/chain/tx-errors";
import { wagmiConfig } from "@/lib/chain/wagmi";
import { formatMon } from "@/lib/format";
import { agentName } from "@/lib/i18n";
import type { SetupStatus } from "@/lib/data/setup";

const PROPOSER_ROLE = keccak256(stringToBytes("PROPOSER_ROLE"));

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="border-b border-rule px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-medium">
          <span className="mr-2 font-mono text-[12px] text-ink-3">{n}</span>
          {title}
        </p>
        <StatusMark tone={done ? "pass" : "wait"}>{done ? "tamam" : "bekliyor"}</StatusMark>
      </div>
      <div className="mt-2 text-[13px] text-ink-2">{children}</div>
    </li>
  );
}

export function SetupSteps({ s, funding }: { s: SetupStatus; funding: { proposer: string; agentBond: string; agentGas: string; keeperGas: string } }) {
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const session = useOperatorSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ label: string; hash?: string; error?: string }[]>([]);

  if (!s.configured) {
    return (
      <div className="max-w-[760px] border border-rule bg-surface px-5 py-4 text-[13.5px] leading-[21px]">
        <p className="font-medium">1 · Vercel&apos;e SIGNER_SEED ekleyin</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
          <li>
            64 karakterlik rastgele bir metin üretin. Windows PowerShell: <code className="font-mono text-ink">[guid]::NewGuid().ToString(&apos;N&apos;) + [guid]::NewGuid().ToString(&apos;N&apos;)</code> — Mac/Linux:{" "}
            <code className="font-mono text-ink">openssl rand -hex 32</code>
          </li>
          <li>
            Vercel → decmarkt → Settings → Environment Variables → Name: <code className="font-mono text-ink">SIGNER_SEED</code>, Value: ürettiğiniz metin, Production işaretli → Save.
          </li>
          <li>Deployments → ⋯ → Redeploy. Sonra bu sayfayı yenileyin.</li>
        </ol>
        <p className="mt-3 text-[12px] text-ink-3">Bu değeri kimseyle paylaşmayın ve değiştirmeyin: 7 imzacı anahtarı bundan türetilir; değişirse adresler de değişir.</p>
      </div>
    );
  }

  const wrongChain = isConnected && chainId !== monadTestnet.id;
  const unregistered = s.agents.filter((a) => !a.registered);
  const bondsOk = s.agents.every((a) => a.registered && BigInt(a.bond ?? "0") >= BigInt(funding.agentBond));
  const gasOk = s.agents.every((a) => BigInt(a.balance) >= BigInt(funding.agentGas)) && !!s.keeper && BigInt(s.keeper.balance) >= BigInt(funding.keeperGas);
  const proposerFunded = !!s.proposer && BigInt(s.proposer.balance) >= BigInt(funding.proposer) / 2n;
  const allDone = unregistered.length === 0 && !!s.proposer?.hasRole && bondsOk && gasOk;

  const run = async (label: string, fn: () => Promise<`0x${string}` | void>) => {
    setBusy(label);
    try {
      const hash = await fn();
      if (hash) {
        const r = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: monadTestnet.id });
        if (r.status !== "success") throw new Error("İşlem zincirde başarısız oldu");
      }
      setLog((l) => [...l, { label, hash: hash ?? undefined }]);
      router.refresh();
      return true;
    } catch (err) {
      const e = classifyTxError(err);
      setLog((l) => [...l, { label, error: e.message }]);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const registerAll = async () => {
    let count = s.agentCount ?? 0;
    for (const a of unregistered) {
      // Roles are registered in order so that agentId % 5 maps back to the role.
      if (count % 5 !== a.index) {
        setLog((l) => [...l, { label: `${agentName(a.key, a.name)} kaydı`, error: `Sıra uyuşmuyor: sıradaki kimlik ${count}, bu rol ${a.index} (mod 5) bekliyor. Önceki rolleri önce kaydedin.` }]);
        return;
      }
      const ok = await run(`${agentName(a.key, a.name)} kaydı`, () =>
        writeContractAsync({ chainId: monadTestnet.id, address: s.registry!, abi: decisionRegistryAbi, functionName: "registerAgent", args: [a.address, keccak256(stringToBytes(a.name)), ""] }),
      );
      if (!ok) return;
      count++;
    }
  };

  const distribute = async () => {
    setBusy("Teminat ve gas dağıtımı");
    try {
      const res = await fetch("/api/setup/distribute", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { txs?: { label: string; hash: string }[]; error?: string } | null;
      if (!res.ok || !body?.txs) throw new Error(body?.error ?? `İstek başarısız (${res.status})`);
      setLog((l) => [...l, ...(body.txs!.length ? body.txs!.map((t) => ({ label: t.label, hash: t.hash })) : [{ label: "Dağıtım: eksik yok" }])]);
      router.refresh();
    } catch (err) {
      setLog((l) => [...l, { label: "Teminat ve gas dağıtımı", error: (err as Error).message }]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <div className="border border-rule bg-surface px-5 py-3 text-[13px]">
          {!isConnected ? (
            <span className="text-ink-2">Önce sağ üstten admin cüzdanını (0xbAB6…0B97) bağlayın.</span>
          ) : wrongChain ? (
            <Button variant="secondary" onClick={() => switchChain({ chainId: monadTestnet.id })}>
              Monad Testnet&apos;e geç
            </Button>
          ) : (
            <span className="text-ink-2">Cüzdan bağlı. Adımları sırayla onaylayın; her adımdan sonra sayfa zincirden yeniden okunur.</span>
          )}
        </div>
        <ol className="border border-rule bg-surface">
          <Step n={1} title="SIGNER_SEED" done>
            İmzacı anahtarları sunucuda {s.derived ? "SIGNER_SEED'den türetildi" : "ortam değişkenlerinden okundu"}.
          </Step>
          <Step n={2} title="5 ajan operatörünü kaydet" done={unregistered.length === 0}>
            <ul className="mb-3 space-y-1">
              {s.agents.map((a) => (
                <li key={a.key} className="flex flex-wrap items-center gap-x-3">
                  <span className="w-36 font-medium text-ink">{agentName(a.key, a.name)}</span>
                  <Hash value={a.address} href={explorer.address(a.address)} />
                  <StatusMark tone={a.registered ? "pass" : "neutral"}>{a.registered ? `kayıtlı · ajan ${a.agentId}` : "kayıtsız"}</StatusMark>
                </li>
              ))}
            </ul>
            {unregistered.length > 0 && (
              <Button disabled={!isConnected || wrongChain || !!busy} onClick={registerAll}>
                {busy?.endsWith("kaydı") ? `${busy}…` : `${unregistered.length} ajanı kaydet (${unregistered.length} onay)`}
              </Button>
            )}
          </Step>
          <Step n={3} title="Proposer rolünü ver" done={!!s.proposer?.hasRole}>
            {s.proposer && <Hash value={s.proposer.address} href={explorer.address(s.proposer.address)} />}
            {!s.proposer?.hasRole && (
              <div className="mt-2">
                <Button
                  disabled={!isConnected || wrongChain || !!busy}
                  onClick={() => run("Proposer rolü", () => writeContractAsync({ chainId: monadTestnet.id, address: s.registry!, abi: decisionRegistryAbi, functionName: "grantRole", args: [PROPOSER_ROLE, s.proposer!.address] }))}
                >
                  Proposer rolünü ver (1 onay)
                </Button>
              </div>
            )}
          </Step>
          <Step n={4} title="Proposer'ı fonla" done={proposerFunded || (bondsOk && gasOk)}>
            Proposer bakiyesi: <span className="font-mono">{s.proposer ? formatMon(BigInt(s.proposer.balance)) : "—"} MON</span>. Teminatlar ve gas bundan dağıtılır.
            {!proposerFunded && !(bondsOk && gasOk) && (
              <div className="mt-2">
                <Button
                  disabled={!isConnected || wrongChain || !!busy}
                  onClick={() => run("Proposer fonlama", () => sendTransactionAsync({ chainId: monadTestnet.id, to: s.proposer!.address, value: BigInt(funding.proposer) }))}
                >
                  {formatMon(BigInt(funding.proposer), 1)} MON gönder (1 onay)
                </Button>
              </div>
            )}
          </Step>
          <Step n={5} title="Teminat ve gas dağıt" done={bondsOk && gasOk}>
            Her ajana {formatMon(BigInt(funding.agentBond), 2)} MON teminat ve {formatMon(BigInt(funding.agentGas), 2)} MON gas, keeper&apos;a {formatMon(BigInt(funding.keeperGas), 2)} MON gas. İşlemleri sunucu proposer bakiyesinden gönderir; admin cüzdanıyla bir kez imza ile giriş gerekir.
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <OperatorSessionBar session={session} />
              {!(bondsOk && gasOk) && (
                <Button disabled={!session.operator || unregistered.length > 0 || !!busy} onClick={distribute}>
                  {busy === "Teminat ve gas dağıtımı" ? "Dağıtılıyor…" : "Dağıt"}
                </Button>
              )}
            </div>
          </Step>
        </ol>
        {allDone && (
          <div className="border border-pass px-5 py-4 text-[13.5px]">
            <p className="font-medium text-pass">Kurulum tamam — canlı mod hazır.</p>
            <p className="mt-1 text-ink-2">Demo sayfasında &quot;Canlı testnet modu&quot;nu seçin, cüzdanla giriş yapın ve &quot;Canlı turu başlat&quot;a basın.</p>
            <div className="mt-3">
              <LinkButton href="/demo" variant="primary">
                Demo&apos;ya git
              </LinkButton>
            </div>
          </div>
        )}
      </div>
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="border border-rule bg-surface">
          <p className="border-b border-rule px-4 py-2.5 text-[13px] font-semibold">İşlem günlüğü</p>
          {log.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-ink-3">Henüz işlem yok.</p>
          ) : (
            <ul className="divide-y divide-rule text-[12.5px]">
              {log.map((l, i) => (
                <li key={i} className="px-4 py-2">
                  <p className={l.error ? "text-fail" : ""}>{l.label}</p>
                  {l.hash && (
                    <a href={explorer.tx(l.hash as `0x${string}`)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-ink-3 underline decoration-rule underline-offset-2">
                      {l.hash.slice(0, 12)}…
                    </a>
                  )}
                  {l.error && <p className="text-[11.5px] text-fail">{l.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
