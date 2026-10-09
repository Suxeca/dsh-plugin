/**
 * tex-source.ts — arXiv 原版 LaTeX 源码提取器
 * 绕过 PDF OCR 造成的公式上下标断裂与算符失真，直接从作者源码中提取数学物理算符与核心推导。
 */

import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

const FETCH_SCRIPT_PATH = '/home/suxeca/Workspace/.agents/skills/deep-read/fetch_arxiv_source.py'

export interface TexSourceResult {
  arxiv_id: string
  main_tex_file?: string
  total_files: number
  abstract?: string
  key_equations: string[]
  key_theorems: string[]
  summary_snippet: string
}

// 清理 TeX 注释
function stripTexComments(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/(?<!\\)(?:\\\\)*%.*$/, ''))
    .join('\n')
}

// 提取核心公式与环境
function extractMathBlocks(tex: string, maxBlocks: number = 8): string[] {
  const clean = stripTexComments(tex)
  const regex = /\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g
  const blocks: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(clean)) !== null) {
    const raw = match[0].trim()
    // 过滤掉过短或平凡的单变量定义
    if (raw.length > 25 && !blocks.includes(raw)) {
      blocks.push(raw)
      if (blocks.length >= maxBlocks) break
    }
  }
  return blocks
}

// 提取定理与命题
function extractTheorems(tex: string, maxTheorems: number = 5): string[] {
  const clean = stripTexComments(tex)
  const regex = /\\begin\{(theorem|lemma|proposition|definition|corollary)\}([\s\S]*?)\\end\{\1\}/gi
  const list: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(clean)) !== null) {
    const raw = match[0].trim()
    if (!list.includes(raw)) {
      list.push(raw)
      if (list.length >= maxTheorems) break
    }
  }
  return list
}

export async function fetchTexSource(arxivIdInput: string): Promise<TexSourceResult> {
  const cleanId = arxivIdInput.trim().replace(/^https?:\/\/arxiv\.org\/(abs|pdf|src)\//, '').replace(/\.pdf$/, '')

  return new Promise((resolve, reject) => {
    // 调用安全加固的 fetch_arxiv_source.py
    execFile(
      'python3',
      [FETCH_SCRIPT_PATH, cleanId, '--json'],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      async (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`arXiv 源码抓取失败 (${cleanId}): ${stderr || error.message}`))
        }

        try {
          // fetch_arxiv_source.py 输出 JSON 格式状态
          const data = JSON.parse(stdout.trim())
          const mainFile = data.main_tex
          if (!mainFile) {
            return resolve({
              arxiv_id: cleanId,
              total_files: data.total_files || 0,
              key_equations: [],
              key_theorems: [],
              summary_snippet: '未能定位主 TeX 文件，源码可能为非 LaTeX 格式。',
            })
          }

          const rawContent = await fs.readFile(mainFile, 'utf8')
          const keyEquations = extractMathBlocks(rawContent)
          const keyTheorems = extractTheorems(rawContent)

          // 截取摘要或引言前 800 字符作为简述
          const clean = stripTexComments(rawContent)
          const abstractMatch = clean.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/i)
          const abs = abstractMatch ? abstractMatch[1].replace(/\s+/g, ' ').trim() : ''

          resolve({
            arxiv_id: cleanId,
            main_tex_file: mainFile,
            total_files: data.total_files || 0,
            abstract: abs || undefined,
            key_equations: keyEquations,
            key_theorems: keyTheorems,
            summary_snippet: abs ? abs.slice(0, 500) : clean.slice(0, 500),
          })
        } catch (e: any) {
          reject(new Error(`解析 LaTeX 源码输出失败: ${e.message}`))
        }
      },
    )
  })
}
