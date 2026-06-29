/**
 * Event Bus — typed in-process pub/sub that decouples producers (Agent Manager,
 * WS server, Orchestrator) from consumers (Memory Engine, WS push, Orchestrator).
 * MVP implementation; can graduate to NATS/Redis later. See docs/ARCHITECTURE.md §2.4.
 */

import type { CatoEvent, EventType } from "@cato/shared";

type Handler = (event: CatoEvent) => void;

export class EventBus {
  #all = new Set<Handler>();
  #byType = new Map<EventType, Set<Handler>>();

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(handler: Handler): () => void {
    this.#all.add(handler);
    return () => this.#all.delete(handler);
  }

  /** Subscribe to a single event type. Returns an unsubscribe function. */
  on(type: EventType, handler: Handler): () => void {
    let set = this.#byType.get(type);
    if (!set) {
      set = new Set();
      this.#byType.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Publish an event to all matching subscribers. */
  emit(event: CatoEvent): void {
    for (const h of this.#byType.get(event.type) ?? []) h(event);
    for (const h of this.#all) h(event);
  }
}
