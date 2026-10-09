/**
 * Does this section read like a *memory* rather than a definition?
 *
 * The failure this names, in the user's words: process notes — "I ran this code
 * at such a time and found the device was broken", "this algorithm does not
 * work" — get written into the notebook, and then every later turn reads them as
 * framework constraints. That is worse than wasted characters: it is a
 * *time-bound, low-quality constraint* on divergent work. Those records belong in
 * a run log or in a session-memory tool, not in the definitions a derivation is
 * allowed to assume.
 *
 * ## Why a heuristic, and why this one
 *
 * There is no schema that says "this paragraph is an anecdote" — the note is
 * Markdown written by a model and a human. So this is a **signal, never a
 * verdict**: it flags a section for a human to look at, reports the words that
 * triggered it, and moves nothing. It is deliberately hard to trigger on frozen
 * material:
 *
 *  - a **date alone never triggers**: `（2026-09-26 定稿）` and
 *    `2026-09-26 用户裁决` are provenance, which is exactly what a frozen entry
 *    should carry;
 *  - incident vocabulary alone, once, never triggers — a verdict legitimately
 *    says "FAIL 不等于物理失败";
 *  - it takes a *cluster*: several incident words, or incident words plus a
 *    narrative of runs and attempts.
 *
 * Calibrated against the real Z3 ledger: FROZEN-1/2, VERDICT-1-V1…V9, OPEN,
 * RULES and STAGE1-EVIDENCE stay clean; the sections that flag are FROZEN-3
 * (which carries 9×4/4×3 measurement narrative) and TASK-1 (a task list) — the
 * same two a human review pointed at.
 *
 * @module @suxeca/dsh-note-board/host/hygiene
 */

import { matchesSection } from '../sections.ts'
import type { SectionSmell } from '../shared.ts'

/** What a section looks like. Today there is exactly one smell worth naming. */
export type { SectionSmell }

/**
 * Sections that are *about* the notebook rather than knowledge inside it.
 *
 * A discipline section necessarily names the patterns it forbids — the
 * content-boundary rule says "设备故障", "走不通", "失败" in order to ban them —
 * so scoring its text makes the rule flag itself. That is not hypothetical: the
 * first draft of the rule was reported as a run record, which is how this
 * exemption was found. Exempting it is the honest fix; rewriting the rule to
 * dodge its own vocabulary would mean the next rule has to do the same.
 */
const META_SECTIONS = ['RULES*']

/** One section's smell, with the words that produced it. */
export interface SmellHint {
  readonly smell: SectionSmell
  /** Matched words, deduplicated and capped: shown to the human, never parsed. */
  readonly markers: readonly string[]
}

/** How many distinct marker words the hint keeps. */
const MARKER_LIMIT = 6

/**
 * The vocabulary, grouped by what it is evidence *of*.
 *
 * Kept as separate groups because the rule is about their combination: a single
 * incident word is normal in a verdict, and a date is normal everywhere.
 */
const GROUPS = {
  /** Things going wrong, or being fixed after going wrong. */
  incident: /走不通|行不通|不可行|不成立|失败|报错|崩溃|崩了|卡住|设备|故障|显存|内存|超时|排队|踩坑|教训|伪迹|误判|写错|算错|写反|疏漏/g,
  /** Narrative of runs, attempts and rounds. */
  episode: /本次|今天|昨天|上次|那次|当时|后来|一轮|二轮|三轮|实测|试了|尝试|跑了|提交了|作业|nsweeps/g,
  /** Pointers into a run's artifacts. */
  runref: /\.csv|\.log|stdout|stderr|runs\/|audit_reports\//g,
} as const

/** Unique matches of one group, in order of appearance — what a human is shown. */
function hits(text: string, pattern: RegExp): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(pattern)) found.add(match[0])
  return [...found]
}

/** How many times the group occurs, repeats included — what the rule scores. */
function occurrences(text: string, pattern: RegExp): number {
  let count = 0
  for (const _match of text.matchAll(pattern)) count += 1
  return count
}

/**
 * Classify one section, honouring the meta-content exemption.
 *
 * Callers always have the id, and the exemption is a fact about the id, so this
 * is the entry point they should use: {@link smellOf} alone cannot tell a rule
 * that names a failure mode from an entry that is one.
 * @param id - the section id, exactly as it appears after `## `.
 * @param text - the section's text.
 * @returns the smell and its evidence, or `null` when nothing clusters.
 */
export function smellOfSection(id: string, text: string): SmellHint | null {
  if (META_SECTIONS.some(pattern => matchesSection(id, [pattern]))) return null
  return smellOf(text)
}

/**
 * Classify one section body.
 * @param body - the section's text, heading included or not; both are fine.
 * @returns the smell and its evidence, or `null` when nothing clusters.
 */
export function smellOf(body: string): SmellHint | null {
  const incident = hits(body, GROUPS.incident)
  const episode = hits(body, GROUPS.episode)
  const runref = hits(body, GROUPS.runref)
  // Counts, not distinct words: a section that says 实测 six times is six
  // observations, and scoring it once lets exactly the drifting entry through.
  // (The first version used distinct words and silently missed FROZEN-3, whose
  // measurement narrative repeats one vocabulary rather than varying it.)
  const incidentCount = occurrences(body, GROUPS.incident)
  const episodeCount = occurrences(body, GROUPS.episode)
  const runrefCount = occurrences(body, GROUPS.runref)
  const flagged = incidentCount >= 3
    || (incidentCount >= 1 && episodeCount >= 3)
    || (incidentCount >= 2 && runrefCount >= 2)
  if (!flagged) return null
  return {
    smell: 'episodic',
    markers: [...incident, ...episode, ...runref].slice(0, MARKER_LIMIT),
  }
}
