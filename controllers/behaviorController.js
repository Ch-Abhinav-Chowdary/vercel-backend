import EngagementEvent from '../models/EngagementEvent.js';
import DailyComplianceSnapshot from '../models/DailyComplianceSnapshot.js';
import BehaviorAlert from '../models/BehaviorAlert.js';
import User from '../models/User.js';

const SUPPORTED_EVENT_TYPES = [
  'app_login',
  'app_logout',
  'checklist_viewed',
  'checklist_item_completed',
  'checklist_completed',
  'ppe_confirmed',
  'ppe_skipped',
  'video_started',
  'video_progress',
  'video_completed',
  'hazard_reported',
  'instruction_acknowledged',
  'quiz_completed',
  'nudge_acknowledged',
];

const formatDateKey = (date) => {
  const iso = new Date(date || Date.now()).toISOString();
  return iso.split('T')[0];
};

const clampScore = (value) => Math.max(0, Math.min(100, value));

const computeComplianceScore = (metrics) => {
  const checklistScore = metrics.checklistCompletionRate || (metrics.checklistsCompleted > 0 ? 100 : 0);
  const videoScore = metrics.videosStarted
    ? clampScore((metrics.videosCompleted / metrics.videosStarted) * 100)
    : 0;
  const quizScore = clampScore(metrics.quizAverageScore || 0);
  const ppeScore = (metrics.ppeChecksPassed || metrics.ppeChecksFailed)
    ? clampScore((metrics.ppeChecksPassed / ((metrics.ppeChecksPassed || 0) + (metrics.ppeChecksFailed || 0))) * 100)
    : clampScore((metrics.ppeChecksPassed || 0) * 20);
  const hazardScore = clampScore((metrics.hazardsReported || 0) * 10);
  const engagementScore = clampScore((metrics.engagementMinutes || 0) * 5);

  return Math.round(
    0.35 * checklistScore +
    0.2 * videoScore +
    0.15 * quizScore +
    0.15 * ppeScore +
    0.1 * hazardScore +
    0.05 * engagementScore
  );
};

const defaultMetrics = () => ({
  checklistsCompleted: 0,
  checklistItemsCompleted: 0,
  totalChecklistItems: 0,
  checklistCompletionRate: 0,
  videosStarted: 0,
  videosCompleted: 0,
  videoMilestones: 0,
  videoWatchSeconds: 0,
  hazardsReported: 0,
  acknowledgements: 0,
  ppeChecksPassed: 0,
  ppeChecksFailed: 0,
  quizAttempts: 0,
  quizAverageScore: 0,
  engagementMinutes: 0,
  nudgesAcknowledged: 0,
  loginCount: 0,
});

const ensureAlert = async (userId, snapshotDate, type, severity, message, metadata = {}) => {
  const existing = await BehaviorAlert.findOne({
    user: userId,
    snapshotDate,
    type,
    status: 'open',
  });

  if (existing) {
    return existing;
  }

  return BehaviorAlert.create({
    user: userId,
    snapshotDate,
    type,
    severity,
    message,
    metadata,
  });
};

const updateDailySnapshot = async (userId, type, metadata = {}, occurredAt = new Date()) => {
  const dateKey = formatDateKey(occurredAt);
  let snapshot = await DailyComplianceSnapshot.findOne({ user: userId, date: dateKey });
  const isNewSnapshot = !snapshot;

  if (!snapshot) {
    snapshot = new DailyComplianceSnapshot({
      user: userId,
      date: dateKey,
      metrics: defaultMetrics(),
    });
  }

  const metrics = { ...defaultMetrics(), ...(snapshot.metrics?.toObject?.() || snapshot.metrics || {}) };

  switch (type) {
  case 'app_login':
    metrics.loginCount += 1;
    break;
  case 'checklist_viewed':
    metrics.totalChecklistItems = metadata.totalItems || metrics.totalChecklistItems || 0;
    break;
  case 'checklist_item_completed':
    metrics.checklistItemsCompleted += metadata.completed ? 1 : 0;
    metrics.totalChecklistItems = metadata.totalItems || metrics.totalChecklistItems;
    break;
  case 'checklist_completed':
    metrics.checklistsCompleted += 1;
    metrics.checklistItemsCompleted = metrics.totalChecklistItems || metrics.checklistItemsCompleted;
    break;
  case 'ppe_confirmed':
    metrics.ppeChecksPassed += 1;
    break;
  case 'ppe_skipped':
    metrics.ppeChecksFailed += 1;
    break;
  case 'video_started':
    metrics.videosStarted += 1;
    break;
  case 'video_progress':
    metrics.videoMilestones += 1;
    if (metadata.deltaSeconds) {
      metrics.videoWatchSeconds += metadata.deltaSeconds;
      metrics.engagementMinutes += metadata.deltaSeconds / 60;
    }
    break;
  case 'video_completed':
    metrics.videosCompleted += 1;
    if (metadata.durationSeconds) {
      metrics.videoWatchSeconds += metadata.durationSeconds;
      metrics.engagementMinutes += metadata.durationSeconds / 60;
    }
    break;
  case 'hazard_reported':
    metrics.hazardsReported += 1;
    break;
  case 'instruction_acknowledged':
    metrics.acknowledgements += 1;
    break;
  case 'quiz_completed': {
    const score = Number(metadata.score) || 0;
    const attempts = metrics.quizAttempts || 0;
    metrics.quizAverageScore = attempts === 0
      ? score
      : ((metrics.quizAverageScore * attempts) + score) / (attempts + 1);
    metrics.quizAverageScore = Number(metrics.quizAverageScore.toFixed(2));
    metrics.quizAttempts = attempts + 1;
    break;
  }
  case 'nudge_acknowledged':
    metrics.nudgesAcknowledged += 1;
    break;
  default:
    break;
  }

  if (metrics.totalChecklistItems > 0) {
    metrics.checklistCompletionRate = Math.round(
      (metrics.checklistItemsCompleted / metrics.totalChecklistItems) * 100
    );
  } else if (metrics.checklistsCompleted > 0) {
    metrics.checklistCompletionRate = 100;
  }

  const complianceScore = computeComplianceScore(metrics);
  const riskLevel = complianceScore < 60 ? 'high' : complianceScore < 80 ? 'medium' : 'low';

  if (complianceScore >= 80) {
    if (!snapshot.streakSeeded) {
      const previousDate = new Date(dateKey);
      previousDate.setDate(previousDate.getDate() - 1);
      const previousKey = formatDateKey(previousDate);
      const previousSnapshot = await DailyComplianceSnapshot.findOne({ user: userId, date: previousKey });
      const previousStreak = previousSnapshot && previousSnapshot.complianceScore >= 80
        ? previousSnapshot.streakCount || 0
        : 0;
      snapshot.streakCount = previousStreak + 1;
      snapshot.streakSeeded = true;
    }
  } else {
    snapshot.streakCount = 0;
    snapshot.streakSeeded = false;
  }

  snapshot.metrics = metrics;
  snapshot.complianceScore = complianceScore;
  snapshot.riskLevel = riskLevel;
  snapshot.lastEventType = type;
  snapshot.lastEventMetadata = metadata;
  snapshot.lastEventAt = occurredAt;

  await snapshot.save();

  if (riskLevel === 'high') {
    await ensureAlert(
      userId,
      dateKey,
      'low_compliance',
      'high',
      'Compliance score dropped below 60.',
      { complianceScore }
    );
  }

  if (type === 'ppe_skipped') {
    await ensureAlert(
      userId,
      dateKey,
      'ppe_non_compliance',
      'medium',
      'Repeated PPE confirmations were skipped.',
      { totalSkipped: metrics.ppeChecksFailed }
    );
  }

  return snapshot;
};

export const logEngagementEvent = async (req, res) => {
  try {
    const { type, metadata = {} } = req.body;

    if (!SUPPORTED_EVENT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported engagement event type',
      });
    }

    const event = await EngagementEvent.create({
      user: req.user._id,
      type,
      metadata,
      occurredAt: metadata.occurredAt || new Date(),
    });

    await updateDailySnapshot(req.user._id, type, metadata, event.occurredAt);

    res.status(201).json({
      success: true,
      eventId: event._id,
    });
  } catch (error) {
    console.error('Error logging engagement event:', error);
    res.status(500).json({ success: false, message: 'Failed to log engagement event' });
  }
};

export const getMyBehaviorSnapshot = async (req, res) => {
  try {
    const range = Number(req.query.range) || 7;
    const endDate = formatDateKey(new Date());
    const startDateObj = new Date();
    startDateObj.setDate(startDateObj.getDate() - (range - 1));
    const startDate = formatDateKey(startDateObj);

    const snapshots = await DailyComplianceSnapshot
      .find({
        user: req.user._id,
        date: { $gte: startDate, $lte: endDate },
      })
      .sort({ date: 1 });

    const latest = snapshots[snapshots.length - 1] || null;

    res.json({
      success: true,
      data: {
        latest,
        trend: snapshots.map((snapshot) => ({
          date: snapshot.date,
          complianceScore: snapshot.complianceScore,
          riskLevel: snapshot.riskLevel,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching behavior snapshot:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch behavior snapshot' });
  }
};

export const getSupervisorBehaviorOverview = async (req, res) => {
  try {
    const rangeDays = Number(req.query.range) || 7;
    const endDate = formatDateKey(new Date());
    const startDateObj = new Date();
    startDateObj.setDate(startDateObj.getDate() - (rangeDays - 1));
    const startDate = formatDateKey(startDateObj);

    const [snapshots, totalWorkers, alerts, heatmapAggregation] = await Promise.all([
      DailyComplianceSnapshot
        .find({ date: { $gte: startDate, $lte: endDate } })
        .populate('user', 'name role email'),
      User.countDocuments({ role: { $in: ['worker', 'supervisor'] } }),
      BehaviorAlert.find({ status: 'open' })
        .populate('user', 'name email role')
        .sort({ createdAt: -1 })
        .limit(20),
      EngagementEvent.aggregate([
        {
          $match: {
            occurredAt: { $gte: new Date(Date.now() - (24 * 60 * 60 * 1000)) },
            'metadata.zone': { $exists: true },
          },
        },
        {
          $group: {
            _id: '$metadata.zone',
            events: { $sum: 1 },
            ppeSkips: {
              $sum: {
                $cond: [{ $eq: ['$type', 'ppe_skipped'] }, 1, 0],
              },
            },
            hazards: {
              $sum: {
                $cond: [{ $eq: ['$type', 'hazard_reported'] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const averageScore = snapshots.length
      ? Math.round(snapshots.reduce((acc, snap) => acc + (snap.complianceScore || 0), 0) / snapshots.length)
      : 0;

    const todaySnapshots = snapshots.filter((snap) => snap.date === endDate);
    const highRisk = todaySnapshots.filter((snap) => snap.riskLevel === 'high');
    const lowRisk = todaySnapshots.filter((snap) => snap.riskLevel === 'low');
    const inactiveWorkers = Math.max(totalWorkers - todaySnapshots.length, 0);

    const trendMap = {};
    snapshots.forEach((snap) => {
      if (!trendMap[snap.date]) {
        trendMap[snap.date] = { scoreSum: 0, count: 0 };
      }
      trendMap[snap.date].scoreSum += snap.complianceScore || 0;
      trendMap[snap.date].count += 1;
    });
    const trend = Object.entries(trendMap)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, data]) => ({
        date,
        averageScore: Math.round(data.scoreSum / data.count),
      }));

    const topCompliantWorkers = [...todaySnapshots]
      .sort((a, b) => (b.complianceScore || 0) - (a.complianceScore || 0))
      .slice(0, 5);

    const atRiskWorkers = [...todaySnapshots]
      .filter((snap) => snap.riskLevel !== 'low')
      .sort((a, b) => (a.complianceScore || 0) - (b.complianceScore || 0))
      .slice(0, 5);

    const heatmap = heatmapAggregation.map((zone) => ({
      zone: zone._id || 'Unspecified',
      totalEvents: zone.events,
      ppeIncidents: zone.ppeSkips,
      hazardsReported: zone.hazards,
      riskLevel: zone.ppeSkips > 2 ? 'high' : zone.ppeSkips > 0 ? 'medium' : 'low',
    }));

    res.json({
      success: true,
      data: {
        summary: {
          totalWorkers,
          averageScore,
          highRiskCount: highRisk.length,
          lowRiskCount: lowRisk.length,
          inactiveWorkers,
        },
        trend,
        topCompliantWorkers,
        atRiskWorkers,
        heatmap,
        alerts,
      },
    });
  } catch (error) {
    console.error('Error fetching supervisor overview:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch supervisor overview' });
  }
};

export const listBehaviorAlerts = async (req, res) => {
  try {
    const alerts = await BehaviorAlert
      .find({ status: 'open' })
      .populate('user', 'name email role')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Error fetching behavior alerts:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch behavior alerts' });
  }
};

export const acknowledgeBehaviorAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await BehaviorAlert.findById(id);

    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    await alert.save();

    res.json({ success: true, data: alert });
  } catch (error) {
    console.error('Error acknowledging behavior alert:', error);
    res.status(500).json({ success: false, message: 'Failed to acknowledge alert' });
  }
};

