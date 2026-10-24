// What a click on an element with data-action does. Each page and view registers its own
// actions when it loads, next to the markup that uses them, and the one delegated click
// handler (chrome.ts) runs them.

type Handler = (value: string, target: HTMLElement) => void;

const handlers = new Map<string, Handler>();

export function onAction(name: string, handler: Handler) {
  handlers.set(name, handler);
}

/** Runs the action of the element clicked (or the picker changed, with its choice), if it has one; false if it doesn't. */
export function runAction(target: HTMLElement): boolean {
  const handler = handlers.get(target.dataset.action ?? '');
  handler?.(target instanceof HTMLSelectElement ? target.value : (target.dataset.value ?? ''), target);
  return Boolean(handler);
}
