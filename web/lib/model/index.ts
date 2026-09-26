/**
 * DecMarkt domain model (DATA_MODEL.md). Types only, plus the pure provenance checks.
 * Jev produces State, Question, AgentDecision and batches; DecMarkt adds aggregation,
 * action, outcome and settlement; the chain read layer fills the on-chain parts.
 */

export * from "./primitives";
export * from "./state";
export * from "./question";
export * from "./decision";
export * from "./aggregation";
export * from "./action";
export * from "./outcome";
export * from "./accountability";
export * from "./transaction";
export * from "./provenance";
