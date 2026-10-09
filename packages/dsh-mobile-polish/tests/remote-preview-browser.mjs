import { chromium } from '/home/suxeca/Workspace/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { installFilePreviewRecovery } from '../lib/types/client/file-preview-recovery.js'

/** The caller supplies an ephemeral authenticated URL in memory; never log it. */
export async function verifyMobilePreview(authenticatedUrl) {
  const evidence='/home/suxeca/Workspace/dsh-plugin/packages/dsh-mobile-polish/test-evidence'
  await mkdir(evidence,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'})
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    const errors=[]
    page.on('pageerror',e=>errors.push(e.message.slice(0,300)))
    await page.goto(authenticatedUrl)
    await page.waitForTimeout(1800)
    const intro=page.getByRole('dialog').getByRole('button',{name:'继续',exact:true})
    if(await intro.isVisible())await intro.click()
    await page.getByRole('button',{name:'打开侧边栏',exact:true}).click()
    const workspace=page.getByText('suxeca',{exact:true}).first()
    if(await workspace.isVisible())await workspace.click()
    const sessionLink=page.getByText('dsh最新的自动化任务功能适合',{exact:true}).first()
    if(await sessionLink.count()===0)throw new Error('Session selector missing: '+(await page.locator('body').innerText()).slice(0,1300))
    await sessionLink.click()
    await page.waitForTimeout(700)
    const exit=page.locator('button[title="退出全屏并回到侧边栏"]')
    if(await exit.isVisible())await exit.click()
    const collapse=page.getByRole('button',{name:'收起侧边栏',exact:true})
    if(await collapse.isVisible())await collapse.click()
    const fileLink=page.getByRole('button',{name:'测试记录与验证范围',exact:true})
    for(let attempt=0;attempt<4&&await fileLink.count()===0;attempt++) {
      const older=page.getByRole('button',{name:'加载更早',exact:true})
      if(await older.count()===0)break
      await older.click()
      await page.waitForTimeout(400)
    }
    await fileLink.click()
    const preview=page.locator('[data-textpreview-state="text"]').filter({hasText:'Literature library verification'})
    await preview.first().waitFor()
    assert.ok((await preview.first().innerText()).includes('Executed checks'))
    const lamp=page.locator('.dsh-synapse-switch')
    assert.equal(await lamp.isVisible(),false)
    await page.screenshot({path:evidence+'/remote-markdown-mobile.png'})
    const reading=await preview.first().boundingBox()
    assert.ok(reading&&reading.width<=390)
    // Verify a second real Markdown link, including reopen after collapse.
    const close=page.getByRole('button',{name:'收起右侧边栏',exact:true})
    await close.click()
    await page.getByRole('button',{name:'修订简报',exact:true}).first().click()
    await page.locator('[data-textpreview-state="text"]').filter({hasText:'文献候选与收藏库'}).first().waitFor()
    await page.screenshot({path:evidence+'/remote-briefing-mobile.png'})
    await page.reload()
    await page.locator('[data-textpreview-state="text"]').filter({hasText:'文献候选与收藏库'}).first().waitFor()
    await page.screenshot({path:evidence+'/remote-preview-after-reload.png'})
    assert.equal(errors.length,0)
    // Recovery is exercised in an isolated document, not by disabling the real provider.
    const fixture=await browser.newPage({viewport:{width:390,height:844}})
    await fixture.setContent('<main><div data-textpreview-state="loading"><p>文件资源服务不可用</p></div><div id="spinner" data-textpreview-state="loading"><span>loading</span></div></main>')
    await fixture.evaluate(source=>{window.reloadCalls=0;window.disposeRecovery=eval('('+source+')')(document,()=>window.reloadCalls++);},installFilePreviewRecovery.toString())
    assert.equal(await fixture.locator('[data-mobile-file-recovery]').count(),1)
    await fixture.getByRole('button',{name:'重新载入文件预览'}).click()
    assert.equal(await fixture.evaluate(()=>window.reloadCalls),1)
    await fixture.evaluate(()=>{document.querySelector('main').append(document.createElement('span'));})
    assert.equal(await fixture.locator('[data-mobile-file-recovery]').count(),1)
    await fixture.evaluate(()=>window.disposeRecovery())
    assert.equal(await fixture.locator('[data-mobile-file-recovery]').count(),0)
    const result={pass:true,origin:'remote IP over HTTP',viewport:'390x844 touch',checks:['real Markdown content','second Markdown and reopen','floating control hidden','no browser errors','manual recovery callback','no false recovery while spinner loads','no duplicate recovery UI','dispose removes UI'],evidence,limitation:'Original Huawei missing-provider state was not reproduced; underlying cause remains unconfirmed.'}
    await writeFile(evidence+'/verification.json',JSON.stringify(result,null,2)+'\n')
    return result
  }finally{await browser.close()}
}
