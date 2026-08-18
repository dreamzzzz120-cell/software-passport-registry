import { OwnerBootstrapDeniedError, runProductionInitialOwnerBootstrap } from '../src/utils/initial-owner-bootstrap.ts';

runProductionInitialOwnerBootstrap()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof OwnerBootstrapDeniedError) {
      console.error('[Initial Owner Bootstrap] Authorization failed.');
    } else {
      console.error('[Initial Owner Bootstrap] Failed.');
    }
    process.exit(1);
  });
