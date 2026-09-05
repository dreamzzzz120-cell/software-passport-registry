import { Router } from 'express';
import { createLegacyFreeReviewRouter, FREE_REVIEW_TENANT_ID } from './free-review-legacy.ts';
import { createUniversalIntakeRouter } from './universal-intake.ts';
import { createTrafficRouter } from './traffic.ts';
export { FREE_REVIEW_TENANT_ID };
export function createFreeReviewRouter() {
  const router = Router();
  router.use(createUniversalIntakeRouter());
  router.use(createLegacyFreeReviewRouter());
  router.use('/traffic', createTrafficRouter());
  return router;
}
