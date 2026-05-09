/**
 * ALVARO URIBE DESIGN — Finance → Google Sheets Sync
 * =====================================================
 * SETUP INSTRUCTIONS:
 * 1. Go to script.google.com → New Project
 * 2. Paste this entire file
 * 3. Run setupSheet() ONCE to create the spreadsheet
 * 4. Copy the Spreadsheet ID from the URL (between /d/ and /edit)
 * 5. Paste it into SHEET_ID below
 * 6. In your Finance app → Settings → paste the Web App URL
 * 7. Deploy → New Deployment → Web App → Execute as Me → Anyone
 *
 * The app will POST data here every time you tap "Sync to Google Sheets"
 */

// ── PASTE YOUR SPREADSHEET ID HERE after running setupSheet() ─────────────────
const SHEET_ID = "YOUR_SPREADSHEET_ID_HERE";

// ── Color palette matching original Excel ─────────────────────────────────────
const COLORS = {
  headerBg:    "#0F172A",  // dark navy header
  headerText:  "#FFFFFF",
  subheaderBg: "#1E3A5F",
  subheaderTxt:"#FFFFFF",
  altRow:      "#EBF3FB",
  totalBg:     "#D6E4F0",
  greenBg:     "#DCFCE7",  // positive delta
  redBg:       "#FEE2E2",  // negative delta
  warnBg:      "#FEF9C3",
  sectionBg:   "#2E75B6",
  sectionTxt:  "#FFFFFF",
};

// ── doPost: receives data from the Finance app ────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    syncAllTabs(data);
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, timestamp: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── doGet: health check ───────────────────────────────────────────────────────
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", app: "AUD Finance Sync" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Main sync orchestrator ────────────────────────────────────────────────────
function syncAllTabs(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  syncPortfolio(ss, data);
  syncInvoices(ss, data);
  syncIncome(ss, data);
  syncExpenses(ss, data);
  syncSummary(ss, data);
  
  // Update last sync timestamp on Summary tab
  const sumSheet = ss.getSheetByName("📊 Summary");
  if (sumSheet) {
    sumSheet.getRange("A1").setValue(`Last synced: ${new Date().toLocaleString()}`);
  }
}

// ── PORTFOLIO TAB ─────────────────────────────────────────────────────────────
function syncPortfolio(ss, data) {
  let sheet = ss.getSheetByName("📈 Portfolio");
  if (!sheet) sheet = ss.insertSheet("📈 Portfolio");
  sheet.clear();
  sheet.setFrozenRows(3);
  sheet.setFrozenColumns(2);

  const snaps = data.monthlySnapshots || [];
  const accounts = data.accounts || [];
  const categories = {
    stocks: "Stocks", crypto: "Crypto", retirement: "Retirement",
    fixed: "Fixed Income", savings: "Cash & Savings"
  };

  // Row 1: Title
  const titleCell = sheet.getRange(1, 1, 1, snaps.length + 4);
  titleCell.merge();
  titleCell.setValue("ALVARO URIBE DESIGN — PORTFOLIO TRACKER");
  styleHeader(titleCell, COLORS.headerBg, COLORS.headerText, 13);

  // Row 2: blank
  // Row 3: Column headers
  const headers = ["Category", "Account", ...snaps.map(s => s.month), "Latest", "MoM Change", "MoM %"];
  const headerRange = sheet.getRange(3, 1, 1, headers.length);
  headerRange.setValues([headers]);
  styleHeader(headerRange, COLORS.subheaderBg, COLORS.subheaderTxt, 10);

  let row = 4;
  let grandTotals = new Array(snaps.length).fill(0);

  Object.entries(categories).forEach(([catKey, catLabel]) => {
    const catAccounts = accounts.filter(a => a.category === catKey);
    if (!catAccounts.length) return;

    // Category section header
    const catRange = sheet.getRange(row, 1, 1, headers.length);
    catRange.merge();
    catRange.setValue(catLabel.toUpperCase());
    styleHeader(catRange, COLORS.sectionBg, COLORS.sectionTxt, 10);
    row++;

    let catTotals = new Array(snaps.length).fill(0);

    catAccounts.forEach((acc, ai) => {
      const vals = snaps.map(s => s[acc.id] || 0);
      vals.forEach((v, i) => {
        catTotals[i] += v;
        grandTotals[i] += v;
      });

      const latest = vals[vals.length - 1];
      const prev = vals[vals.length - 2] || latest;
      const momChange = latest - prev;
      const momPct = prev ? ((latest - prev) / prev) * 100 : 0;

      const rowData = [catLabel, acc.name, ...vals, latest, momChange, momPct / 100];
      const r = sheet.getRange(row, 1, 1, rowData.length);
      r.setValues([rowData]);

      // Style
      const bg = ai % 2 === 0 ? "#FFFFFF" : COLORS.altRow;
      r.setBackground(bg);
      r.setFontFamily("Arial").setFontSize(10);
      sheet.getRange(row, 3, 1, snaps.length + 1)
        .setNumberFormat('"$"#,##0.00_);("$"#,##0.00)');
      sheet.getRange(row, 3 + snaps.length + 1, 1, 1)
        .setNumberFormat('"$"#,##0.00_);("$"#,##0.00)');
      
      // Color MoM change
      const changeCell = sheet.getRange(row, 3 + snaps.length);
      const pctCell = sheet.getRange(row, 3 + snaps.length + 1);
      if (momChange > 0) {
        changeCell.setBackground(COLORS.greenBg);
        pctCell.setBackground(COLORS.greenBg);
      } else if (momChange < 0) {
        changeCell.setBackground(COLORS.redBg);
        pctCell.setBackground(COLORS.redBg);
      }
      pctCell.setNumberFormat('0.0%');

      // Note column if exists
      if (acc.note) {
        sheet.getRange(row, headers.length + 1).setValue(acc.note)
          .setFontColor("#FF9500").setFontSize(9);
      }

      row++;
    });

    // Category subtotal row
    const subTotalData = ["", `${catLabel} TOTAL`, ...catTotals, catTotals[catTotals.length-1],
      catTotals[catTotals.length-1] - catTotals[catTotals.length-2],
      catTotals[catTotals.length-2] ? (catTotals[catTotals.length-1] - catTotals[catTotals.length-2]) / catTotals[catTotals.length-2] : 0];
    const subR = sheet.getRange(row, 1, 1, subTotalData.length);
    subR.setValues([subTotalData]);
    subR.setBackground(COLORS.totalBg).setFontWeight("bold").setFontSize(10);
    sheet.getRange(row, 3, 1, snaps.length + 1).setNumberFormat('"$"#,##0.00_);("$"#,##0.00)');
    sheet.getRange(row, 3 + snaps.length + 1, 1, 1).setNumberFormat('0.0%');
    row += 2;
  });

  // Grand Total row
  const latest = grandTotals[grandTotals.length - 1];
  const prev = grandTotals[grandTotals.length - 2] || latest;
  const grandData = ["", "TOTAL PORTFOLIO", ...grandTotals, latest, latest - prev, prev ? (latest-prev)/prev : 0];
  const grandR = sheet.getRange(row, 1, 1, grandData.length);
  grandR.setValues([grandData]);
  styleHeader(grandR, COLORS.headerBg, COLORS.headerText, 11);
  sheet.getRange(row, 3, 1, snaps.length + 1).setNumberFormat('"$"#,##0.00_);("$"#,##0.00)')
    .setFontColor("#FFFFFF");
  sheet.getRange(row, 3 + snaps.length + 1, 1, 1).setNumberFormat('0.0%')
    .setFontColor("#FFFFFF");

  // Set column widths
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 200);
  snaps.forEach((_, i) => sheet.setColumnWidth(i + 3, 110));
  sheet.setColumnWidth(snaps.length + 3, 110);
  sheet.setColumnWidth(snaps.length + 4, 110);
  sheet.setColumnWidth(snaps.length + 5, 80);
}

// ── INVOICES TAB ──────────────────────────────────────────────────────────────
function syncInvoices(ss, data) {
  let sheet = ss.getSheetByName("🧾 Invoices");
  if (!sheet) sheet = ss.insertSheet("🧾 Invoices");
  sheet.clear();
  sheet.setFrozenRows(2);

  const invoices = data.invoices || [];
  const payees = data.payees || [];

  // Header
  const title = sheet.getRange(1, 1, 1, 8);
  title.merge().setValue("INVOICES").setBackground(COLORS.headerBg).setFontColor(COLORS.headerText)
    .setFontWeight("bold").setFontSize(12).setFontFamily("Arial");

  const cols = ["Invoice #", "Client", "Date", "Amount", "Currency", "Status", "Line Items", "Notes"];
  const hdr = sheet.getRange(2, 1, 1, cols.length);
  hdr.setValues([cols]);
  styleHeader(hdr, COLORS.subheaderBg, COLORS.subheaderTxt, 10);

  invoices.forEach((inv, i) => {
    const payee = payees.find(p => p.id === inv.payeeId);
    const lineItemStr = (inv.lineItems || [])
      .map(li => li.type === "hourly" ? `${li.desc} (${li.hours}h @ $${li.rate})` : `${li.desc}: $${li.amount}`)
      .join(" | ");

    const row = [inv.num, inv.client, inv.date, inv.amount, inv.currency, inv.status.toUpperCase(), lineItemStr,
      payee && payee.attn ? `Attn: ${payee.attn}` : ""];
    const r = sheet.getRange(i + 3, 1, 1, row.length);
    r.setValues([row]);
    r.setBackground(i % 2 === 0 ? "#FFFFFF" : COLORS.altRow).setFontSize(10).setFontFamily("Arial");
    sheet.getRange(i + 3, 4).setNumberFormat('"$"#,##0.00');

    // Status color
    const statusCell = sheet.getRange(i + 3, 6);
    if (inv.status === "paid") statusCell.setBackground(COLORS.greenBg).setFontColor("#166534").setFontWeight("bold");
    else statusCell.setBackground(COLORS.warnBg).setFontColor("#713F12").setFontWeight("bold");
  });

  // Totals
  const lastRow = invoices.length + 3;
  const paidTotal = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  const pendTotal = invoices.filter(i => i.status !== "paid").reduce((s, i) => s + i.amount, 0);
  const totalData = [["", "PAID", "", paidTotal, "", "", "", ""], ["", "PENDING", "", pendTotal, "", "", "", ""],
    ["", "TOTAL", "", paidTotal + pendTotal, "", "", "", ""]];
  const totR = sheet.getRange(lastRow, 1, 3, 8);
  totR.setValues(totalData);
  totR.setFontWeight("bold").setBackground(COLORS.totalBg).setFontFamily("Arial").setFontSize(10);
  sheet.getRange(lastRow, 4, 3, 1).setNumberFormat('"$"#,##0.00');

  sheet.setColumnWidths(1, 8, 0);
  [80, 160, 90, 100, 80, 90, 300, 150].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

// ── INCOME STREAMS TAB ────────────────────────────────────────────────────────
function syncIncome(ss, data) {
  let sheet = ss.getSheetByName("💰 Income");
  if (!sheet) sheet = ss.insertSheet("💰 Income");
  sheet.clear();
  sheet.setFrozenRows(2);

  const title = sheet.getRange(1, 1, 1, 6);
  title.merge().setValue("INCOME STREAMS").setBackground(COLORS.headerBg).setFontColor(COLORS.headerText)
    .setFontWeight("bold").setFontSize(12).setFontFamily("Arial");

  const cols = ["Income Stream", "Current / Yr", "Goal / Yr", "YTD Actual", "Gap to Goal", "% of Goal"];
  styleHeader(sheet.getRange(2, 1, 1, cols.length).setValues([cols]), COLORS.subheaderBg, COLORS.subheaderTxt, 10);

  const streams = data.incomeStreams || [];
  streams.forEach((s, i) => {
    const gap = s.goal - s.current;
    const pct = s.goal ? s.current / s.goal : 0;
    const row = [s.name, s.current, s.goal, s.ytd, gap, pct];
    const r = sheet.getRange(i + 3, 1, 1, row.length);
    r.setValues([row]);
    r.setBackground(i % 2 === 0 ? "#FFFFFF" : COLORS.altRow).setFontSize(10).setFontFamily("Arial");
    sheet.getRange(i + 3, 2, 1, 4).setNumberFormat('"$"#,##0_);("$"#,##0)');
    sheet.getRange(i + 3, 6).setNumberFormat('0.0%');
    if (pct >= 1) sheet.getRange(i + 3, 6).setBackground(COLORS.greenBg);
    else if (pct < 0.5) sheet.getRange(i + 3, 6).setBackground(COLORS.warnBg);
  });

  // Totals
  const lastRow = streams.length + 3;
  const totals = streams.reduce((a, s) => ({
    current: a.current + s.current, goal: a.goal + s.goal, ytd: a.ytd + s.ytd
  }), { current: 0, goal: 0, ytd: 0 });
  const totalRow = ["TOTAL", totals.current, totals.goal, totals.ytd, totals.goal - totals.current,
    totals.goal ? totals.current / totals.goal : 0];
  const r = sheet.getRange(lastRow, 1, 1, totalRow.length);
  r.setValues([totalRow]);
  styleHeader(r, COLORS.headerBg, COLORS.headerText, 10);
  sheet.getRange(lastRow, 2, 1, 4).setNumberFormat('"$"#,##0_);("$"#,##0)').setFontColor("#FFFFFF");
  sheet.getRange(lastRow, 6).setNumberFormat('0.0%').setFontColor("#FFFFFF");

  [220, 120, 120, 120, 110, 90].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

// ── EXPENSES TAB ─────────────────────────────────────────────────────────────
function syncExpenses(ss, data) {
  let sheet = ss.getSheetByName("💳 Expenses");
  if (!sheet) sheet = ss.insertSheet("💳 Expenses");
  sheet.clear();
  sheet.setFrozenRows(2);

  const title = sheet.getRange(1, 1, 1, 6);
  title.merge().setValue("EXPENSES (Tax Tracking)").setBackground(COLORS.headerBg).setFontColor(COLORS.headerText)
    .setFontWeight("bold").setFontSize(12).setFontFamily("Arial");

  const cols = ["Description", "Amount", "Category", "Date", "Tax Deductible", "Currency"];
  styleHeader(sheet.getRange(2, 1, 1, cols.length).setValues([cols]), COLORS.subheaderBg, COLORS.subheaderTxt, 10);

  const expenses = data.expenses || [];
  expenses.forEach((e, i) => {
    const row = [e.desc, e.amount, e.category, e.date, e.taxDeductible ? "YES" : "NO", e.currency || "USD"];
    const r = sheet.getRange(i + 3, 1, 1, row.length);
    r.setValues([row]);
    r.setBackground(i % 2 === 0 ? "#FFFFFF" : COLORS.altRow).setFontSize(10).setFontFamily("Arial");
    sheet.getRange(i + 3, 2).setNumberFormat('"$"#,##0.00');
    if (e.taxDeductible) sheet.getRange(i + 3, 5).setBackground(COLORS.greenBg).setFontWeight("bold").setFontColor("#166534");
  });

  const lastRow = expenses.length + 3;
  const taxTotal = expenses.filter(e => e.taxDeductible).reduce((s, e) => s + e.amount, 0);
  const allTotal = expenses.reduce((s, e) => s + e.amount, 0);
  [["TOTAL", allTotal, "", "", "", ""], ["TAX DEDUCTIBLE", taxTotal, "", "", "", ""]].forEach((row, i) => {
    const r = sheet.getRange(lastRow + i, 1, 1, row.length);
    r.setValues([row]).setFontWeight("bold").setBackground(COLORS.totalBg).setFontFamily("Arial").setFontSize(10);
    sheet.getRange(lastRow + i, 2).setNumberFormat('"$"#,##0.00');
  });

  [240, 110, 160, 100, 120, 90].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

// ── SUMMARY TAB ───────────────────────────────────────────────────────────────
function syncSummary(ss, data) {
  let sheet = ss.getSheetByName("📊 Summary");
  if (!sheet) sheet = ss.insertSheet("📊 Summary", 0);
  sheet.clear();

  const snaps = data.monthlySnapshots || [];
  const latest = snaps[snaps.length - 1] || {};
  const prev = snaps[snaps.length - 2] || {};
  const accounts = data.accounts || [];

  const totalFor = s => accounts.reduce((sum, a) => sum + (s[a.id] || 0), 0);
  const total = totalFor(latest);
  const prevTotal = totalFor(prev);
  const change = total - prevTotal;

  const rows = [
    ["Last synced:", new Date().toLocaleString()],
    [],
    ["TOTAL PORTFOLIO", total],
    ["vs Last Month", change],
    ["MoM %", prevTotal ? (total - prevTotal) / prevTotal : 0],
    [],
    ["INCOME"],
    ["Annual Current", data.incomeStreams?.reduce((s, i) => s + i.current, 0) || 0],
    ["Annual Goal", data.incomeStreams?.reduce((s, i) => s + i.goal, 0) || 0],
    ["YTD", data.incomeStreams?.reduce((s, i) => s + i.ytd, 0) || 0],
    [],
    ["INVOICES"],
    ["Paid", data.invoices?.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0) || 0],
    ["Pending", data.invoices?.filter(i => i.status !== "paid").reduce((s, i) => s + i.amount, 0) || 0],
    [],
    ["EXPENSES"],
    ["Total", data.expenses?.reduce((s, e) => s + e.amount, 0) || 0],
    ["Tax Deductible", data.expenses?.filter(e => e.taxDeductible).reduce((s, e) => s + e.amount, 0) || 0],
  ];

  rows.forEach((row, i) => {
    if (!row.length) return;
    const r = sheet.getRange(i + 1, 1, 1, row.length);
    r.setValues([row]);
    if (row.length === 1 && row[0] && !row[0].includes(":")) {
      r.setFontWeight("bold").setFontSize(11).setFontColor(COLORS.sectionBg);
    }
    if (typeof row[1] === "number") {
      sheet.getRange(i + 1, 2).setNumberFormat(row[0].includes("%") ? "0.0%" : '"$"#,##0.00');
      if (row[0].includes("Last Month") || row[0].includes("MoM")) {
        const cell = sheet.getRange(i + 1, 2);
        if (row[1] > 0) cell.setBackground(COLORS.greenBg);
        else if (row[1] < 0) cell.setBackground(COLORS.redBg);
      }
    }
  });

  sheet.getRange(3, 1, 1, 2).setBackground(COLORS.headerBg).setFontColor("#FFFFFF")
    .setFontWeight("bold").setFontSize(12).setFontFamily("Arial");
  sheet.getRange(3, 2).setNumberFormat('"$"#,##0.00').setFontColor("#FFFFFF");

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 160);
}

// ── SETUP: Run this ONCE to create the spreadsheet ────────────────────────────
function setupSheet() {
  const ss = SpreadsheetApp.create("Alvaro Uribe Design — Finance");
  Logger.log("✅ Spreadsheet created!");
  Logger.log("📋 Spreadsheet ID: " + ss.getId());
  Logger.log("🔗 URL: " + ss.getUrl());
  Logger.log("");
  Logger.log("Next steps:");
  Logger.log("1. Copy the Spreadsheet ID above");
  Logger.log("2. Paste it into SHEET_ID at the top of this script");
  Logger.log("3. Deploy → New Deployment → Web App");
  Logger.log("4. Set 'Execute as: Me' and 'Who has access: Anyone'");
  Logger.log("5. Copy the Web App URL");
  Logger.log("6. In your Finance app → Settings → Google Sheets URL → paste it");
  
  // Create initial tabs
  const summary = ss.getActiveSheet();
  summary.setName("📊 Summary");
  ss.insertSheet("📈 Portfolio");
  ss.insertSheet("🧾 Invoices");
  ss.insertSheet("💰 Income");
  ss.insertSheet("💳 Expenses");
  ss.setActiveSheet(summary);
  
  return ss.getId();
}

// ── Style helper ──────────────────────────────────────────────────────────────
function styleHeader(range, bg, textColor, fontSize) {
  range.setBackground(bg)
    .setFontColor(textColor)
    .setFontWeight("bold")
    .setFontSize(fontSize || 10)
    .setFontFamily("Arial")
    .setVerticalAlignment("middle");
  return range;
}

// ── TEST: Run this to test with sample data ───────────────────────────────────
function testSync() {
  const sampleData = {
    accounts: [
      {id:"fid_self",name:"Fidelity Self-Managed",category:"stocks",currency:"USD"},
      {id:"nylife_eg",name:"NYLife Eagle Strategies",category:"stocks",currency:"USD",note:"⚠ Review fees"},
      {id:"sep_ira",name:"Fidelity SEP IRA",category:"retirement",currency:"USD"},
    ],
    monthlySnapshots: [
      {month:"Jan 2026",fid_self:51895,nylife_eg:194705,sep_ira:19226},
      {month:"Feb 2026",fid_self:54441,nylife_eg:180000,sep_ira:19226},
      {month:"Mar 2026",fid_self:67653,nylife_eg:197540,sep_ira:20812},
    ],
    invoices: [
      {num:261,client:"Wooda",date:"1/13/25",amount:285.69,currency:"AUD",status:"paid",lineItems:[{desc:"Design Services",type:"flat",amount:285.69}]},
      {num:262,client:"Black Wolf",date:"3/18/26",amount:2000,currency:"USD",status:"pending",lineItems:[{desc:"Retainer",type:"flat",amount:500},{desc:"Booklet",type:"flat",amount:500},{desc:"Homepage",type:"flat",amount:600},{desc:"Coordination",type:"flat",amount:400}]},
    ],
    incomeStreams: [
      {name:"Teaching / Salary",current:55000,goal:60000,ytd:22916},
      {name:"Design Projects",current:6000,goal:15000,ytd:1500},
      {name:"Product Royalties",current:50000,goal:60000,ytd:12500},
    ],
    expenses: [
      {desc:"Adobe Creative Cloud",amount:599.88,category:"Software",date:"2026-01-15",taxDeductible:true},
      {desc:"Design Conference",amount:1200,category:"Education",date:"2026-02-10",taxDeductible:true},
    ],
    payees: [],
  };
  syncAllTabs(sampleData);
  Logger.log("✅ Test sync complete! Check your spreadsheet.");
}
