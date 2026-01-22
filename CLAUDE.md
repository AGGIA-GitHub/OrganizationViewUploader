# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OrganizationViewUploader** is a PowerApps Component Framework (PCF) control that synchronizes employee organization data from CSV/XLSX files into a Dataverse entity. It provides data comparison, bulk synchronization, and manager hierarchy relationship management.

**Tech Stack:** TypeScript, React 16.14, DevExtreme DataGrid, Dataverse WebAPI, pcf-scripts

## Build Commands

```bash
npm run build          # Build the control
npm run start          # Start dev server
npm run start:watch    # Dev server with file watching
npm run lint           # Run ESLint
npm run lint:fix       # Fix linting issues
npm run refreshTypes   # Regenerate manifest types after ControlManifest changes
npm run clean          # Clean build artifacts
npm run rebuild        # Clean and rebuild
```

## Architecture

```
OrganizationViewUploader/
├── OrganizationViewSync/           # Main PCF control source
│   ├── index.ts                    # Control implementation & sync logic
│   ├── HelloWorld.tsx              # React UI component
│   ├── ControlManifest.Input.xml   # PCF manifest configuration
│   ├── generated/                  # Auto-generated (DO NOT EDIT)
│   └── styles/                     # DevExtreme theme CSS
└── out/controls/                   # Build output
```

### Two-Phase Synchronization Flow

1. **Phase 1 - Data Sync:** Creates/updates Dataverse records WITHOUT setting manager lookups (avoids foreign key errors for new records)
2. **Phase 2 - Hierarchy Sync:** Sets manager lookup relationships using OData @odata.bind syntax after all records exist

### Dataverse Configuration

- **Entity:** `ag_organizationview` (plural: `ag_organizationviews`)
- **Primary Key:** `ag_organizationviewid`
- **Matching Key:** `ag_globalid` (Global ID from CSV)

### CSV Column to Dataverse Field Mapping

```
Global ID                                    → ag_globalid
First Name                                   → ag_firstname
Last Name                                    → ag_lastname
Business  Email Information Email Address    → ag_primaryemail (NOTE: 2 spaces in header!)
Manager User Sys ID                          → ag_managerglobalid
Manager                                      → ag_manager (lookup)
```

### Key Data Structures

- `DataverseRecord`: Typed Dataverse entity structure
- `EmployeeRecord`: CSV record with sync status metadata
- `CSV_COLUMNS`: Exact column name constants (must match CSV headers precisely)
- `DV_CONFIG`: Dataverse entity/field naming constants

### Sync Status Classification

- **"synced"**: Exists in Dataverse, all fields match, manager lookup set
- **"modified"**: Fields differ OR manager lookup missing
- **"not-synced"**: Record doesn't exist in Dataverse

## Key Dependencies

- `xlsx` - Excel file parsing
- `devextreme` / `devextreme-react` - DataGrid component
- `@fluentui/react-components` - UI components
- `pcf-scripts` - PCF build tooling
