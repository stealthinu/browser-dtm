import puppeteer from 'puppeteer-core';
import {startServer} from './server.mjs';
export async function openBrowser(port=5201){
  const host=await startServer({port});let browser;
  try{
    browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();
    await page.setViewport({width:1440,height:1200,deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
    // Entire app/model/runtime path is local. No prompts, songs or models leave this machine.
    await page.setRequestInterception(true);
    page.on('request',req=>{if(req.url().startsWith(host.url)||req.url().startsWith('blob:')||req.url().startsWith('data:'))req.continue();else{errors.push(`External request blocked: ${new URL(req.url()).origin}`);req.abort();}});
    await page.goto(host.url,{waitUntil:'networkidle0',timeout:30000});
    await page.waitForFunction(()=>window.dtmHost?.ready,{timeout:30000});
    return {host,browser,page,errors,close:async()=>{await browser.close();await host.close();}};
  }catch(e){if(browser)await browser.close();await host.close();throw e;}
}
