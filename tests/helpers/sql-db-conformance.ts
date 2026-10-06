/**
 * The contract every `SqlDb` adapter must meet. Call `describeSqlDbConformance` from a test file
 * with a function that opens a fresh, empty, in-memory database. The cases themselves live in
 * core (`testing/sql-db-conformance.ts`) as plain data so they also run outside Vitest.
 */
import { describe, it } from 'vitest';
import {
  sqlDbConformanceCases,
  type OpenedSqlDb,
} from '@myastrosky/core/testing/sql-db-conformance';

export type { OpenedSqlDb };
export { sqlDbConformanceCases };

export function describeSqlDbConformance(name: string, open: () => Promise<OpenedSqlDb>): void {
  describe(`SqlDb conformance: ${name}`, () => {
    for (const c of sqlDbConformanceCases) {
      it(c.name, () => c.run(open));
    }
  });
}
