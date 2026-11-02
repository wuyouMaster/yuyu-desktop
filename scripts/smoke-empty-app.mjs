import { _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url), root=new URL('../',import.meta.url).pathname
const home=await mkdtemp(join(tmpdir(),'synthetic-public-app-'))
await writeFile(join(home,'settings.json'), JSON.stringify({dbRoot:join(home,'synthetic-accounts'),imageKeyRoot:join(home,'synthetic-accounts'),apiEnabled:false,autoLogin:false}))
const entry=join(root,'.tmp','smoke-entry.cjs')
await import('node:fs/promises').then(fs=>fs.mkdir(join(root,'.tmp'),{recursive:true}))
await writeFile(entry,`process.on('unhandledRejection',e=>require('node:fs').appendFileSync(${JSON.stringify(join(root,'.tmp','smoke-start-errors.txt'))},String(e?.stack||e)+'\\n'));const {app}=require('electron');app.setName('Synthetic Migration');app.setPath('userData',${JSON.stringify(home)});app.setPath('sessionData',${JSON.stringify(home)});require('../out/main/index.js')`)

let application
try {
 application=await electron.launch({executablePath:require('electron'),args:[entry,`--user-data-dir=${home}`],cwd:root,env:{...process.env,WE_SETTINGS_DIR:home,YUYU_USER_DATA:home,YUYU_RUNTIME_HOME:join(home,'runtimes')}})
 const errors=[];application.process().stderr.on('data',b=>{errors.push(b.toString());process.stderr.write(b)})
 const page=await application.firstWindow()
 await page.waitForLoadState('domcontentloaded')
 await page.locator('body').waitFor()
 console.log('INITIAL_UI',await page.locator('body').innerText())
 await page.getByRole('button',{name:'暂不连接，进入主界面'}).waitFor({state:'visible',timeout:20000})
 await page.screenshot({path:join(root,'.tmp','empty-start.png'),fullPage:true})
 console.log(JSON.stringify({title:await page.title(),entryVisible:true,body:(await page.locator('body').innerText()).slice(0,1900),errors:errors.map(s=>s.slice(0,300)).slice(-6)}))
} finally {if(application)await application.close();await rm(home,{recursive:true,force:true})}
