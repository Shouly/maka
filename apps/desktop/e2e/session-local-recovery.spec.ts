/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { resolve } from 'node:path';
import {
  COMPOSER_INPUT,
  awaitSendReady,
  ensureSidebarExpanded,
  expect,
  test,
  sendPrompt,
} from './fixtures';

// Native admission, delivery controls, and reload recovery use the same Main outbox.
test('a submitted turn and an unsent draft survive an application restart', async ({
  sessionLocalWindow,
}) => {
  let { page } = sessionLocalWindow;
  await sendPrompt(page, 'durable history before restart');
  await page.locator(COMPOSER_INPUT).fill('unsent across application restart');
  page = await sessionLocalWindow.restart();
  await expect(page.getByRole('log')).toContainText(
    'Fake backend received: durable history before restart',
  );
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('unsent across application restart');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(
    page.getByText('Fake backend received: unsent across application restart'),
  ).toHaveCount(1);
});

test('an admission failure keeps the draft and retry sends it once', async ({
  sessionLocalWindow: { page, app },
}) => {
  await sendPrompt(page, 'admission retry source');
  // Fail one IPC invocation while keeping the original handler for retry.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, (...args: any[]) => any> }
    )._invokeHandlers;
    const original = handlers.get('session-local:submit');
    if (!original) throw new Error('Missing submit handler');
    ipcMain.removeHandler('session-local:submit');
    ipcMain.handle('session-local:submit', (...args) => {
      ipcMain.removeHandler('session-local:submit');
      ipcMain.handle('session-local:submit', original);
      throw new Error('E2E admission unavailable');
    });
  });
  await page.locator(COMPOSER_INPUT).fill('retry keeps this draft');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'E2E admission unavailable' }).first(),
  ).toBeVisible();
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('retry keeps this draft');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.getByText('Fake backend received: retry keeps this draft')).toHaveCount(1);
});

test('a durably admitted message survives reload and executes once after restarting delivery', async ({
  sessionLocalWindow,
}) => {
  let { page } = sessionLocalWindow;
  await sendPrompt(page, 'outbox recovery source');
  const sessionId = await page.evaluate(async () => (await window.maka.sessions.list())[0]!.id);
  await sessionLocalWindow.app.evaluate((_electron, modulePath) => {
    const require = process.getBuiltinModule('module').createRequire(`${process.cwd()}/`);
    const { DesktopSessionLocalService } = require(modulePath);
    DesktopSessionLocalService.prototype.wake = () => {};
  }, resolve('dist/main/session-local-service.js'));
  const pending = 'durable outbox pending message';
  await page.locator(COMPOSER_INPUT).fill(pending);
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('');
  const messages = await page.evaluate(
    (id) => window.maka.sessionLocal.listMessages(id),
    sessionId,
  );
  const saved = messages.find((item) => item.text === pending)!;
  expect(saved.state).toBe('saved');
  await expect(page.locator(`[data-transient-message-id="${saved.messageId}"]`)).toContainText('已本地保存');
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await expect(page.locator(`[data-transient-message-id="${saved.messageId}"]`)).toContainText('已本地保存');
  expect(
    (await page.evaluate((id) => window.maka.sessionLocal.listMessages(id), sessionId)).find(
      (item) => item.text === pending,
    )?.messageId,
  ).toBe(saved.messageId);
  page = await sessionLocalWindow.restart();
  await expect(page.getByText(`Fake backend received: ${pending}`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.maka.sessionLocal.listMessages(id)).length,
        sessionId,
      ),
    )
    .toBe(0);
});


test('a rejected first message restores the welcome draft and removes its empty session', async ({sessionLocalWindow:{page,app}}) => {
  await expect(page.locator('[data-maka-contract="welcome-surface"]')).toBeVisible();
  await app.evaluate(({ipcMain})=>{
    const handlers=(ipcMain as typeof ipcMain & {_invokeHandlers:Map<string,(...args:any[])=>any>})._invokeHandlers;
    const original=handlers.get('session-local:submit')!;
    ipcMain.removeHandler('session-local:submit');
    ipcMain.handle('session-local:submit',(...args)=>{
      ipcMain.removeHandler('session-local:submit');ipcMain.handle('session-local:submit',original);
      return {ok:false,reason:'skill_load_failed',messageId:args[4].messageId,skillInvocation:{loaded:[],failed:[],receipts:[]}};
    });
  });
  await page.locator(COMPOSER_INPUT).fill('keep refused welcome draft');await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.locator('[data-maka-contract="welcome-surface"]')).toBeVisible();
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('keep refused welcome draft');
  await expect.poll(()=>page.evaluate(async()=>(await window.maka.sessions.list()).length)).toBe(0);
  await awaitSendReady(page);await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.getByText('Fake backend received: keep refused welcome draft')).toHaveCount(1);
});

test('welcome shows the Host permission default and first send inherits it',async({sessionLocalWindow:{page}})=>{
  await page.evaluate(async()=>window.maka.settings.update({chatDefaults:{permissionMode:'bypass'}}));
  await expect(page.getByRole('combobox',{name:'权限模式：完全权限'})).toBeVisible();
  await sendPrompt(page,'inherit host defaults');
  const row=await page.evaluate(async()=>(await window.maka.sessions.list())[0]!);
  expect(row.permissionMode).toBe('bypass');
  expect(row.orchestrationMode).toBe('default');
});

test('an undispatched local message can be removed from the conversation after reload',async({sessionLocalWindow})=>{
  const {page,app}=sessionLocalWindow;await sendPrompt(page,'local removal source');
  const sessionId=await page.evaluate(async()=>(await window.maka.sessions.list())[0]!.id);
  await app.evaluate((_electron,modulePath)=>{
    const require=process.getBuiltinModule('module').createRequire(`${process.cwd()}/`);
    const {DesktopSessionLocalService}=require(modulePath);DesktopSessionLocalService.prototype.wake=()=>{};
  },resolve('dist/main/session-local-service.js'));
  await page.locator(COMPOSER_INPUT).fill('remove before dispatch');await awaitSendReady(page);await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('');await page.reload();
  const pending=page.locator('[data-transient-message-id]').filter({hasText:'remove before dispatch'});
  await expect(pending).toContainText('已本地保存');
  await pending.getByRole('button',{name:'移除本地副本',exact:true}).click();await expect(pending).toHaveCount(0);
  expect(await page.evaluate(id=>window.maka.sessionLocal.listMessages(id),sessionId)).toHaveLength(0);
  const restored=await sessionLocalWindow.restart();
  await expect(restored.getByRole('log')).toContainText('local removal source');
  await expect(restored.getByText('Fake backend received: remove before dispatch')).toHaveCount(0);
});


async function lostFirstReply(window: {page: import('@playwright/test').Page;app: import('@playwright/test').ElectronApplication;restart():Promise<import('@playwright/test').Page>}, kind:'throw'|'unknown') {
  let {page}=window;
  await window.app.evaluate(({ipcMain},{modulePath,kind})=>{
    const require=process.getBuiltinModule('module').createRequire(`${process.cwd()}/`);
    const {DesktopSessionLocalService}=require(modulePath);DesktopSessionLocalService.prototype.wake=()=>{};
    const handlers=(ipcMain as typeof ipcMain & {_invokeHandlers:Map<string,(...args:any[])=>any>})._invokeHandlers;
    const original=handlers.get('session-local:submit')!;
    ipcMain.removeHandler('session-local:submit');
    ipcMain.handle('session-local:submit',async(...args)=>{
      ipcMain.removeHandler('session-local:submit');ipcMain.handle('session-local:submit',original);
      const saved=await original(...args);
      if(kind==='throw')throw new Error('reply lost after saving');
      return {...saved,ok:false,reason:'outcome_unknown',messageId:args[4].messageId};
    });
  },{modulePath:resolve('dist/main/session-local-service.js'),kind});
  const text=`first saved despite ${kind} reply`;
  await page.locator(COMPOSER_INPUT).fill(text);await awaitSendReady(page);await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.locator('[data-maka-contract="welcome-surface"]')).toHaveCount(0);
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('');
  const sessionId=await page.evaluate(async()=>(await window.maka.sessions.list())[0]!.id);
  const before=await page.evaluate(id=>window.maka.sessionLocal.listMessages(id),sessionId);
  expect(before).toHaveLength(1);
  await page.reload();await expect(page.locator(COMPOSER_INPUT)).toHaveText('');
  await expect(page.locator(`[data-transient-message-id="${before[0]!.messageId}"]`)).toContainText(text);
  page=await window.restart();await expect(page.getByText(`Fake backend received: ${text}`)).toHaveCount(1);
}

test('a lost reply after local first-send admission does not restore an already saved draft',async({sessionLocalWindow})=>{
  await lostFirstReply(sessionLocalWindow,'throw');
});
test('an outcome-unknown first send consumes the input while retaining its saved identity',async({sessionLocalWindow})=>{
  await lostFirstReply(sessionLocalWindow,'unknown');
});


test('cached conversation stays readable when the live transcript endpoint cannot open',async({sessionLocalWindow:{page,app}})=>{
  await sendPrompt(page,'cached conversation during outage');
  const sessionId=await page.evaluate(async()=>(await window.maka.sessions.list())[0]!.id);
  await expect.poll(()=>page.evaluate(async id=>Boolean(await window.maka.sessionLocal.readTranscript(id)),sessionId)).toBe(true);
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('sessions:transcript:open');
    ipcMain.handle('sessions:transcript:open',()=>{throw new Error('live transcript unavailable');});
  });
  await page.reload();
  await expect(page.getByRole('log')).toContainText('Fake backend received: cached conversation during outage');
});


test('welcome does not query a locally pending Host session and keeps the first prompt before its stream',async({sessionLocalWindow:{page,app}})=>{
  await app.evaluate(({ipcMain},modulePath)=>{
    const require=process.getBuiltinModule('module').createRequire(`${process.cwd()}/`);
    const {DesktopSessionLocalService}=require(modulePath);
    const state=globalThis as any;
    state.__originalWake=DesktopSessionLocalService.prototype.wake;
    DesktopSessionLocalService.prototype.wake=()=>{};
    state.__pendingProbes=[];
    const handlers=(ipcMain as typeof ipcMain & {_invokeHandlers:Map<string,(...args:any[])=>any>})._invokeHandlers;
    for(const channel of ['sessions:observe','shell-runs:list','runtime-host:query']){
      const original=handlers.get(channel)!;ipcMain.removeHandler(channel);
      ipcMain.handle(channel,(...args)=>{state.__pendingProbes.push([channel,JSON.stringify(args.slice(1))]);return original(...args);});
    }
  },resolve('dist/main/session-local-service.js'));
  const prompt='first prompt must precede its stream';
  await page.locator(COMPOSER_INPUT).fill(prompt);await awaitSendReady(page);await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.locator('[data-transient-message-id]')).toContainText(prompt);
  const session=await page.evaluate(async()=>(await window.maka.sessions.list())[0]!);
  expect(session.localState).toBe('pending');
  const message=(await page.evaluate(id=>window.maka.sessionLocal.listMessages(id),session.id))[0]!;
  await expect(page.locator('[data-message-delivery-status]')).toContainText('已本地保存');
  // The Host does not exist for the entire pause, so even a delayed query is wrong.
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,300)));
  const probes=await app.evaluate(()=> (globalThis as any).__pendingProbes as [string,string][]);
  const rawId=JSON.parse(session.id)[1];
  expect(probes.filter(([,payload])=>payload.includes(rawId))).toEqual([]);
  await page.evaluate((prompt)=>{
    const state=window as any;state.__messageOrderFailures=[];
    const inspect=()=>{
      const log=document.querySelector('[role="log"]');if(!log)return;
      const answer=[...log.querySelectorAll('[data-maka-contract="markdown"]')].find(node=>node.textContent?.includes('Fake backend'));
      if(!answer)return;
      const user=[...log.querySelectorAll('[data-role="user"]')].find(node=>node.textContent?.includes(prompt));
      if(!user || !(user.compareDocumentPosition(answer)&Node.DOCUMENT_POSITION_FOLLOWING))state.__messageOrderFailures.push(log.textContent);
    };
    state.__orderObserver=new MutationObserver(inspect);state.__orderObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  },prompt);
  await app.evaluate((_electron,modulePath)=>{
    const require=process.getBuiltinModule('module').createRequire(`${process.cwd()}/`);
    const {DesktopSessionLocalService}=require(modulePath);DesktopSessionLocalService.prototype.wake=(globalThis as any).__originalWake;
  },resolve('dist/main/session-local-service.js'));
  await page.evaluate(({id,messageId})=>window.maka.sessionLocal.reconcileMessage(id,messageId),{id:session.id,messageId:message.messageId});
  await expect(page.getByText(`Fake backend received: ${prompt}`)).toHaveCount(1);
  expect(await page.evaluate(()=>{const state=window as any;state.__orderObserver.disconnect();return state.__messageOrderFailures;})).toEqual([]);
});
