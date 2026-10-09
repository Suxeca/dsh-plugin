/** Pure, shared classification: the UI and injection must select the same content. */
export const DEFAULT_PINNED_SECTIONS = ['FROZEN*', 'RULES', 'VERDICT*']
export const DEFAULT_RUN_LOG_SECTIONS = ['MUTATION-LOG', 'RUN-LOG*', 'EXECUTION-LOG*', 'JOURNAL*']

export interface NoteSection {
  readonly id: string
  readonly heading: string
  readonly text: string
}

/** Exact ids or trailing-star prefixes, case-insensitive. */
export function matchesSection(id: string, patterns: readonly string[]): boolean {
  const upper = id.trim().toUpperCase()
  return patterns.some(pattern => {
    const value = pattern.trim().toUpperCase()
    return value !== '' && (value.endsWith('*') ? upper.startsWith(value.slice(0, -1)) : upper === value)
  })
}

/** Ignore fenced examples: a heading printed by a program is not a note boundary. */
export function sectionsOf(text: string): { preamble: string, sections: NoteSection[] } {
  const preamble: string[] = []
  const sections: NoteSection[] = []
  let current: { id: string, heading: string, lines: string[] } | undefined
  let fence: { marker: string, length: number } | undefined
  const flush = () => {
    if (current !== undefined) sections.push({ id: current.id, heading: current.heading, text: current.lines.join('\n').trimEnd() })
  }
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const fenced = fence !== undefined
    if (marker !== null) {
      if (!fenced && !(marker[1][0] === '`' && marker[2].includes('`'))) {
        fence = { marker: marker[1][0], length: marker[1].length }
      } else if (fence !== undefined && marker[1][0] === fence.marker && marker[1].length >= fence.length && marker[2].trim() === '') {
        fence = undefined
      }
    }
    const heading = !fenced && marker === null ? /^##\s+(\S+)/.exec(line) : null
    if (heading !== null) {
      flush()
      current = { id: heading[1], heading: line.replace(/^##\s+/, '').trim(), lines: [line] }
    } else if (current === undefined) preamble.push(line)
    else current.lines.push(line)
  }
  flush()
  return { preamble: preamble.join('\n').trim(), sections }
}

export interface NoteSelection {
  readonly preamble: string
  readonly knowledge: readonly NoteSection[]
  readonly logs: readonly NoteSection[]
  readonly pinned: readonly NoteSection[]
  readonly onDemand: readonly NoteSection[]
  /** Preamble + whole pinned sections; a headingless file stays whole. */
  readonly residentText: string
  readonly knowledgeText: string
  readonly logsText: string
}

/** Log classification wins even over pinnedSections: ['*']; no file is rewritten. */
export function selectNote(
  text: string,
  pinned: readonly string[] = DEFAULT_PINNED_SECTIONS,
  logs: readonly string[] = DEFAULT_RUN_LOG_SECTIONS,
): NoteSelection {
  const parsed = sectionsOf(text)
  const knowledge = parsed.sections.filter(section => !matchesSection(section.id, logs))
  const runLogs = parsed.sections.filter(section => matchesSection(section.id, logs))
  const kept = knowledge.filter(section => matchesSection(section.id, pinned))
  const onDemand = knowledge.filter(section => !matchesSection(section.id, pinned))
  const join = (parts: readonly string[]) => parts.filter(Boolean).join('\n\n')
  return {
    preamble: parsed.preamble,
    knowledge,
    logs: runLogs,
    pinned: kept,
    onDemand,
    residentText: join([parsed.preamble, ...kept.map(section => section.text)]),
    knowledgeText: join([parsed.preamble, ...knowledge.map(section => section.text)]),
    logsText: join(runLogs.map(section => section.text)),
  }
}

export interface InjectionPlan {
  readonly residentChars: number
  readonly budget: number
  readonly overBudget: boolean
  readonly pinnedIds: readonly string[]
  readonly onDemandIds: readonly string[]
  readonly logIds: readonly string[]
  /** A partial disk read must never be presented as complete authoritative knowledge. */
  readonly blocked: boolean
}

export function injectionPlan(selection: NoteSelection, budget: number, truncated = false): InjectionPlan {
  const residentChars = truncated ? 0 : selection.residentText.length
  return {
    residentChars, budget, overBudget: residentChars > budget,
    pinnedIds: truncated ? [] : selection.pinned.map(section => section.id),
    onDemandIds: selection.onDemand.map(section => section.id),
    logIds: selection.logs.map(section => section.id),
    blocked: truncated,
  }
}

/** A deterministic read obligation, not a claim of automatic semantic retrieval. */
export function knowledgeIndex(selection: NoteSelection): string {
  if (selection.onDemand.length === 0) return ''
  return [
    '[未注入的节 / 知识目录] 以下只列标题，不含正文；未列出不等于已被删除，不能据标题推断结论：',
    ...selection.onDemand.map(section => `- ${section.heading}`),
    '回答涉及这些条目时，优先调用 note_board_read，按 section_id 读取相关完整知识条目及其依赖定义、适用条件和证据；不能仅凭目录作答。',
    '不要为读取知识而整文件读取同文件的运行日志。工具不可用时，再用文件工具定位所需节并限制读取范围。',
    '若条目返回分页，按返回的 continuation 继续读取，保持 revision 一致，直到 complete=true。若 complete=false 且无 continuation，或版本变化、依赖不明、工具不可用，先处理或说明缺口，不得声称已核对。',
  ].join('\n')
}
