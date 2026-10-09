import z from 'schemastery'

export interface Config {
  s2ApiKey?: string
  crossrefMailto?: string
  scihubBaseUrl?: string
  tavilyApiKey?: string
}

export const Config = z.object({
  s2ApiKey: z.string().description('Semantic Scholar API Key（可选，避免频繁 429）').default(''),
  crossrefMailto: z.string().description('Crossref polite pool 邮箱（可选，提升请求限额）').default(''),
  scihubBaseUrl: z.string().description('Sci-Hub 基础域名').default('https://sci-hub.se'),
  tavilyApiKey: z.string().description('Tavily API Key（可选，用于 web 噪声补充）').default(''),
})
