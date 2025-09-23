import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('[worker] starting...');
  // TODO: Connect to RabbitMQ and process queues (sms/email/cleanup)
  setInterval(() => {
    console.log(`[worker] heartbeat ${new Date().toISOString()}`);
  }, 15000);
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
