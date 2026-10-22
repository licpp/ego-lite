export function responseObserverCase() {
  return String.raw`
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + '/nav-target');
    try {
      await page.evaluate(() => {
        document.body.innerHTML = '<button id="invalid">Save invalid</button><button id="valid">Save valid</button><input id="file" type="file"><output id="done"></output>';
        document.querySelector('#invalid').onclick = () => fetch('/api/observe-save', {method:'POST',body:'invalid'}).then(r=>r.json());
        document.querySelector('#valid').onclick = () => fetch('/api/observe-save', {method:'POST',body:'valid'}).then(r=>r.json());
        document.querySelector('#file').onchange = async () => {
          const data = new FormData(); data.append('file', document.querySelector('#file').files[0]);
          const upload = await fetch('/api/observe-upload', {method:'POST',body:data}).then(r=>r.json());
          await fetch('/api/observe-save', {method:'POST',body:upload.data.attachmentId}).then(r=>r.json());
          document.querySelector('#done').textContent = 'linked';
        };
      });
      const failed = await page.actAndWaitForResponse({
        action:()=>page.click('#invalid'), match:{urlIncludes:'/api/observe-save',method:'POST'},
        bodyFields:['code','message'], timeout:3000
      });
      assertEqual(failed.response.httpStatus,200,'HTTP success is separate from business failure');
      assertEqual(failed.response.body.json.code,400,'business validation message is available');
      assertEqual(failed.response.body.json.message,'invalid title','error body is not lost');
      assert(!('success' in failed.response),'framework does not invent business success');
      const path = join(tempDir,'observed-complete.json');
      const valid = await page.actAndWaitForResponse({action:()=>page.click('#valid'),match:{urlIncludes:'/api/observe-save'},saveBodyAs:path,maxChars:16});
      assertEqual(valid.response.body.truncated,true,'body budget clips output explicitly');
      assertEqual(valid.response.body.text.length,16,'body budget is enforced');
      assertEqual(JSON.parse(await readFile(path,'utf8')).code,0,'complete response stays in local artifact');
      const input = join(tempDir,'response-upload.txt'); await writeFile(input,'attachment fixture');
      const linked = await page.actAndWaitForResponses({
        action:()=>page.setInputFiles('#file',[input]),
        matches:[{urlIncludes:'/api/observe-upload',method:'POST'},{urlIncludes:'/api/observe-save',method:'POST'}],
        bodyFields:['code','data.attachmentId'],timeout:5000
      });
      assertEqual(linked.responses.length,2,'upload and save are both observed');
      assertEqual(linked.responses[0].body.json['data.attachmentId'],'fixture-attachment','upload id returned');
      assertEqual(linked.responses[1].body.json['data.attachmentId'],'fixture-attachment','save links the uploaded id');
      await page.waitForFunction(()=>document.querySelector('#done').textContent==='linked');
      const text = await page.actAndWaitForResponse({action:()=>page.evaluate(()=>fetch('/api/text').then(r=>r.text())),match:{urlIncludes:'/api/text'},maxChars:8});
      assertEqual(text.response.body.text,'server t','plain text is bounded');
      const redirect = await page.actAndWaitForResponse({action:()=>page.evaluate(()=>fetch('/api/redirect').then(r=>r.text())),match:{urlIncludes:'/api/redirect'}});
      assertEqual(redirect.response.redirects.length,1,'redirect chain remains one logical observation');
      assertIncludes(redirect.response.url,'/api/text','final redirect URL returned');
      const meta = await page.actAndWaitForResponse({action:()=>page.evaluate(()=>fetch('/api/json').then(r=>r.text())),match:{urlIncludes:'/api/json'},includeBody:false});
      assertEqual(meta.response.body.kind,'omitted','metadata-only mode does not dump body');
      await assertRejects(()=>page.actAndWaitForResponse({action:()=>page.click('#valid'),match:{urlIncludes:'/never-requested'},timeout:200}),'already have taken effect','timeouts warn against repeating writes');
      assert((await page.events()).some(e=>e.method==='Network.requestWillBeSent'),'observation does not drain existing event queue');
    } finally { await page.close(); }
  `;
}
