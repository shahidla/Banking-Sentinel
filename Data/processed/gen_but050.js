const fs = require('fs');

// BUT050 - BP Relationships (the connected party graph edges)
// This is the real SAP table for BP relationships (replaces BP2000 from earlier docs)
// Key relationship: Rose Courtney (G-001) <-> Eric Miller (G-002) via family trust
// Both are already contact persons for 30100001 via BUR001 RelNum 13 in sandbox data
// We add an explicit GUARANTOR_CONNECTED synthetic relationship to make the chain visible

const records = [
  // Real sandbox relationship: both guarantors are contacts of Domestic Customer AU 1
  {
    PARTNER1: '30100001', PARTNER2: '30910005',
    RELATIONSHIP_NUMBER: '13', RELATIONSHIP_CATEGORY: 'BUR001',
    RELATIONSHIP_TYPE: 'CONTACT_PERSON', VALID_FROM: '2022-01-01', VALID_TO: '9999-12-31',
    SOURCE: 'SAP_SANDBOX', NOTE: 'Real sandbox BUR001 relationship - Rose Courtney is contact person for AU Customer 1'
  },
  {
    PARTNER1: '30100001', PARTNER2: '30910006',
    RELATIONSHIP_NUMBER: '13', RELATIONSHIP_CATEGORY: 'BUR001',
    RELATIONSHIP_TYPE: 'CONTACT_PERSON', VALID_FROM: '2022-01-01', VALID_TO: '9999-12-31',
    SOURCE: 'SAP_SANDBOX', NOTE: 'Real sandbox BUR001 relationship - Eric Miller is contact person for AU Customer 1'
  },
  // Synthetic connected party: G-001 and G-002 are related via same family trust
  // This is the critical edge for the APS 221 group exposure calculation
  {
    PARTNER1: '30910005', PARTNER2: '30910006',
    RELATIONSHIP_NUMBER: 'SYN-001', RELATIONSHIP_CATEGORY: 'BUR001',
    RELATIONSHIP_TYPE: 'FAMILY_TRUST_MEMBER', VALID_FROM: '2020-07-01', VALID_TO: '9999-12-31',
    SOURCE: 'SYNTHETIC', NOTE: 'Synthetic - Rose Courtney and Eric Miller are both trustees of Courtney-Miller Family Trust. Makes them a connected party group under APS 221.'
  },
  // Additional real sandbox BUR001 relationships within AU cluster
  {
    PARTNER1: '30100002', PARTNER2: '30910007',
    RELATIONSHIP_NUMBER: '14', RELATIONSHIP_CATEGORY: 'BUR001',
    RELATIONSHIP_TYPE: 'CONTACT_PERSON', VALID_FROM: '2021-01-01', VALID_TO: '9999-12-31',
    SOURCE: 'SAP_SANDBOX', NOTE: 'Real sandbox - George Clark is contact person for AU Customer 2'
  },
  {
    PARTNER1: '30100002', PARTNER2: '30910008',
    RELATIONSHIP_NUMBER: '14', RELATIONSHIP_CATEGORY: 'BUR001',
    RELATIONSHIP_TYPE: 'CONTACT_PERSON', VALID_FROM: '2021-01-01', VALID_TO: '9999-12-31',
    SOURCE: 'SAP_SANDBOX', NOTE: 'Real sandbox - Alex Baker is contact person for AU Customer 2'
  },
];

fs.writeFileSync('C:/Dev/Banking-Sentinel/Data/processed/BUT050.json', JSON.stringify({ table: 'BUT050', records }, null, 2));
console.log('BUT050 written:', records.length, 'records');
console.log('Key edge: 30910005 (Rose Courtney G-001) <-> 30910006 (Eric Miller G-002) via FAMILY_TRUST_MEMBER');
