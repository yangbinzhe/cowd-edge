class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}

  observe(_target: Element) {}

  unobserve(_target: Element) {}

  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof SVGElement !== 'undefined' && typeof SVGElement.prototype.getBBox !== 'function') {
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 120, height: 20, top: 0, right: 120, bottom: 20, left: 0, toJSON: () => ({}) }) as DOMRect;
}

for (const [property, value] of [['clientWidth', 1024], ['offsetWidth', 1024], ['clientHeight', 768], ['offsetHeight', 768]] as const) {
  Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => value });
}
