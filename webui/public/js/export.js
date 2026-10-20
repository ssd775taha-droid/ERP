'use strict';
// التصدير إلى Excel (.xlsx حقيقي بلا مكتبات خارجية) وتحسينات الطباعة: ترويسة المنشأة، اتجاه الصفحة، إيصال حراري.
(function (E) {
  // ---------- كتابة zip بلا ضغط (كافٍ لـ xlsx) ----------
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder();
  function zip(files) { // files: [{name, data(string)}]
    const chunks = [], central = []; let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach((f) => {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0]); // 0x0800 = UTF-8
      chunks.push(local, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += local.length + name.length + data.length;
    });
    let csize = 0;
    central.forEach((c) => {
      const h = new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(c.offset)]);
      chunks.push(h, c.name); csize += h.length + c.name.length;
    });
    chunks.push(new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), 0, 0]));
    return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // يحوّل جدول HTML إلى ورقة: الأعمدة ذات الصنف n (أرقام) تُكتب أرقاماً حقيقية بتنسيق منزلتين، والباقي نصوصاً
  E.tableToXlsx = (table, title) => {
    const rows = E.$$('tr', table).filter((r) => !r.classList.contains('noprint') && r.style.display !== 'none');
    const grid = rows.map((r) => E.$$('th,td', r).filter((c) => !c.classList.contains('noprint')).map((c) => ({
      text: c.innerText.replace(/\s+/g, ' ').trim(), num: c.classList.contains('n'), head: c.tagName === 'TH' || c.closest('thead') !== null, foot: c.closest('tfoot') !== null,
    })));
    const widths = [];
    const body = grid.map((cells, ri) => {
      let cx = '';
      cells.forEach((c, ci) => {
        const ref = colName(ci) + (ri + 1);
        widths[ci] = Math.min(60, Math.max(widths[ci] || 8, c.text.length + 2));
        const raw = c.text.replace(/,/g, '').replace(/^−/, '-');
        if (c.num && /^-?\d+(\.\d+)?$/.test(raw)) cx += '<c r="' + ref + '" s="' + (c.foot ? 4 : 2) + '"><v>' + raw + '</v></c>';
        else cx += '<c r="' + ref + '" t="inlineStr" s="' + (c.head ? 1 : c.foot ? 3 : 0) + '"><is><t xml:space="preserve">' + xml(c.text) + '</t></is></c>';
      });
      return '<row r="' + (ri + 1) + '">' + cx + '</row>';
    }).join('');
    const cols = widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + cols + '</cols><sheetData>' + body + '</sheetData></worksheet>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE7F2"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const sheetName = xml((title || 'ERP').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'ERP');
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + sheetName + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
  };
  E.downloadXlsx = (table, name, title) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(E.tableToXlsx(table, title)); a.download = name + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ---------- الطباعة: ترويسة المنشأة + عنوان التقرير + عوامل التصفية، واتجاه الصفحة حسب عرض الجداول ----------
  const pageStyle = document.createElement('style');
  document.head.appendChild(pageStyle);
  window.addEventListener('beforeprint', () => {
    const main = E.$('#main'); const ph = E.$('#phead');
    if (!main || !ph) return;
    const title = E.$('h1', main) ? E.$('h1', main).textContent.trim() : 'نظام ERP';
    const sub = E.$('h1 + .sub', main) ? E.$('h1 + .sub', main).textContent.trim() : '';
    const filters = E.$$('form input[type=date], form select', main).filter((x) => x.closest('.noprint') && x.name && x.value).map((x) => {
      const lab = x.closest('label'); const l = lab ? lab.firstChild.textContent.trim() : x.name;
      return l + ': ' + (x.tagName === 'SELECT' ? x.options[x.selectedIndex].text : x.value);
    });
    const who = E.me && (E.me.fullName || E.me.user);
    ph.innerHTML = '<div class="ph-top">' + E.companyBlock() +
      '<div class="ph-meta">طُبع في ' + new Date().toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) + (who ? '<br>بواسطة ' + E.esc(who) : '') + '</div></div>' +
      '<h2 class="ph-title">' + E.esc(title) + '</h2>' + (sub ? '<div class="ph-sub">' + E.esc(sub) + '</div>' : '') + (filters.length ? '<div class="ph-sub">' + E.esc(filters.join(' — ')) + '</div>' : '');
    const pf = E.$('#pfoot'); if (pf) pf.textContent = E.lh.footerNote || '';
    const widest = Math.max(0, ...E.$$('table', main).map((tb) => Math.max(0, ...E.$$('tr', tb).map((r) => E.$$('th,td', r).filter((c) => c.offsetParent !== null).length))));
    const thermal = document.body.classList.contains('thermal');
    pageStyle.textContent = thermal ? '@page { size: 80mm 297mm; margin: 3mm; }' : '@page { size: A4 ' + (widest > 7 ? 'landscape' : 'portrait') + '; margin: 12mm 10mm 14mm; }';
  });
  // إيصال حراري 80مم: يُبنى محتوى مستقل في #thermal ويُطبع وحده (بقية الصفحة مخفية بصنف على body أثناء الطباعة فقط)
  E.printThermal = (html) => {
    E.$('#thermal').innerHTML = html;
    document.body.classList.add('thermal');
    const done = () => { document.body.classList.remove('thermal'); E.$('#thermal').innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
})(window.ERP);
