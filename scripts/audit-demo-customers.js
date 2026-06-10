// One-off: audit data sensibility for the 11 BCA_DTI demo customers
// (30100001-30100013, minus 30100007/30100011) across HANA tables.
'use strict';
const cds = require('@sap/cds');

const DEMO_IDS = ['30100001','30100002','30100003','30100004','30100005','30100006','30100008','30100009','30100010','30100012','30100013'];
const GUARANTOR_IDS = ['30910005','30910006','30910007','30910008'];

(async () => {
  await cds.connect.to('db');

  const bps    = await cds.run(SELECT.from('bankingsentinel.BusinessPartners').where({ PARTNER: { in: [...DEMO_IDS, ...GUARANTOR_IDS] } }));
  const dti    = await cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: { in: DEMO_IDS } }));
  const loans  = await cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: { in: DEMO_IDS } }));
  const sched  = await cds.run(SELECT.from('bankingsentinel.LoanSchedule'));
  const guar   = await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR'));
  const collat = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL'));
  const dfkkop = await cds.run(SELECT.from('bankingsentinel.DFKKOP'));
  const dfkkopk = await cds.run(SELECT.from('bankingsentinel.DFKKOPK'));
  const sector = await cds.run(SELECT.from('bankingsentinel.BCA_SECTOR'));

  const bpMap   = Object.fromEntries(bps.map(r => [r.PARTNER, r]));
  const dtiMap  = Object.fromEntries(dti.map(r => [r.PARTNER, r]));
  const loansByPartner = {};
  loans.forEach(l => { (loansByPartner[l.PARTNER] ??= []).push(l); });
  const loanIds = new Set(loans.map(l => l.LOAN_ID));
  const schedByLoan = {};
  sched.filter(s=>loanIds.has(s.LOAN_ID)).forEach(s => { (schedByLoan[s.LOAN_ID] ??= []).push(s); });
  const collatByLoan = {};
  collat.filter(c=>loanIds.has(c.LOAN_ID)).forEach(c => { (collatByLoan[c.LOAN_ID] ??= []).push(c); });
  const dfkkopByLoan = {};
  dfkkop.filter(d=>loanIds.has(d.LOAN_ID)).forEach(d => { (dfkkopByLoan[d.LOAN_ID] ??= []).push(d); });
  const dfkkopkByLoan = {};
  dfkkopk.filter(d=>loanIds.has(d.LOAN_ID)).forEach(d => { (dfkkopkByLoan[d.LOAN_ID] ??= []).push(d); });
  const sectorMap = Object.fromEntries(sector.map(s => [s.SECTOR_CODE, s]));
  const guarByLoan = {};
  guar.filter(g=>loanIds.has(g.LOAN_ID)).forEach(g => { (guarByLoan[g.LOAN_ID] ??= []).push(g); });

  for (const id of DEMO_IDS) {
    console.log(`\n=== ${id} ===`);
    const bp = bpMap[id];
    if (!bp) { console.log('  XX NO BusinessPartners record'); continue; }
    console.log(`  BP: ${bp.BU_SORT1} | sector=${bp.SECTOR_CODE}`);
    if (bp.SECTOR_CODE && !sectorMap[bp.SECTOR_CODE]) console.log(`  !! sector ${bp.SECTOR_CODE} not in BCA_SECTOR`);

    const d = dtiMap[id];
    if (!d) { console.log('  XX NO BCA_DTI record'); continue; }
    const calcDti = (parseFloat(d.TOTAL_DEBT) / parseFloat(d.ANNUAL_INCOME)).toFixed(2);
    const dtiOk = Math.abs(calcDti - parseFloat(d.DTI_RATIO)) < 0.05;
    console.log(`  DTI: ratio=${d.DTI_RATIO} debt=${d.TOTAL_DEBT} income=${d.ANNUAL_INCOME} -> calc=${calcDti} ${dtiOk ? 'OK' : '!! MISMATCH'}`);
    const breachExpected = parseFloat(d.DTI_RATIO) >= parseFloat(d.APRA_LIMIT);
    if (breachExpected !== !!d.BREACH_FLAG) console.log(`  !! BREACH_FLAG=${d.BREACH_FLAG} but DTI ${d.DTI_RATIO} vs limit ${d.APRA_LIMIT} expects ${breachExpected}`);
    if (d.INCOME_SOURCE === 'CONTRACT' && !d.INCOME_EXPIRY) console.log(`  !! INCOME_SOURCE=CONTRACT but no INCOME_EXPIRY`);

    const myLoans = loansByPartner[id] || [];
    if (myLoans.length === 0) { console.log('  XX NO Loans'); continue; }
    for (const loan of myLoans) {
      const schedRows = schedByLoan[loan.LOAN_ID] || [];
      const collatRows = collatByLoan[loan.LOAN_ID] || [];
      const dfkkopRows = dfkkopByLoan[loan.LOAN_ID] || [];
      const dfkkopkRows = dfkkopkByLoan[loan.LOAN_ID] || [];
      const guarRows = guarByLoan[loan.LOAN_ID] || [];
      const totalSched = schedRows.reduce((s,r)=>s+parseFloat(r.AMOUNT_DUE||0),0);
      console.log(`  Loan ${loan.LOAN_ID}: ${loan.STATUS} ${loan.AMOUNT} ${loan.CURRENCY} type=${loan.LOAN_TYPE} sector=${loan.SECTOR_CODE} approved=${loan.APPROVED_DATE} maturity=${loan.MATURITY_DATE}`);
      console.log(`    schedule: ${schedRows.length} rows, sum=${totalSched.toFixed(2)} (vs loan amount ${loan.AMOUNT})`);
      console.log(`    collateral: ${collatRows.length} rows -> ${collatRows.map(c=>`${c.COLLAT_TYPE}=${c.VALUE}`).join(', ') || 'none'}`);
      console.log(`    payments(DFKKOP): ${dfkkopRows.length} rows -> overdue: ${dfkkopRows.map(p=>`${p.DAYS_OVERDUE}d/${p.STATUS}`).join(', ') || 'none'}`);
      if (dfkkopRows.length === 0) console.log(`    !! NO DFKKOP rows for ${loan.LOAN_ID} — pattern-agent will rely on DFKKOPK history only`);
      console.log(`    history(DFKKOPK): ${dfkkopkRows.length} rows -> ${dfkkopkRows.length ? `${dfkkopkRows[0].FAEDN}..${dfkkopkRows[dfkkopkRows.length-1].FAEDN}` : 'none'}`);
      if (guarRows.length) console.log(`    guarantors: ${guarRows.map(g=>`${g.GUARANTOR_PARTNER} (${g.COVER_AMOUNT})`).join(', ')}`);
      if (loan.SECTOR_CODE && !sectorMap[loan.SECTOR_CODE]) console.log(`    !! loan sector ${loan.SECTOR_CODE} not in BCA_SECTOR`);
    }
  }

  console.log('\n=== Guarantor partners (BUT050-connected) ===');
  for (const id of GUARANTOR_IDS) {
    const bp = bpMap[id];
    console.log(`  ${id}: ${bp ? `${bp.BU_SORT1} | sector=${bp.SECTOR_CODE}` : 'XX NO BusinessPartners record'}`);
    const myGuar = guar.filter(g => g.GUARANTOR_PARTNER === id);
    myGuar.forEach(g => console.log(`    guarantees loan ${g.LOAN_ID}: cover=${g.COVER_AMOUNT} ${g.CURRENCY} status=${g.STATUS}`));
  }

  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
