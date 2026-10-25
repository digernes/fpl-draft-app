// What the page's modules read of the browser when they load (state.ts reads the address
// and the stored settings), so tests can import them in Node. Import it before them.
// drawIntoNothing() then gives them a page to draw into for tests of what an action or a
// file coming in does: a redraw goes nowhere, and what the test checks is what changed.

Object.assign(globalThis, {
  location: { search: '', hash: '', href: 'http://localhost/', pathname: '/' },
  localStorage: { getItem: () => null, setItem() {} },
});

// Takes every call and property and gives itself back; reads as '' and isn't a promise.
const nothing: unknown = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : nothing),
  apply: () => nothing,
});

/** A document, a window and the rest of what drawing a page touches, all of them nothing but what `page` says of the document (whether it's hidden, say). */
export function drawIntoNothing(page: Record<string | symbol, unknown> = {}) {
  Object.assign(globalThis, {
    document: new Proxy(page, { get: (t, key) => (key in t ? t[key] : nothing) }),
    window: nothing,
    history: nothing,
    matchMedia: () => ({ matches: false }),
    HTMLSelectElement: class {},
    HTMLDialogElement: class {},
  });
}
