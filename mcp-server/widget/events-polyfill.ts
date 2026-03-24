type Handler = (...args: unknown[]) => void;

type ListenerMap = Map<string, Set<Handler>>;

type EventEmitterInstance = {
  __listeners?: ListenerMap;
};

function getListeners(instance: EventEmitterInstance): ListenerMap {
  if (!instance.__listeners) {
    instance.__listeners = new Map<string, Set<Handler>>();
  }
  return instance.__listeners;
}

type EventEmitterCtor = {
  new (): EventEmitterInstance;
  (this: EventEmitterInstance): void;
  prototype: {
    on(event: string, handler: Handler): EventEmitterInstance;
    addListener(event: string, handler: Handler): EventEmitterInstance;
    once(event: string, handler: Handler): EventEmitterInstance;
    off(event: string, handler: Handler): EventEmitterInstance;
    removeListener(event: string, handler: Handler): EventEmitterInstance;
    emit(event: string, ...args: unknown[]): boolean;
    removeAllListeners(event?: string): EventEmitterInstance;
    setMaxListeners(maxListeners: number): EventEmitterInstance;
  };
};

export const EventEmitter = function EventEmitter(
  this: EventEmitterInstance,
) {
  getListeners(this);
} as EventEmitterCtor;

EventEmitter.prototype.on = function on(
  this: EventEmitterInstance,
  event: string,
  handler: Handler,
) {
  const listeners = getListeners(this);
  const existing = listeners.get(event) ?? new Set<Handler>();
  existing.add(handler);
  listeners.set(event, existing);
  return this;
};

EventEmitter.prototype.addListener = function addListener(
  this: EventEmitterInstance,
  event: string,
  handler: Handler,
) {
  return this.on(event, handler);
};

EventEmitter.prototype.once = function once(
  this: EventEmitterInstance,
  event: string,
  handler: Handler,
) {
  const wrapped: Handler = (...args: unknown[]) => {
    this.removeListener(event, wrapped);
    handler(...args);
  };
  return this.on(event, wrapped);
};

EventEmitter.prototype.off = function off(
  this: EventEmitterInstance,
  event: string,
  handler: Handler,
) {
  const listeners = getListeners(this);
  const existing = listeners.get(event);
  if (!existing) {
    return this;
  }
  existing.delete(handler);
  if (existing.size === 0) {
    listeners.delete(event);
  }
  return this;
};

EventEmitter.prototype.removeListener = function removeListener(
  this: EventEmitterInstance,
  event: string,
  handler: Handler,
) {
  return this.off(event, handler);
};

EventEmitter.prototype.emit = function emit(
  this: EventEmitterInstance,
  event: string,
  ...args: unknown[]
) {
  const listeners = getListeners(this);
  const existing = listeners.get(event);
  if (!existing || existing.size === 0) {
    return false;
  }
  for (const handler of [...existing]) {
    handler(...args);
  }
  return true;
};

EventEmitter.prototype.removeAllListeners = function removeAllListeners(
  this: EventEmitterInstance,
  event?: string,
) {
  const listeners = getListeners(this);
  if (typeof event === "string") {
    listeners.delete(event);
    return this;
  }
  listeners.clear();
  return this;
};

EventEmitter.prototype.setMaxListeners = function setMaxListeners(
  this: EventEmitterInstance,
  _maxListeners: number,
) {
  return this;
};

export default { EventEmitter };
