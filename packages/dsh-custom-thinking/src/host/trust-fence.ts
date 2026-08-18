/**
 * 浏览器信任围栏：与 /api 网关（@deepseek-ai/dsh-client-connection 的
 * api-request-trust + loopback-hostname，BSD-3-Clause）行为一致的自包含副本。
 * Host-header 回环或受信 authority 放行；跨站浏览器标记拒绝。
 * 这是 DNS-rebinding / 跨站防御，不是身份认证。
 * @module dsh-custom-thinking/host/trust-fence
 */
import type { IncomingHttpHeaders } from 'node:http'

/** 围栏读取的请求事实（IncomingMessage 的结构子集）。 */
interface TrustRequest {
  headers: IncomingHttpHeaders
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** 归一化 URL 的 hostname 是否命名本机回环 authority。 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * 决定一个请求是否可到达本插件路由。
 * @param request - node HTTP 请求事实（headers）。
 * @param trustedHosts - 本部署服务的非回环 authority。
 * @returns Host 属于本机（回环或受信）且浏览器标记同源时为 true。
 */
export function isTrustedApiRequest(request: TrustRequest, trustedHosts: readonly string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
