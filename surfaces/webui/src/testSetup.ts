class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}

  observe(_target: Element) {}

  unobserve(_target: Element) {}

  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
