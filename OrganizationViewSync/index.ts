/**
 * OrganizationViewSync PCF Control
 *
 * A PowerApps Component Framework control for synchronizing employee
 * organization data from CSV/XLSX files into Dataverse.
 */

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { HelloWorld, IHelloWorldProps } from "./HelloWorld";
import * as React from "react";
import * as XLSX from 'xlsx';

// Import configuration and types
import { CSV_COLUMNS } from './config/constants';
import type { DataverseRecord, EmployeeRecord, SyncResult, HierarchySyncResult } from './types';

// Import utilities
import { parseCSV, deduplicateRecords, normalizeColumnNames } from './utils/csvParser';

// Import services
import { fetchDataverseRecords, fetchSystemUsers } from './services/dataverseService';
import { addSyncStatus, syncRecordsWithoutHierarchy, syncLookups } from './services/syncService';

/**
 * Main PCF Control Class
 */
export class OrganizationViewSync implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private context: ComponentFramework.Context<IInputs>;
    private width: number;
    private height: number;
    private dataverseRecords = new Map<string, DataverseRecord>();
    private systemUsers = new Map<string, string>();  // email → systemuserid
    private csvRecords: EmployeeRecord[] = [];

    constructor() {
        // Empty constructor
    }

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;

        // Get container dimensions
        this.width = context.mode.allocatedWidth;
        this.height = context.mode.allocatedHeight;
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        this.context = context;
        this.width = context.mode.allocatedWidth;
        this.height = context.mode.allocatedHeight;

        const props: IHelloWorldProps = {
            width: this.width,
            height: this.height,
            onFileUpload: this.handleFileUpload.bind(this),
            onSynchronizeData: this.handleSynchronizeData.bind(this),
            onSynchronizeHierarchy: this.handleSynchronizeHierarchy.bind(this)
        };

        return React.createElement(HelloWorld, props);
    }

    /**
     * Handle file upload and initial data processing
     */
    private async handleFileUpload(
        file: File,
        onProgress: (progress: number, message: string) => void
    ): Promise<Record<string, unknown>[]> {
        try {
            onProgress(10, 'Reading file...');

            // Parse file based on extension
            const fileName = file.name.toLowerCase();
            const extension = fileName.split('.').pop() ?? '';
            let rawData: Record<string, unknown>[];

            if (extension === 'csv') {
                const text = await file.text();
                // parseCSV already normalizes column names
                rawData = parseCSV(text);
            } else if (extension === 'xlsx' || extension === 'xls') {
                // Parse XLSX and then normalize column names
                const xlsxData = await this.parseXLSX(file);
                rawData = normalizeColumnNames(xlsxData);
            } else {
                void this.context.navigation.openAlertDialog({
                    text: 'Unsupported file format. Please use CSV, XLSX, or XLS.',
                    confirmButtonLabel: "OK"
                });
                return [];
            }

            if (rawData.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'No data found in file.',
                    confirmButtonLabel: "OK"
                });
                return [];
            }

            onProgress(30, `Parsed ${rawData.length} records from file`);

            // Log sample record to verify column mapping
            if (rawData.length > 0) {
                console.log('\n📋 Sample normalized record (first one):');
                console.log('   Global ID:', rawData[0][CSV_COLUMNS.GLOBAL_ID]);
                console.log('   First Name:', rawData[0][CSV_COLUMNS.FIRST_NAME]);
                console.log('   Last Name:', rawData[0][CSV_COLUMNS.LAST_NAME]);
                console.log('   Email:', rawData[0][CSV_COLUMNS.EMAIL]);
                console.log('   Manager Global ID:', rawData[0][CSV_COLUMNS.MANAGER_GLOBAL_ID]);
                console.log('   Manager Name:', rawData[0][CSV_COLUMNS.MANAGER_NAME]);
            }

            // Deduplicate records
            const { records: deduplicatedData, duplicates } = deduplicateRecords(
                rawData as EmployeeRecord[],
                CSV_COLUMNS.GLOBAL_ID
            );

            if (duplicates.length > 0) {
                console.warn(`Removed ${duplicates.length} duplicate records`);
            }

            onProgress(40, `Deduped to ${deduplicatedData.length} unique records`);

            // Fetch existing records from Dataverse and system users in parallel
            onProgress(50, 'Fetching existing records from Dataverse...');
            const [, systemUsersMap] = await Promise.all([
                fetchDataverseRecords(this.context, this.dataverseRecords),
                fetchSystemUsers(this.context)
            ]);
            this.systemUsers = systemUsersMap;

            onProgress(70, `Loaded ${this.dataverseRecords.size} org records, ${this.systemUsers.size} system users`);

            // Compare and add sync status
            onProgress(85, 'Comparing data and preparing for sync...');
            const enrichedData = addSyncStatus(deduplicatedData, this.dataverseRecords);

            // Store CSV records for synchronization
            this.csvRecords = enrichedData;

            // Calculate summary counts
            const syncedCount = enrichedData.filter(r => r.syncStatus === 'synced').length;
            const notSyncedCount = enrichedData.filter(r => r.syncStatus === 'not-synced').length;
            const modifiedCount = enrichedData.filter(r => r.syncStatus === 'modified').length;

            void this.context.navigation.openAlertDialog({
                text: `File loaded successfully!\n\nTotal: ${enrichedData.length}\nSynced: ${syncedCount}\nNot Synced: ${notSyncedCount}\nModified: ${modifiedCount}${duplicates.length > 0 ? `\n\nNote: ${duplicates.length} duplicate records were removed.` : ''}`,
                confirmButtonLabel: "OK"
            });

            return enrichedData;

        } catch (error) {
            console.error('Error processing file:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            void this.context.navigation.openAlertDialog({
                text: `Error: ${errorMessage}`,
                confirmButtonLabel: "OK"
            });
            return [];
        }
    }

    /**
     * Handle synchronization button click
     */
    private async handleSynchronizeData(
        onProgress: (progress: number, message: string) => void
    ): Promise<{ cancelled: boolean; data: EmployeeRecord[] }> {
        try {
            if (this.csvRecords.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'No data to synchronize. Please load a file first.',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }

            // Filter records that need synchronization
            const toCreate = this.csvRecords.filter(r => r.syncStatus === 'not-synced');
            const toUpdate = this.csvRecords.filter(r => r.syncStatus === 'modified');

            if (toCreate.length === 0 && toUpdate.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'All records are already synchronized!',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }

            const confirmMessage = `Ready to synchronize data:\n\n` +
                `Create: ${toCreate.length} records\n` +
                `Update: ${toUpdate.length} records\n\n` +
                `Note: Manager relationships will NOT be set. Use "Set Manager Relations" button after this.\n\n` +
                `Continue?`;

            const confirmResult = await this.context.navigation.openConfirmDialog({
                text: confirmMessage,
                title: 'Confirm Data Synchronization'
            });

            if (!confirmResult.confirmed) {
                return { cancelled: true, data: this.csvRecords };
            }

            // User confirmed - now show progress
            onProgress(0, 'Starting synchronization...');

            // Phase 1: Create/Update all records without manager lookup
            const syncResult: SyncResult = await syncRecordsWithoutHierarchy(
                toCreate,
                toUpdate,
                this.dataverseRecords,
                this.context,
                onProgress
            );

            // Build completion message
            let message = `Data synchronization completed!\n\n`;
            message += `Created: ${syncResult.created}\n`;
            message += `Updated: ${syncResult.updated}\n`;

            if (syncResult.errors.length > 0) {
                message += `\nErrors: ${syncResult.errors.length}\n`;
                // Show first 5 errors
                message += syncResult.errors.slice(0, 5).join('\n');
                if (syncResult.errors.length > 5) {
                    message += `\n...and ${syncResult.errors.length - 5} more errors`;
                }
            }

            message += `\n\nYou can now use "Set Manager Relations" to update the hierarchy.`;

            void this.context.navigation.openAlertDialog({
                text: message,
                confirmButtonLabel: "OK"
            });

            // Return updated records for React to refresh
            return { cancelled: false, data: [...this.csvRecords] };

        } catch (error) {
            console.error('Error during data synchronization:', error);
            void this.context.navigation.openAlertDialog({
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                confirmButtonLabel: "OK"
            });
            return { cancelled: false, data: this.csvRecords };
        }
    }

    /**
     * Handle setting manager hierarchy
     */
    private async handleSynchronizeHierarchy(
        onProgress: (progress: number, message: string) => void
    ): Promise<{ cancelled: boolean; data: EmployeeRecord[] }> {
        try {
            if (this.csvRecords.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'No data loaded. Please load a file first.',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }

            const confirmMessage = `This will update lookup relationships for all records:\n\n` +
                `• Manager lookups (ag_manager) - based on Manager Global ID\n` +
                `• User lookups (ag_user) - based on email matching to systemuser\n\n` +
                `Make sure you have already synchronized the data using "Synchronize Data" button.\n\n` +
                `Continue?`;

            const confirmResult = await this.context.navigation.openConfirmDialog({
                text: confirmMessage,
                title: 'Confirm Lookup Update'
            });

            if (!confirmResult.confirmed) {
                return { cancelled: true, data: this.csvRecords };
            }

            // User confirmed - now show progress
            onProgress(0, 'Starting lookup update...');

            // Phase 2: Update lookups (manager + user)
            const hierarchyResult: HierarchySyncResult = await syncLookups(
                this.csvRecords,
                this.dataverseRecords,
                this.systemUsers,
                this.context,
                onProgress
            );

            // Build completion message
            let message = `Lookup update completed!\n\n`;
            message += `Updated: ${hierarchyResult.updated}\n`;
            message += `Skipped: ${hierarchyResult.skipped}`;

            if (hierarchyResult.errors.length > 0) {
                message += `\n\nErrors: ${hierarchyResult.errors.length}\n`;
                message += hierarchyResult.errors.slice(0, 5).join('\n');
                if (hierarchyResult.errors.length > 5) {
                    message += `\n...and ${hierarchyResult.errors.length - 5} more errors`;
                }
            }

            void this.context.navigation.openAlertDialog({
                text: message,
                confirmButtonLabel: "OK"
            });

            return { cancelled: false, data: [...this.csvRecords] };

        } catch (error) {
            console.error('Error during hierarchy synchronization:', error);
            void this.context.navigation.openAlertDialog({
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                confirmButtonLabel: "OK"
            });
            return { cancelled: false, data: this.csvRecords };
        }
    }

    /**
     * Parse XLSX/XLS file content
     */
    private async parseXLSX(file: File): Promise<Record<string, unknown>[]> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e: ProgressEvent<FileReader>) => {
                try {
                    const data = e.target?.result;
                    if (!data) {
                        reject(new Error('Failed to read file'));
                        return;
                    }

                    // Read the workbook
                    const workbook = XLSX.read(data, { type: 'array' });

                    // Get the first sheet
                    const firstSheetName = workbook.SheetNames[0];
                    if (!firstSheetName) {
                        reject(new Error('No sheets found in workbook'));
                        return;
                    }

                    const worksheet = workbook.Sheets[firstSheetName];

                    // Convert to JSON with header row
                    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
                        defval: '' // Default value for empty cells
                    });

                    resolve(jsonData);
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        // Cleanup if necessary
    }
}
