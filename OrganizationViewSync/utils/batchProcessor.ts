/**
 * Batch processing utilities for concurrent API operations
 */

import { BATCH_CONFIG } from '../config/constants';
import type { BatchResult } from '../types';

/**
 * Process items in batches with concurrency control
 * Uses Promise.allSettled to handle partial failures gracefully
 *
 * @param items Array of items to process
 * @param processor Function to process each item
 * @param options Batch processing options
 * @returns Results with success/failure counts
 */
export async function processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
        concurrency?: number;
        onProgress?: (completed: number, total: number) => void;
    } = {}
): Promise<BatchResult<R>> {
    const {
        concurrency = BATCH_CONFIG.CONCURRENCY,
        onProgress
    } = options;

    const results: (R | Error)[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    // Process in chunks for controlled concurrency
    for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const chunkResults = await Promise.allSettled(
            chunk.map(item => processor(item))
        );

        for (const result of chunkResults) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
                succeeded++;
            } else {
                const error = result.reason instanceof Error
                    ? result.reason
                    : new Error(String(result.reason));
                results.push(error);
                failed++;
            }
            completed++;
        }

        if (onProgress) {
            onProgress(completed, items.length);
        }
    }

    return { results, succeeded, failed };
}

/**
 * Retry function with exponential backoff for transient errors
 *
 * @param operation The async operation to retry
 * @param options Retry configuration
 * @returns Result of the operation
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    options: {
        maxAttempts?: number;
        baseDelayMs?: number;
        retryableErrors?: number[];
    } = {}
): Promise<T> {
    const {
        maxAttempts = BATCH_CONFIG.RETRY_ATTEMPTS,
        baseDelayMs = BATCH_CONFIG.RETRY_DELAY_MS,
        retryableErrors = BATCH_CONFIG.RETRYABLE_STATUS_CODES
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if error is retryable
            const errorMessage = lastError.message.toLowerCase();
            const statusRegex = /status[:\s]*(\d{3})/;
            const statusMatch = statusRegex.exec(errorMessage);
            const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

            const isRetryable = (retryableErrors as readonly number[]).includes(statusCode) ||
                errorMessage.includes('timeout') ||
                errorMessage.includes('network') ||
                errorMessage.includes('rate limit') ||
                errorMessage.includes('throttl');

            if (!isRetryable || attempt === maxAttempts) {
                throw lastError;
            }

            // Exponential backoff with jitter
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
            console.warn(`Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms...`);
            await sleep(delay);
        }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError ?? new Error('Retry failed with no error captured');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
