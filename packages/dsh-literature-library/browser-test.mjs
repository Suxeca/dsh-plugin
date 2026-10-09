import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '/home/suxeca/Workspace/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { apply } from './lib/index.js'
const root = await mkdtemp(join(tmpdir(), 'literature-browser-'))
const routes = new Map(), disposers = []
await apply({ get(name) { return name === 'webServer' ? { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } } : { requestRejection(req) { return req.headers['x-test-auth'] === 'yes' ? undefined : 401 } } }, effect(factory) { disposers.push(factory()) } }, { libraryRoot: root, catalogPath: '/home/suxeca/Workspace/docs/literature/library/catalog.json', pagePath: '/home/suxeca/Workspace/docs/literature/library-page.html' })
const server = createServer((req,res)=> { const handler = routes.get(req.url); if(handler) void handler(req,res); else { res.writeHead(404); res.end() } })
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url = `http://127.0.0.1:${server.address().port}`
let browser
try {
  assert.equal((await fetch(url+'/literature-library/state')).status,401)
  assert.equal((await fetch(url+'/literature-library/state',{method:'POST',headers:{'x-test-auth':'yes','content-type':'application/json',origin:'https://evil.invalid'},body:JSON.stringify({id:'2410.06557',selected:true})})).status,403)
  browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'})
  const context=await browser.newContext({extraHTTPHeaders:{'x-test-auth':'yes'},viewport:{width:390,height:844}})
  const page=await context.newPage()
  await page.goto(url+'/literature-library')
  await page.getByText('已读取服务端清单。',{exact:true}).waitFor()
  assert.equal(await page.locator('article').count(),13)
  await page.locator('article button').first().click()
  await page.getByText('已保存到电脑资料库；元数据和笔记模板已建立。',{exact:true}).waitFor()
  const bookmarks=JSON.parse(await readFile(join(root,'bookmarks.json'),'utf8'))
  assert.ok(bookmarks.starred['2410.06557'])
  assert.ok((await readFile(join(root,'papers/2410.06557/notes.md'),'utf8')).includes('后续讨论'))
  const secondContext=await browser.newContext({extraHTTPHeaders:{'x-test-auth':'yes'}})
  const secondPage=await secondContext.newPage()
  await secondPage.goto(url+'/literature-library')
  await secondPage.getByText('已读取服务端清单。',{exact:true}).waitFor()
  assert.equal(await secondPage.locator('article button').first().getAttribute('aria-pressed'),'true')
  await secondContext.close()
  await page.reload()
  await page.getByText('已读取服务端清单。',{exact:true}).waitFor()
  assert.equal(await page.locator('article button').first().getAttribute('aria-pressed'),'true')
  await page.getByLabel('仅看收藏').check()
  assert.equal(await page.locator('article').count(),1)
  await page.getByText('后续讨论用清单',{exact:true}).click()
  await page.getByText('生成收藏大纲',{exact:true}).click()
  assert.ok((await page.locator('textarea').inputValue()).includes('https://arxiv.org/abs/2410.06557'))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:join(root,'mobile-library.png'),fullPage:true})
  await page.locator('article button').first().click()
  await page.getByText('已取消收藏，原有笔记保留。',{exact:true}).waitFor()
  assert.ok(await readFile(join(root,'papers/2410.06557/notes.md'),'utf8'))
  console.log(JSON.stringify({pass:true,tests:['unauthenticated-denial','cross-origin-denial','mobile-star-to-disk','reload-persistence','selected-filter','discussion-outline','no-horizontal-overflow','unstar-preserves-notes'],evidence:root}))
} finally { if(browser)await browser.close();for(const dispose of disposers)dispose();assert.equal(routes.size,0);await new Promise(resolve=>server.close(resolve)) }
