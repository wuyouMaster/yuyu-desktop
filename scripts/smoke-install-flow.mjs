import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),root=new URL('../',import.meta.url).pathname
const [archive,fixture,mode,packagedExecutable]=process.argv.slice(2)
if(mode && !['--published','--packaged'].includes(mode))throw new Error('Expected --published, --packaged, or no mode')
if(mode==='--packaged' && (!packagedExecutable || !isAbsolute(packagedExecutable)))throw new Error('Absolute packaged executable required')
const published=mode==='--published'||mode==='--packaged'
if(!archive||!fixture)throw new Error('Candidate archive and synthetic account required')
const home=await mkdtemp(join(tmpdir(),'synthetic-public-install-')),account=join(home,'account')
await cp(fixture,account,{recursive:true})
await writeFile(join(home,'settings.json'),JSON.stringify({dbRoot:account,imageKeyRoot:account,apiEnabled:false,autoLogin:false}))
const data=await readFile(archive),manifestBytes=await readFile(archive+'.manifest.json'),manifest=JSON.parse(manifestBytes)
const hash=b=>createHash('sha256').update(b).digest('hex')
let downloads=0,credentialHeaders=0
const server=createServer((req,res)=>{downloads++;if(req.headers.authorization)credentialHeaders++;res.setHeader('Content-Length',data.length);res.end(data)})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const item={application:'wechat',version:manifest.version,target:manifest.target,sourceCommit:manifest.sourceCommit,sha256:hash(data),manifestSha256:hash(manifestBytes),files:manifest.files.map(f=>f.path),asset:basename(archive),releaseStatus:'development-only',url:`http://127.0.0.1:${server.address().port}/fixture.zip`}
const catalog=join(home,'catalog.json');await writeFile(catalog,JSON.stringify({packages:[item]}))
if(published){
 const locked=JSON.parse(await readFile(join(root,'runtime.lock.json'),'utf8')).packages.find(p=>p.application==='wechat'&&p.target===manifest.target)
 expect(locked).toMatchObject({version:manifest.version,sha256:hash(data),manifestSha256:hash(manifestBytes),githubAuthentication:false})
}
await mkdir(join(root,'.tmp'),{recursive:true});const entry=join(root,'.tmp','install-flow-entry.cjs')
await writeFile(entry,`const {app}=require('electron');app.setName('Synthetic Install');app.setPath('userData',${JSON.stringify(home)});app.setPath('sessionData',${JSON.stringify(home)});require('../out/main/index.js')`)
const env={...process.env,WE_SETTINGS_DIR:home,YUYU_USER_DATA:home,YUYU_RUNTIME_HOME:join(home,'runtime'),YUYU_RUNTIME_TEST_CATALOG:catalog,YUYU_RUNTIME_ALLOW_LOOPBACK:'1'}
if(published){delete env.YUYU_RUNTIME_TEST_CATALOG;delete env.YUYU_RUNTIME_ALLOW_LOOPBACK}
for(const name of ['GITHUB_TOKEN','GH_TOKEN','YUYU_RUNTIME_TOKEN','YUYU_RUNTIME_TEST_BASE_URL','ELECTRON_RENDERER_URL'])delete env[name]
let application
async function launch(){ application=await electron.launch({executablePath:mode==='--packaged'?packagedExecutable:require('electron'),args:mode==='--packaged'?[`--user-data-dir=${home}`]:[entry,`--user-data-dir=${home}`],cwd:root,env});application.process().stderr.on('data',b=>process.stderr.write(b));const page=await application.firstWindow();page.setDefaultTimeout(15000);await page.waitForLoadState('domcontentloaded');console.log('WINDOW',await page.locator('body').innerText());return page }
try{
 let page=await launch()
 await page.getByRole('button',{name:'暂不连接，进入主界面'}).click()
 console.log('WORKSPACE_UI',await page.locator('body').innerText())
 await page.getByRole('heading',{name:'从一个数据源开始'}).waitFor()
 await page.getByRole('button',{name:'管理应用运行时',exact:true}).first().click()
 await page.getByRole('dialog').waitFor()
 const before=await page.evaluate(()=>window.api.listRuntimeInstallations());expect(before[0].status).toBe('not-installed')
 await page.getByRole('button',{name:'安装 微信',exact:true}).click()
 await expect(page.getByText('安装和校验完成。请重启应用以启用；安装成功不代表已连接账号或验证真实发送。')).toBeVisible({timeout:180000})
 const installed=await page.evaluate(()=>window.api.listRuntimeInstallations());expect(installed[0]).toMatchObject({status:'installed',restartRequired:true})
 await page.screenshot({path:join(root,'.tmp','runtime-installed.png'),fullPage:true})
 await application.close();application=undefined
 page=await launch()
 console.log('WORKSPACE_UI',await page.locator('body').innerText())
 await page.getByRole('heading',{name:'从一个数据源开始'}).waitFor()
 const after=await page.evaluate(()=>window.api.listRuntimeInstallations());expect(after[0]).toMatchObject({status:'installed',restartRequired:false})
 const initialized=await page.evaluate(({key,account})=>window.api.initDb(key,account),{key:Buffer.from('fixture-only-account-key-32-byte').toString('hex'),account})
 console.log('SYNTHETIC_DB_INIT',JSON.stringify(initialized))
 expect(initialized).toMatchObject({success:true,monitoring:true})
 const contacts=await page.evaluate(()=>window.api.getContacts());expect(contacts.length).toBeGreaterThan(0)
 console.log(JSON.stringify({downloadMode:published?'public-https':'loopback',loopbackRequests:downloads,loopbackAuthorizationHeaders:credentialHeaders,before:before[0].status,installed:installed[0].status,restartRequired:installed[0].restartRequired,afterRestart:after[0].status,initialized,contactCount:contacts.length}))
 expect(downloads).toBe(published?0:1);expect(credentialHeaders).toBe(0)
} finally {if(application)await application.close();await new Promise(done=>server.close(done));await rm(home,{recursive:true,force:true})}
