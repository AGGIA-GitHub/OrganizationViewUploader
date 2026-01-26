# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OrganizationViewUploader** is a PowerApps Component Framework (PCF) control that synchronizes employee organization data from CSV/XLSX files into a Dataverse entity. It provides data comparison, bulk synchronization, manager hierarchy relationships, and user lookup management.

**Tech Stack:** TypeScript, React 16.14, DevExtreme DataGrid, Dataverse WebAPI, pcf-scripts

## Build Commands

```bash
npm run build          # Build the control
npm run start          # Start dev server with hot reload
npm run start:watch    # Dev server with file watching
npm run lint           # Run ESLint
npm run lint:fix       # Fix linting issues
npm run refreshTypes   # Regenerate manifest types after ControlManifest changes
npm run clean          # Clean build artifacts
npm run rebuild        # Clean and rebuild
```

## Architecture

```
OrganizationViewSync/
├── index.ts                    # Main PCF control class, orchestrates sync flow
├── HelloWorld.tsx              # React UI with DevExtreme DataGrid
├── ControlManifest.Input.xml   # PCF manifest configuration
├── config/
│   └── constants.ts            # CSV_COLUMNS, DV_CONFIG, COLUMN_ALIASES, BATCH_CONFIG
├── types/
│   └── index.ts                # DataverseRecord, EmployeeRecord, SyncResult interfaces
├── services/
│   ├── dataverseService.ts     # Dataverse WebAPI operations (fetch, create, update)
│   └── syncService.ts          # Sync logic: addSyncStatus, syncRecordsWithoutHierarchy, syncLookups
├── utils/
│   ├── csvParser.ts            # CSV parsing, column mapping, normalizeColumnNames
│   ├── batchProcessor.ts       # Concurrent batch processing with retry logic
│   └── helpers.ts              # getStringValue, getEmailValue, hasValue utilities
└── generated/                  # Auto-generated types (DO NOT EDIT)
```

## Two-Phase Synchronization Flow

1. **Phase 1 - Data Sync** (`syncRecordsWithoutHierarchy`): Creates/updates Dataverse records WITHOUT setting lookup fields (avoids foreign key errors for new records)
2. **Phase 2 - Lookup Sync** (`syncLookups`): Sets `ag_manager` and `ag_user` lookup relationships using OData `@odata.bind` syntax

## Dataverse Configuration

**Entity:** `ag_organizationview` (plural: `ag_organizationviews`)

| Dataverse Field                              | Purpose                                    | Source               |
| -------------------------------------------- | ------------------------------------------ | -------------------- |
| `ag_globalid`                                | Primary matching key                       | CSV Global ID        |
| `ag_firstname`, `ag_lastname`, `ag_fullname` | Name fields                                | CSV                  |
| `ag_primaryemail`                            | Email address                              | CSV                  |
| `ag_managerglobalid`                         | Manager's global ID (text)                 | CSV                  |
| `ag_manager`                                 | Self-referential lookup to manager record  | Set in Phase 2       |
| `ag_user`                                    | Lookup to `systemuser` table               | Matched by email     |

## Column Aliasing System

CSV columns are matched flexibly via `COLUMN_ALIASES` in `config/constants.ts`. The `normalizeColumnName()` function lowercases and collapses whitespace before matching.

**Important:** Both CSV and XLSX files are normalized through `normalizeColumnNames()` to ensure consistent column mapping regardless of input format.

Example aliases for Manager Global ID:

```
'manager user sys id', 'manager id', 'manager global id', 'Manager Global ID'
```

## Key Data Flow

1. **File Upload** → `parseCSV()` or `parseXLSX()` + `normalizeColumnNames()`
2. **Deduplication** → `deduplicateRecords()` by Global ID
3. **Fetch Dataverse** → `fetchDataverseRecords()` + `fetchSystemUsers()` (parallel)
4. **Status Comparison** → `addSyncStatus()` marks records as synced/modified/not-synced
5. **Phase 1 Sync** → `syncRecordsWithoutHierarchy()` creates/updates records
6. **Phase 2 Sync** → `syncLookups()` sets manager + user lookups

## Sync Status Classification

- **synced**: Exists in Dataverse, all fields match, all lookups set
- **modified**: Fields differ OR manager/user lookup missing
- **not-synced**: Record doesn't exist in Dataverse
- **error**: Sync operation failed

## Batch Processing

Configured in `BATCH_CONFIG`:

- **Concurrency:** 25 parallel requests
- **Retry:** 3 attempts with exponential backoff
- **Retryable codes:** 429, 500, 503, 504
- **Page size:** 5000 records per fetch

## OData Bind Syntax for Lookups

```typescript
// Manager lookup (self-reference)
{ "ag_manager@odata.bind": "/ag_organizationviews(GUID)" }

// User lookup (to systemuser)
{ "ag_user@odata.bind": "/systemusers(GUID)" }
```

## Key Dependencies

- `xlsx` - Excel/CSV file parsing
- `devextreme` / `devextreme-react` - DataGrid component
- `pcf-scripts` - PCF build tooling
