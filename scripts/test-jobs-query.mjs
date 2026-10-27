import { MikroORM } from '@mikro-orm/postgresql';
import { defineEntity, p } from '@mikro-orm/core';

const Dummy = defineEntity({
  name: 'dummy',
  tableName: 'dummy',
  properties: { id: p.string().primary() },
});

const orm = await MikroORM.init({
  dbName: 'mojito',
  clientUrl: 'postgres://mojito:mojito@localhost:5432/mojito',
  entities: [Dummy],
  connect: false,
});

const em = orm.em.fork();

// Insert a test job (same shape the schedule runner produces)
await em.execute(
  `INSERT INTO pgboss.job (name, data, state, start_after) VALUES (?, ?, ?, ?)`,
  ['schedule-task', JSON.stringify({ scheduleId: 'test', sequenceId: 1 }), 'created', new Date()],
);

// Same SQL as listJobsFn — including the jsonb output column
const rows = await em.execute(
  `SELECT id, name, state, retry_count, retry_limit, start_after, created_on, started_on, completed_on, output::text AS output
   FROM pgboss.job WHERE name = ?`,
  ['schedule-task'],
);

console.log('rows:', rows.length);
for (const job of rows) {
  console.log('start_after :', typeof job.start_after, '→', job.start_after);
  console.log('created_on  :', typeof job.created_on, '→', job.created_on);
  console.log('output      :', typeof job.output, '→', job.output);
  // The exact mapping listJobsFn uses — this is what failed in production
  console.log('mapping     :', job.start_after?.toISOString?.() ?? String(job.start_after));
}

// Cleanup
await em.execute(`DELETE FROM pgboss.job WHERE name = ?`, ['schedule-task']);

await orm.close(true);
