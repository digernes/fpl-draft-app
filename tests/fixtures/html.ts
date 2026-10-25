// Reading the page's markup in tests: a card by its title, the text a reader sees, and the
// rows of a card's list, its tiles and the cards' titles in order.

/** The card titled `title` (its whole <section>), or '' when there is none. */
export function cardTitled(html: string, title: string): string {
  return (
    html
      .split(/(?=<section class="card)/)
      .find((part) => part.includes(`<h2 class="card-title">${title}</h2>`))
      ?.replace(/<\/section>[\s\S]*$/, '</section>') ?? ''
  );
}

/** The markup's text, tags dropped and white space run together, as a reader would see it. */
export const text = (html: string) =>
  html
    .replace(/<[a-z/!][^>]*>/gi, ' ') // a < before a number is text, as browsers read it
    .replace(/\s+/g, ' ')
    .replace(/ ,/g, ',')
    .trim();

/** The text of each row of the lists in the markup (listRow's), in order. */
export const listRows = (html: string) =>
  html
    .split(/<div class="lrow(?: mine)?">/)
    .slice(1)
    .map((row) => text(row.split('\n  </div>')[0])); // where listRow closes its row

/** Each tile's label, value and note, as "label: value · note". */
export const tiles = (html: string) =>
  [...html.matchAll(/<div class="tile-label">(.*?)<\/div><div class="tile-value">(.*?)<\/div><div class="tile-meta">(.*?)<\/div>/g)].map(
    ([, label, value, meta]) => `${text(label)}: ${text(value)}${meta ? ` · ${text(meta)}` : ''}`,
  );

/** The cards' titles, in the order they come. */
export const cardTitles = (html: string) => [...html.matchAll(/<h2 class="card-title">(.*?)<\/h2>/g)].map((m) => text(m[1]));
