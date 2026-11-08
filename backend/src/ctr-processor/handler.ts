import { KinesisStreamEvent, KinesisStreamHandler } from 'aws-lambda';
import { CtrProcessor } from './ctr-processor';
import { logger } from '../shared/logger';
import { ContactTraceRecord } from '../shared/types';

/**
 * Kinesis-triggered Lambda. Decodes each record, parses the CTR JSON, and delegates
 * to CtrProcessor. One malformed record is logged and skipped so it never fails the
 * whole batch.
 */
export const handler: KinesisStreamHandler = async (event: KinesisStreamEvent) => {
  const processor = new CtrProcessor();
  let stored = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of event.Records ?? []) {
    try {
      const payload = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
      const ctr = JSON.parse(payload) as ContactTraceRecord;
      const wasStored = await processor.ProcessCTREvent(ctr);
      wasStored ? stored++ : skipped++;
    } catch (err) {
      failed++;
      logger.error('Failed to process Kinesis record', {
        sequenceNumber: record.kinesis?.sequenceNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('CTR batch complete', {
    total: event.Records?.length ?? 0,
    stored,
    skipped,
    failed,
  });
};
