type Handler = (...args: unknown[]) => void;

export class EventEmitter {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler) {
    const existing = this.listeners.get(event) ?? new Set<Handler>();
    existing.add(handler);
    this.listeners.set(event, existing);
    return this;
  }

  addListener(event: string, handler: Handler) {
    return this.on(event, handler);
  }

  once(event: string, handler: Handler) {
    const wrapped: Handler = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler: Handler) {
    const existing = this.listeners.get(event);
    if (!existing) {
      return this;
    }
    existing.delete(handler);
    if (existing.size === 0) {
      this.listeners.delete(event);
    }
    return this;
  }

  removeListener(event: string, handler: Handler) {
    return this.off(event, handler);
  }

  emit(event: string, ...args: unknown[]) {
    const existing = this.listeners.get(event);
    if (!existing || existing.size === 0) {
      return false;
    }
    for (const handler of [...existing]) {
      handler(...args);
    }
    return true;
  }

  removeAllListeners(event?: string) {
    if (typeof event === "string") {
      this.listeners.delete(event);
      return this;
    }
    this.listeners.clear();
    return this;
  }

  setMaxListeners(_maxListeners: number) {
    return this;
  }
}

export default {
  EventEmitter,
};
