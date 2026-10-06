/**
 * The contract every `Backend` must meet. Call `describeBackendContract` from a test file with the
 * function that gives a backend. The cases themselves live in core (`testing/backend-contract.ts`)
 * as plain data so they also run outside Vitest.
 */
import { describe, it } from 'vitest';
import {
  backendContractCases,
  type BackendContractCase,
  type MakeBackend,
} from '@myastrosky/core/testing/backend-contract';

export type { MakeBackend };

export function describeBackendContract(name: string, makeBackend: MakeBackend): void {
  describe(`Backend contract: ${name}`, () => {
    const cases: BackendContractCase[] = backendContractCases(makeBackend);
    for (const c of cases) {
      it(c.name, () => c.run(), 60_000);
    }
  });
}
