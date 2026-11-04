export const PAGE_SIZE = 9;
/** Item lists take two rows per entry. */
export const ITEM_PAGE_SIZE = 5;

export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, total: number, pageSize: number = PAGE_SIZE): number {
  const max = pageCount(total, pageSize) - 1;
  if (page < 0) return 0;
  if (page > max) return max;
  return page;
}

/** Greedy pages of at most `maxEntries` items whose summed heights fit `maxRows`; an item taller than `maxRows` gets a page to itself. Always at least one page. */
export function paginateByRows<T>(items: T[], heightOf: (item: T) => number, maxEntries: number, maxRows: number): T[][] {
  const pages: T[][] = [[]];
  let rows = 0;
  for (const item of items) {
    const height = heightOf(item);
    const page = pages[pages.length - 1]!;
    if (page.length > 0 && (page.length >= maxEntries || rows + height > maxRows)) {
      pages.push([item]);
      rows = height;
    } else {
      page.push(item);
      rows += height;
    }
  }
  return pages;
}

export function paginate<T>(items: T[], page: number, pageSize: number = PAGE_SIZE): { pageItems: T[]; page: number; pages: number; offset: number } {
  const pages = pageCount(items.length, pageSize);
  const clamped = clampPage(page, items.length, pageSize);
  const offset = clamped * pageSize;
  return { pageItems: items.slice(offset, offset + pageSize), page: clamped, pages, offset };
}
