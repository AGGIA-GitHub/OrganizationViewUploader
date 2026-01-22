/**
 * Synchronization service for managing data sync between CSV and Dataverse
 */

import { CSV_COLUMNS, DV_CONFIG, BATCH_CONFIG } from '../config/constants';
import { getStringValue, getEmailValue, hasValue, createFullName } from '../utils/helpers';
import { processBatch, withRetry } from '../utils/batchProcessor';
import { addToDataverseMap } from './dataverseService';
import type { DataverseRecord, EmployeeRecord, SyncResult, HierarchySyncResult, ProgressCallback } from '../types';

/**
 * Compare CSV records with Dataverse and add sync status
 *
 * Status logic:
 * - 'not-synced': Record doesn't exist in Dataverse
 * - 'modified': Record exists but data differs OR manager lookup is missing
 * - 'synced': Record exists, data matches, and manager lookup is set (if applicable)
 */
export function addSyncStatus(
    records: EmployeeRecord[],
    dataverseRecords: Map<string, DataverseRecord>
): EmployeeRecord[] {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  COMPARING CSV WITH DATAVERSE                                  ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n📊 CSV records: ${records.length}`);
    console.log(`📊 DV records in Map: ${dataverseRecords.size}\n`);

    // Show CSV column structure
    if (records.length > 0) {
        console.log('📋 CSV columns detected:', Object.keys(records[0]).join(', '));
        console.log('\n📋 Sample CSV record (first one):');
        console.log('   Global ID:', records[0][CSV_COLUMNS.GLOBAL_ID]);
        console.log('   First Name:', records[0][CSV_COLUMNS.FIRST_NAME]);
        console.log('   Last Name:', records[0][CSV_COLUMNS.LAST_NAME]);
        console.log('   Email:', records[0][CSV_COLUMNS.EMAIL]);
        console.log('   Manager Global ID:', records[0][CSV_COLUMNS.MANAGER_GLOBAL_ID]);
    }

    console.log('\n────────────────────────────────────────────────────────────────');
    console.log('Starting detailed comparison...\n');

    let notSynced = 0;
    let modified = 0;
    let synced = 0;

    const result = records.map((record, index) => {
        const csvGlobalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
        const dvRecord = dataverseRecords.get(csvGlobalId);
        const shouldLog = index < 5;

        if (shouldLog) {
            console.log(`\n🔍 Record ${index + 1}/${records.length}: Global ID="${csvGlobalId}"`);
        }

        // Case 1: Record not found in Dataverse
        if (!dvRecord) {
            notSynced++;
            if (shouldLog) {
                console.log(`   ❌ NOT FOUND in Dataverse`);
                console.log(`   Status: NOT-SYNCED`);
            }
            return {
                ...record,
                syncStatus: 'not-synced' as const,
                dataverseId: undefined
            };
        }

        if (shouldLog) {
            console.log(`   ✅ FOUND in Dataverse (ID: ${dvRecord.ag_organizationviewid})`);
        }

        // Extract and normalize values
        const csvFirstName = getStringValue(record[CSV_COLUMNS.FIRST_NAME]);
        const csvLastName = getStringValue(record[CSV_COLUMNS.LAST_NAME]);
        const csvEmail = getEmailValue(record[CSV_COLUMNS.EMAIL]);
        const csvManagerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);

        const dvFirstName = getStringValue(dvRecord.ag_firstname);
        const dvLastName = getStringValue(dvRecord.ag_lastname);
        const dvEmail = getEmailValue(dvRecord.ag_primaryemail);
        const dvManagerGlobalId = getStringValue(dvRecord.ag_managerglobalid);
        const dvHasManagerLookup = hasValue(dvRecord.ag_managerid);

        // Compare all fields
        const firstNameMatch = csvFirstName === dvFirstName;
        const lastNameMatch = csvLastName === dvLastName;
        const emailMatch = csvEmail === dvEmail;
        const managerGlobalIdMatch = csvManagerGlobalId === dvManagerGlobalId;
        const csvHasManager = hasValue(csvManagerGlobalId);

        if (shouldLog) {
            console.log(`   📊 Field comparison:`);
            console.log(`      First Name: ${firstNameMatch ? '✅' : '❌'} CSV="${csvFirstName}" DV="${dvFirstName}"`);
            console.log(`      Last Name:  ${lastNameMatch ? '✅' : '❌'} CSV="${csvLastName}" DV="${dvLastName}"`);
            console.log(`      Email:      ${emailMatch ? '✅' : '❌'} CSV="${csvEmail}" DV="${dvEmail}"`);
            console.log(`      Manager ID: ${managerGlobalIdMatch ? '✅' : '❌'} CSV="${csvManagerGlobalId}" DV="${dvManagerGlobalId}"`);
            console.log(`   📊 Manager status:`);
            console.log(`      CSV specifies manager: ${csvHasManager ? 'YES' : 'NO'}`);
            console.log(`      DV has manager lookup: ${dvHasManagerLookup ? 'YES' : 'NO'}`);
        }

        // Determine status
        const allFieldsMatch = firstNameMatch && lastNameMatch && emailMatch && managerGlobalIdMatch;
        const managerLookupMissing = csvHasManager && !dvHasManagerLookup;

        let status: 'synced' | 'modified' | 'not-synced';

        if (!allFieldsMatch) {
            status = 'modified';
            modified++;
            if (shouldLog) console.log(`   ⚠️  Status: MODIFIED (Data fields differ)`);
        } else if (managerLookupMissing) {
            status = 'modified';
            modified++;
            if (shouldLog) console.log(`   ⚠️  Status: MODIFIED (Manager lookup relationship not set)`);
        } else {
            status = 'synced';
            synced++;
            if (shouldLog) console.log(`   ✅ Status: SYNCED`);
        }

        return {
            ...record,
            syncStatus: status,
            dataverseId: dvRecord.ag_organizationviewid
        };
    });

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('║  COMPARISON COMPLETE                                          ║');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Synced:      ${synced.toString().padStart(4)} records`);
    console.log(`   ⚠️  Modified:    ${modified.toString().padStart(4)} records`);
    console.log(`   ❌ Not Synced:  ${notSynced.toString().padStart(4)} records`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   📋 Total:       ${records.length.toString().padStart(4)} records`);
    console.log('\n════════════════════════════════════════════════════════════════\n');

    return result;
}

/**
 * Phase 1: Sync all records without manager hierarchy
 * Creates/updates basic data fields but does NOT set manager lookup relationship
 * Uses concurrent batching for performance
 */
export async function syncRecordsWithoutHierarchy(
    toCreate: EmployeeRecord[],
    toUpdate: EmployeeRecord[],
    dataverseRecords: Map<string, DataverseRecord>,
    context: ComponentFramework.Context<unknown>,
    onProgress: ProgressCallback
): Promise<SyncResult> {
    const errors: string[] = [];
    const totalRecords = toCreate.length + toUpdate.length;

    console.log(`\n📝 Phase 1: Syncing ${totalRecords} records (${toCreate.length} create, ${toUpdate.length} update)`);

    // Process creates in batches
    onProgress(0, `Creating ${toCreate.length} records...`);

    const createResult = await processBatch(
        toCreate,
        async (record) => {
            const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);

            // Skip if already exists (duplicate check)
            if (dataverseRecords.has(globalId)) {
                const existing = dataverseRecords.get(globalId)!;
                record.dataverseId = existing.ag_organizationviewid;
                record.syncStatus = 'synced';
                return { action: 'skipped' as const, globalId };
            }

            const firstName = getStringValue(record[CSV_COLUMNS.FIRST_NAME]);
            const lastName = getStringValue(record[CSV_COLUMNS.LAST_NAME]);
            const email = getStringValue(record[CSV_COLUMNS.EMAIL]);
            const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);

            const data = {
                [DV_CONFIG.FIELDS.GLOBAL_ID]: globalId,
                [DV_CONFIG.FIELDS.FIRST_NAME]: firstName,
                [DV_CONFIG.FIELDS.LAST_NAME]: lastName,
                [DV_CONFIG.FIELDS.FULL_NAME]: createFullName(firstName, lastName),
                [DV_CONFIG.FIELDS.EMAIL]: email || null,
                [DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]: managerGlobalId || null
            };

            const result = await withRetry(() =>
                context.webAPI.createRecord(DV_CONFIG.ENTITY_NAME, data)
            );

            // Add to dataverseRecords map immediately to prevent re-fetch
            record.dataverseId = result.id;
            addToDataverseMap(dataverseRecords, {
                ag_organizationviewid: result.id,
                ag_globalid: globalId,
                ag_firstname: firstName,
                ag_lastname: lastName,
                ag_fullname: createFullName(firstName, lastName),
                ag_primaryemail: email,
                ag_managerglobalid: managerGlobalId,
                ag_managerid: ''
            });

            record.syncStatus = hasValue(managerGlobalId) ? 'modified' : 'synced';
            console.log(`✅ Created: ${globalId} (${firstName} ${lastName})`);

            return { action: 'created' as const, globalId, id: result.id };
        },
        {
            concurrency: BATCH_CONFIG.CONCURRENCY,
            onProgress: (completed, total) => {
                const progress = Math.round((completed / (totalRecords || 1)) * 50);
                onProgress(progress, `Creating records: ${completed}/${toCreate.length}`);
            }
        }
    );

    // Track errors from creates
    createResult.results.forEach((result, index) => {
        if (result instanceof Error) {
            const globalId = getStringValue(toCreate[index][CSV_COLUMNS.GLOBAL_ID]);
            errors.push(`Create failed for ${globalId}: ${result.message}`);
            toCreate[index].syncStatus = 'error';
            toCreate[index].syncError = result.message;
            console.error(`❌ Failed to create ${globalId}:`, result.message);
        }
    });

    // Process updates in batches
    onProgress(50, `Updating ${toUpdate.length} records...`);

    const updatableRecords = toUpdate.filter(r => r.dataverseId);

    const updateResult = await processBatch(
        updatableRecords,
        async (record) => {
            const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
            const firstName = getStringValue(record[CSV_COLUMNS.FIRST_NAME]);
            const lastName = getStringValue(record[CSV_COLUMNS.LAST_NAME]);
            const email = getStringValue(record[CSV_COLUMNS.EMAIL]);
            const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);

            const data = {
                [DV_CONFIG.FIELDS.FIRST_NAME]: firstName,
                [DV_CONFIG.FIELDS.LAST_NAME]: lastName,
                [DV_CONFIG.FIELDS.FULL_NAME]: createFullName(firstName, lastName),
                [DV_CONFIG.FIELDS.EMAIL]: email || null,
                [DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]: managerGlobalId || null
            };

            await withRetry(() =>
                context.webAPI.updateRecord(DV_CONFIG.ENTITY_NAME, record.dataverseId!, data)
            );

            record.syncStatus = hasValue(managerGlobalId) ? 'modified' : 'synced';
            console.log(`✅ Updated: ${globalId} (${firstName} ${lastName})`);

            return { action: 'updated' as const, globalId };
        },
        {
            concurrency: BATCH_CONFIG.CONCURRENCY,
            onProgress: (completed, total) => {
                const progress = 50 + Math.round((completed / (totalRecords || 1)) * 50);
                onProgress(progress, `Updating records: ${completed}/${toUpdate.length}`);
            }
        }
    );

    // Track errors from updates
    updateResult.results.forEach((result, index) => {
        if (result instanceof Error) {
            const globalId = getStringValue(updatableRecords[index][CSV_COLUMNS.GLOBAL_ID]);
            errors.push(`Update failed for ${globalId}: ${result.message}`);
            updatableRecords[index].syncStatus = 'error';
            updatableRecords[index].syncError = result.message;
            console.error(`❌ Failed to update ${globalId}:`, result.message);
        }
    });

    // Count records without dataverseId as skipped
    const skippedNoId = toUpdate.filter(r => !r.dataverseId).length;

    console.log(`\n✅ Phase 1 complete: ${createResult.succeeded} created, ${updateResult.succeeded} updated, ${errors.length} errors\n`);

    return {
        created: createResult.succeeded,
        updated: updateResult.succeeded,
        skipped: skippedNoId,
        errors
    };
}

/**
 * Phase 2: Update manager hierarchy (lookups)
 * Sets the ag_manager lookup relationship based on Manager Global ID
 * Uses concurrent batching for performance
 */
export async function syncManagerHierarchy(
    csvRecords: EmployeeRecord[],
    dataverseRecords: Map<string, DataverseRecord>,
    context: ComponentFramework.Context<unknown>,
    onProgress: ProgressCallback
): Promise<HierarchySyncResult> {
    console.log(`\n📝 Phase 2: Setting manager relationships`);

    const errors: string[] = [];

    // Filter records that need manager updates
    const recordsWithManagers = csvRecords.filter(r => {
        const managerGlobalId = getStringValue(r[CSV_COLUMNS.MANAGER_GLOBAL_ID]);
        return hasValue(managerGlobalId) && r.dataverseId;
    });

    console.log(`Processing ${recordsWithManagers.length} records with managers...`);

    let updated = 0;
    let skipped = 0;

    const result = await processBatch(
        recordsWithManagers,
        async (record) => {
            const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
            const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);

            // Find manager in Dataverse
            const managerRecord = dataverseRecords.get(managerGlobalId);

            if (!managerRecord) {
                console.warn(`⚠️ Manager not found: ${managerGlobalId} for record ${globalId}`);
                return { action: 'skipped' as const, globalId, reason: 'Manager not found' };
            }

            // Set manager lookup using OData bind
            const data = {
                [`${DV_CONFIG.FIELDS.MANAGER_LOOKUP}@odata.bind`]:
                    `/${DV_CONFIG.ENTITY_PLURAL}(${managerRecord.ag_organizationviewid})`
            };

            await withRetry(() =>
                context.webAPI.updateRecord(DV_CONFIG.ENTITY_NAME, record.dataverseId!, data)
            );

            record.syncStatus = 'synced';
            console.log(`✅ Set manager for ${globalId} → ${managerGlobalId}`);

            return { action: 'updated' as const, globalId };
        },
        {
            concurrency: BATCH_CONFIG.CONCURRENCY,
            onProgress: (completed, total) => {
                const progress = 20 + Math.round((completed / (total || 1)) * 80);
                onProgress(progress, `Updating manager relations: ${completed}/${total}`);
            }
        }
    );

    // Process results
    result.results.forEach((res, index) => {
        if (res instanceof Error) {
            const globalId = getStringValue(recordsWithManagers[index][CSV_COLUMNS.GLOBAL_ID]);
            errors.push(`Manager update failed for ${globalId}: ${res.message}`);
            recordsWithManagers[index].syncError = res.message;
            console.error(`❌ Failed to set manager for ${globalId}:`, res.message);
            skipped++;
        } else if (typeof res === 'object' && res.action === 'skipped') {
            skipped++;
        } else {
            updated++;
        }
    });

    // Mark records without managers as synced
    csvRecords.forEach(record => {
        const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);
        if (!hasValue(managerGlobalId) && record.dataverseId && record.syncStatus !== 'error') {
            record.syncStatus = 'synced';
        }
    });

    console.log(`\n✅ Phase 2 complete: ${updated} updated, ${skipped} skipped, ${errors.length} errors\n`);

    return { updated, skipped, errors };
}
