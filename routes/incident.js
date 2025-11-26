import express from 'express';
import { protect as auth } from '../middleware/authMiddleware.js';
import Hazard from '../models/Hazard.js';

const router = express.Router();

// Helper to map hazard document to incident DTO
const mapHazardToIncident = (hazard) => ({
  id: hazard._id.toString(),
  title: hazard.title,
  description: hazard.description,
  date: new Date(hazard.createdAt).toISOString().split('T')[0],
  severity: hazard.severity
    ? hazard.severity.charAt(0).toUpperCase() + hazard.severity.slice(1)
    : 'Medium',
  status:
    hazard.status === 'resolved'
      ? 'Resolved'
      : hazard.status === 'in_review'
      ? 'Under Investigation'
      : 'Pending',
  location: hazard.location?.description || 'Location not specified',
  reportedBy: hazard.reportedBy?.name || 'Unknown',
  category: hazard.category,
  imageUrl: hazard.imageUrl,
  createdAt: hazard.createdAt,
  resolution: hazard.resolution,
});

// Get all incidents (hazards from database)
router.get('/', auth, async (req, res) => {
  try {
    const hazards = await Hazard.find()
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });

    const incidents = hazards.map(mapHazardToIncident);

    res.json({
      success: true,
      data: incidents,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
});

// Get incident by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const hazard = await Hazard.findById(req.params.id)
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email')
      .populate('resolution.resolvedBy', 'name email');

    if (!hazard) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found',
      });
    }

    const incident = mapHazardToIncident(hazard);

    res.json({
      success: true,
      data: incident,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
});

// Report a new incident (supervisor/admin only)
// NOTE: This currently returns a demo response. In production you would create a Hazard document.
router.post('/', auth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Supervisor or Admin only.',
    });
  }

  const newIncident = {
    ...req.body,
    reportedBy: req.user.name,
    date: new Date().toISOString().split('T')[0],
    status: 'Under Investigation',
  };

  res.status(201).json({
    success: true,
    message: 'Incident reported successfully (demo response)',
    data: newIncident,
  });
});

// Update incident status (admin only)
router.patch('/:id/status', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.',
    });
  }

  const { status, resolutionComment } = req.body;

  const allowedStatuses = ['pending', 'in_review', 'resolved'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status value.',
    });
  }

  try {
    const hazard = await Hazard.findById(req.params.id);

    if (!hazard) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found',
      });
    }

    hazard.status = status;

    // Update resolution metadata when resolved
    if (status === 'resolved') {
      hazard.resolution = {
        ...(hazard.resolution || {}),
        comment: resolutionComment || hazard.resolution?.comment,
        resolvedAt: new Date(),
        resolvedBy: req.user._id,
      };
    } else if (resolutionComment) {
      hazard.resolution = {
        ...(hazard.resolution || {}),
        comment: resolutionComment,
      };
    }

    await hazard.save();

    const incident = mapHazardToIncident(hazard);

    res.json({
      success: true,
      message: 'Incident status updated successfully',
      data: incident,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
});

export default router;