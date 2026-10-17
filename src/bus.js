// A tiny in-process event bus. The assistant publishes what it is doing and
// the dashboard subscribes, so the UI is a live view of the real runtime.
import { EventEmitter } from "node:events";

const MAX_HISTORY = 300;

class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.history = [];
  }

  /** Publish an event. High-frequency "level" events are not buffered. */
  publish(type, payload = {}) {
    const event = { type, ...payload, ts: Date.now() };
    if (type !== "level") {
      this.history.push(event);
      if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    this.emit("event", event);
    return event;
  }

  recent(limit = MAX_HISTORY) {
    return this.history.slice(-limit);
  }

  clearHistory() {
    this.history = [];
  }
}

export const bus = new Bus();

// Convenience publishers, so call sites read clearly.
export const emit = {
  status: (status, detail = "") => bus.publish("status", { status, detail }),
  heard: (text, { ignored = false } = {}) => bus.publish("heard", { text, ignored }),
  said: (text) => bus.publish("said", { text }),
  typed: (text) => bus.publish("typed", { text }),
  level: (level) => bus.publish("level", { level }),
  reminder: (text, id) => bus.publish("reminder", { text, id }),
  notice: (text, level = "info") => bus.publish("notice", { text, level }),
};
