# Banking Sentinel — Full HANA Cloud Restore
# Run this after provisioning a new HANA Cloud trial instance.
#
# BEFORE running this script, complete these one-time manual steps:
#   1. BTP Cockpit → HANA Cloud → Create instance named: banking-sentinel-db
#      (Free Tier plan; ~3 minutes to provision)
#   2. BTP Cockpit → banking-sentinel-db → Create Service Key: banking-sentinel-db-key
#   3. In this project directory, rebind CDS to the new instance:
#        cds bind -2 banking-sentinel-db
#      (updates .cdsrc-private.json — commit the change)
#   4. In .env, update these two values with the new instance details:
#        HANA_HOST=<new-guid>.hna1.prod-us10.hanacloud.ondemand.com
#        HANA_PASSWORD=<new-password>
#      (find them in the service key JSON in BTP cockpit)
#
# THEN run this script from the project root:
#   cd c:\Dev\Banking-Sentinel
#   .\scripts\restore-hana.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "Banking Sentinel -- HANA Cloud Restore" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Deploy schema ─────────────────────────────────────────────────────
Write-Host "[1/3] Deploying schema to HANA Cloud (HDI deploy)..." -ForegroundColor Yellow
$env:CDS_ENV = "hybrid"
npx cds deploy --to hana
if ($LASTEXITCODE -ne 0) {
    Write-Error "Schema deploy failed (exit $LASTEXITCODE). Check .cdsrc-private.json and HANA instance status."
    exit 1
}
Write-Host "      Schema deployed." -ForegroundColor Green

# ── Step 2: Seed all data tables ─────────────────────────────────────────────
Write-Host ""
Write-Host "[2/3] Seeding all data tables (14 entities)..." -ForegroundColor Yellow
node --env-file=.env scripts/seed.js
if ($LASTEXITCODE -ne 0) {
    Write-Error "Data seed failed (exit $LASTEXITCODE)."
    exit 1
}

# ── Step 3: Seed APRA regulatory docs (vector store) ─────────────────────────
Write-Host ""
Write-Host "[3/3] Embedding APRA regulatory docs into HANA Vector Store..." -ForegroundColor Yellow
Write-Host "      (downloads 3 PDFs from apra.gov.au + calls OpenAI embeddings -- takes ~2-3 min)" -ForegroundColor Gray
node --env-file=.env scripts/seed-regulatory.js
if ($LASTEXITCODE -ne 0) {
    Write-Error "Regulatory seed failed (exit $LASTEXITCODE). Check OPENAI_API_KEY in .env."
    exit 1
}

Write-Host ""
Write-Host "HANA restore complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - Restart CAP server:   npm run start:local"
Write-Host "  - Verify tables:        http://localhost:4004/admin"
Write-Host "  - GraphDB (separate):   node scripts/seed-graphdb.js"
Write-Host "    (GraphDB sandbox expires every 7 days -- run separately when needed)"
Write-Host ""
