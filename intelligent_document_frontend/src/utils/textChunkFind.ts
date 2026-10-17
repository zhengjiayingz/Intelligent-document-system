/** 文本分块预览：连续子串查找（大小写不敏感） */

export type TextChunkFindMatch = {
  /** 含 */
  start: number
  /** 不含 */
  end: number
}

/** trim 后为空则视为无效查询 */
export function normalizeFindQuery(query: string): string {
  return query.trim()
}

/**
 * 在 haystack 中查找 needle 的全部连续出现（大小写不敏感）。
 * 允许重叠起点（与常见浏览器查找一致，如 aaaa 中的 aa）。
 */
export function findContiguousMatches(haystack: string, needle: string): TextChunkFindMatch[] {
  const q = normalizeFindQuery(needle)
  if (!q) return []
  const h = haystack.toLocaleLowerCase()
  const n = q.toLocaleLowerCase()
  if (n.length > h.length) return []

  const out: TextChunkFindMatch[] = []
  let from = 0
  while (from <= h.length - n.length) {
    const i = h.indexOf(n, from)
    if (i < 0) break
    out.push({ start: i, end: i + n.length })
    from = i + 1
  }
  return out
}

/** 从 fromOffset 起（含）的下一处；若无则绕回 0；无命中返回 -1 */
export function findMatchIndexAtOrAfter(
  matches: TextChunkFindMatch[],
  fromOffset: number,
): number {
  if (matches.length === 0) return -1
  for (let i = 0; i < matches.length; i++) {
    if (matches[i]!.start >= fromOffset) return i
  }
  return 0
}

/** 从 fromOffset 往前（严格小于）的上一处；若无则绕到最后；无命中返回 -1 */
export function findMatchIndexAtOrBefore(
  matches: TextChunkFindMatch[],
  fromOffset: number,
): number {
  if (matches.length === 0) return -1
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i]!.start < fromOffset) return i
  }
  return matches.length - 1
}
