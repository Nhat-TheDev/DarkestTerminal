/** Digit keys only cover 1-9, so any selectable list longer than this needs paging. */
export const PAGE_SIZE = 9;

export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, total: number, pageSize: number = PAGE_SIZE): number {
  const max = pageCount(total, pageSize) - 1;
  if (page < 0) return 0;
  if (page > max) return max;
  return page;
}

export function paginate<T>(items: T[], page: number, pageSize: number = PAGE_SIZE): { pageItems: T[]; page: number; pages: number; offset: number } {
  const pages = pageCount(items.length, pageSize);
  const clamped = clampPage(page, items.length, pageSize);
  const offset = clamped * pageSize;
  return { pageItems: items.slice(offset, offset + pageSize), page: clamped, pages, offset };
}
