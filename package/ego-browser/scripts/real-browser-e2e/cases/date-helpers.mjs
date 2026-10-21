const helperUrl = new URL(
  "../../../../../skills/ego-browser/scripts/form-helpers.mjs",
  import.meta.url,
).href;
export function reusableDateCase() {
  return `
    const { fillDate } = await import(${JSON.stringify(helperUrl)});
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + '/nav-target');
    try {
      for (const prefix of ['ui', 'el']) {
        await page.evaluate((prefix) => {
          document.body.innerHTML = '<input id="plain"><input id="native" type="date"><input id="day" readonly><input id="month" readonly><input id="year" readonly>';
          document.body.style.cssText = 'padding:40px;';
          window.__dateClicks = 0;
          const chinese = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
          const names = prefix === 'ui'
            ? {panel:'ui-picker-panel ui-date-picker', header:'ui-date-picker-header', label:'ui-date-picker-header-label', years:'ui-year-table', months:'ui-month-table', days:'ui-date-table'}
            : {panel:'el-picker-panel el-date-picker', header:'el-date-picker__header', label:'el-date-picker__header-label', years:'el-year-table', months:'el-month-table', days:'el-date-table'};
          for(const precision of ['day','month','year']) {
            document.getElementById(precision).onclick = () => {
              let year=2026, month=10, decade=2020;
              let view=precision==='day'?'days':precision==='month'?'months':'years';
              const panel=document.createElement('div');
              panel.className=names.panel;
              panel.style.cssText='position:fixed;left:80px;top:120px;background:white;z-index:100;width:320px;padding:10px;border:1px solid black;';
              document.body.append(panel);
              const commit=(day) => {
                document.getElementById(precision).value=String(year)+(precision!=='year'?'/'+String(month).padStart(2,'0'):'')+(precision==='day'?'/'+String(day).padStart(2,'0'):'');
                document.getElementById(precision).dispatchEvent(new Event('change', {bubbles:true}));
                panel.remove();
              };
              const control=(tag, text, click) => {const e=document.createElement(tag);e.textContent=text;e.onclick=()=>{window.__dateClicks++;click();};return e;};
              const render=()=>{
                panel.replaceChildren();
                const header=document.createElement('div');header.className=names.header; panel.append(header);
                header.append(control('button','previous',()=>{decade-=10;render();}));
                const yearLabel=control('span',view==='years'?decade+' 年 - '+(decade+9)+' 年':year+' 年',()=>{view='years';render();});
                yearLabel.className=names.label;yearLabel.style.cursor='pointer';header.append(yearLabel);
                if(view==='days') {const label=control('span',month+' 月',()=>{view='months';render();});label.className=names.label;label.style.cssText='cursor:pointer;margin:0 20px;';header.append(label);}
                header.append(control('button','next',()=>{decade+=10;render();}));
                for(const kind of ['years','months','days']) {
                  const table=document.createElement('table');table.className=names[kind];table.style.display=view===kind?'table':'none';panel.append(table);
                  const tbody=document.createElement('tbody');table.append(tbody);
                  const length=kind==='years'?10:kind==='months'?12:new Date(year,month,0).getDate();
                  let row;
                  for(let i=0;i<length;i++) {
                    if(i%4===0){row=document.createElement('tr');tbody.append(row);}
                    const td=document.createElement('td');td.style.cssText='padding:5px;cursor:pointer;';row.append(td);
                    const number=kind==='years'?decade+i:i+1;
                    if(kind==='days') td.className=number===15?'disabled':'available';
                    td.append(control('a',kind==='months'?chinese[i]:String(number),()=>{
                      if(kind==='years'){year=number;if(precision==='year')commit();else{view='months';render();}}
                      else if(kind==='months'){month=number;if(precision==='month')commit();else{view='days';render();}}
                      else if(number!==15)commit(number);
                    }));
                  }
                  if(kind==='days'){const row=document.createElement('tr');const td=document.createElement('td');td.className='prev-month';td.append(control('span','22',()=>{throw new Error('wrong-month day clicked');}));row.append(td);tbody.append(row);}
                }
              };
              render();
            };
          }
        }, prefix);
        assertEqual((await fillDate(page, '#plain', '2024-02-29')).value, '2024/02/29', prefix + ' editable text date');
        assertEqual((await fillDate(page, '#native', '2024-02-29')).value, '2024-02-29', prefix + ' native date input');
        const day=await fillDate(page, '#day', '1973-02-22');
        assertEqual(day.value, '1973/02/22', prefix + ' distant year selected through decade navigation');
        const clicks=await page.evaluate(()=>window.__dateClicks);
        assert(clicks < 12, prefix + ' distant date uses decade jumps rather than 53 year clicks');
        assertEqual((await fillDate(page, '#day', '1973-02-22')).changed, false, prefix + ' already-correct date is a no-op');
        assertEqual(await page.evaluate(()=>window.__dateClicks), clicks, prefix + ' no-op makes no calendar clicks');
        assertEqual((await fillDate(page, '#month', '2025-12')).value, '2025/12', prefix + ' month precision');
        assertEqual((await fillDate(page, '#year', '2027')).value, '2027', prefix + ' year precision');
        assertEqual((await fillDate(page, '#day', '2024-02-29')).value, '2024/02/29', prefix + ' read-only leap-day selection');
        await assertRejects(()=>fillDate(page,'#day','2026-05-15'), 'disabled', prefix + ' disabled day stops instead of selecting another date');
        assertEqual(await page.evaluate(()=>document.querySelector('#day').value), '2024/02/29', prefix + ' disabled date leaves prior value unchanged');
      }
    } finally { await page.close(); }
  `;
}
