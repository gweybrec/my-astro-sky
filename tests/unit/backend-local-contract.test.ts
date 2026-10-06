// @vitest-environment node
/**
 * Runs the backend contract on the local backend, the one the phone uses: the services themselves, no
 * server. Twice: on the synchronous better-sqlite3 adapter, and on the same wrapped to be really
 * asynchronous, like the phone's database. Each case gets a fresh database, so "nothing stored" holds
 * without clean-up. The solvers installed next to a server do not exist here: the contract skips that case
 * itself when `localSolvers` is absent.
 */
import { afterAll, describe } from 'vitest';
import { describeBackendContract } from '../helpers/backend-contract';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { installFakeInternet, releaseFakeInternet } from '../helpers/contract-shared';
import { makeLocalContractSetup } from '../helpers/local-contract-backend';

installFakeInternet();
afterAll(() => releaseFakeInternet());

describe.each(SQL_ADAPTERS)('Local backend on the %s adapter', (adapterName, wrapDb) => {
  describeBackendContract(`local backend, ${adapterName} database`, () =>
    makeLocalContractSetup({ wrapDb }),
  );
});
