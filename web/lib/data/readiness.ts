import "server-only";
import { deployment } from "@/lib/chain/deployments";
import { envDiagnostics, invalidEnvVars, serverEnv } from "@/lib/config/server";
import { providerStatus } from "@/lib/ai";
import { AGENTS } from "@/lib/jev/agents";
import { sessionsConfigured } from "@/lib/server/operator-session";

/**
 * What the live round needs, reported as presence flags only. Secret values never
 * leave this function.
 */
export interface Readiness {
  contracts: { ok: boolean; detail: string };
  ai: { ok: boolean; detail: string };
  oracle: { ok: boolean; detail: string };
  signers: { ok: boolean; detail: string };
  /** Variables that are set but malformed and therefore ignored (names only). */
  invalidEnv: string[];
  /** Deployment and key-name diagnostics (names only, never values). */
  env: ReturnType<typeof envDiagnostics>;
  ready: boolean;
  /** What a round can do right now. */
  mode: "live" | "simulation" | "unavailable";
  modeDetail: string;
  modes: {
    simulation: { ok: boolean; reason: string };
    live: { ok: boolean; reason: string };
  };
}

export function readiness(): Readiness {
  const env = serverEnv();
  const d = deployment();
  const ai = providerStatus();
  const agentKeys = AGENTS.filter((a) => !!env[a.operatorKeyEnv]).length;
  const signersOk = agentKeys === AGENTS.length && !!env.PROPOSER_PRIVATE_KEY && !!env.KEEPER_PRIVATE_KEY;

  const r = {
    contracts: d.deployed
      ? { ok: true, detail: "Dört kontratın tümü dağıtıldı" }
      : { ok: false, detail: `Dağıtılmamış: ${d.missing.join(", ")}` },
    ai: ai.configured
      ? { ok: true, detail: `Sağlayıcı yapılandırıldı (${ai.provider} · ${ai.model})` }
      : { ok: false, detail: ai.reason ?? "AI sağlayıcı yapılandırılmamış" },
    oracle: env.PYTH_API_KEY
      ? { ok: true, detail: "Pyth Hermes anahtarı yapılandırıldı" }
      : { ok: false, detail: "PYTH_API_KEY yapılandırılmamış (Hermes 2026-08-26'dan beri zorunlu tutuyor)" },
    signers: signersOk
      ? { ok: true, detail: "Proposer, keeper ve 5 ajan operatörü yapılandırıldı" }
      : { ok: false, detail: `${agentKeys}/5 ajan operatörü, proposer ${env.PROPOSER_PRIVATE_KEY ? "var" : "eksik"}, keeper ${env.KEEPER_PRIVATE_KEY ? "var" : "eksik"}` },
  };
  const ready = r.contracts.ok && r.ai.ok && r.oracle.ok && r.signers.ok;
  const simulation = r.ai.ok
    ? { ok: true, reason: r.oracle.ok ? "Gerçek durum ve gerçek ajanlar; yürütme, doğrulama ve uzlaşma yerel olarak hesaplanır. İşlem yok." : "Eyleme kadar çalışır; doğrulama için PYTH_API_KEY gerekir." }
    : { ok: false, reason: r.ai.detail };
  const live = !r.ai.ok
    ? { ok: false, reason: r.ai.detail }
    : !r.contracts.ok
      ? { ok: false, reason: r.contracts.detail }
      : !r.signers.ok
        ? { ok: false, reason: r.signers.detail }
        : !sessionsConfigured()
          ? { ok: false, reason: "SESSION_SECRET yapılandırılmamış ya da 32 karakterden kısa (operatör girişi)" }
          : { ok: true, reason: r.oracle.ok ? "Her aşama bir Monad Testnet işlemidir. Operatör girişi gerekir." : "Onaya kadar çalışır; yürütme imzalı fiyat için PYTH_API_KEY gerektirir." };
  const mode = live.ok ? "live" : simulation.ok ? "simulation" : "unavailable";
  const modeDetail = mode === "live" ? live.reason : mode === "simulation" ? simulation.reason : "Hiçbir AI sağlayıcı yapılandırılmadığı için hiçbir ajan değerlendirme yapamaz. Hiçbir şey simüle edilmez.";
  return { ...r, invalidEnv: invalidEnvVars(), env: envDiagnostics(), ready, mode, modeDetail, modes: { simulation, live } };
}
