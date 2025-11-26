import express from 'express';
import {
  logEngagementEvent,
  getMyBehaviorSnapshot,
  getSupervisorBehaviorOverview,
  listBehaviorAlerts,
  acknowledgeBehaviorAlert,
} from '../controllers/behaviorController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/events', protect, logEngagementEvent);
router.get('/snapshots/me', protect, getMyBehaviorSnapshot);

router.get(
  '/supervisor/overview',
  protect,
  authorize('supervisor', 'admin', 'dgms_officer'),
  getSupervisorBehaviorOverview
);

router.get(
  '/alerts',
  protect,
  authorize('supervisor', 'admin', 'dgms_officer'),
  listBehaviorAlerts
);

router.post(
  '/alerts/:id/acknowledge',
  protect,
  authorize('supervisor', 'admin', 'dgms_officer'),
  acknowledgeBehaviorAlert
);

export default router;

