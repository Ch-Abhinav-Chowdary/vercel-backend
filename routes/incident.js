import express from 'express';
import { protect as auth } from '../middleware/authMiddleware.js';
import Hazard from '../models/Hazard.js';

const router = express.Router();

// Get all incidents (hazards from database)
router.get('/', auth, async (req, res) => {
  try {
    const hazards = await Hazard.find()
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });
    
    // Transform hazards to match incident format expected by frontend
    const incidents = hazards.map(hazard => ({
      id: hazard._id.toString(),
      title: hazard.title,
      description: hazard.description,
      date: new Date(hazard.createdAt).toISOString().split('T')[0],
      severity: hazard.severity ? hazard.severity.charAt(0).toUpperCase() + hazard.severity.slice(1) : 'Medium',
      status: hazard.status === 'resolved' ? 'Resolved' : 
              hazard.status === 'in_review' ? 'Under Investigation' : 
              'Pending',
      location: hazard.location?.description || 'Location not specified',
      reportedBy: hazard.reportedBy?.name || 'Unknown',
      category: hazard.category,
      imageUrl: hazard.imageUrl,
      createdAt: hazard.createdAt
    }));
    
    res.json({
      success: true,
      data: incidents
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
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
        message: 'Incident not found'
      });
    }
    
    // Transform hazard to match incident format
    const incident = {
      id: hazard._id.toString(),
      title: hazard.title,
      description: hazard.description,
      date: new Date(hazard.createdAt).toISOString().split('T')[0],
      severity: hazard.severity ? hazard.severity.charAt(0).toUpperCase() + hazard.severity.slice(1) : 'Medium',
      status: hazard.status === 'resolved' ? 'Resolved' : 
              hazard.status === 'in_review' ? 'Under Investigation' : 
              'Pending',
      location: hazard.location?.description || 'Location not specified',
      reportedBy: hazard.reportedBy?.name || 'Unknown',
      category: hazard.category,
      imageUrl: hazard.imageUrl,
      createdAt: hazard.createdAt,
      resolution: hazard.resolution
    };
    
    res.json({
      success: true,
      data: incident
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

// Report a new incident (supervisor/admin only)
router.post('/', auth, (req, res) => {
  // Check if user is supervisor or admin
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Supervisor or Admin only.'
    });
  }
  
  // In a real app, you would validate and save to database
  const newIncident = {
    id: (incidents.length + 1).toString(),
    ...req.body,
    reportedBy: req.user.name,
    date: new Date().toISOString().split('T')[0],
    status: 'Under Investigation'
  };
  
  // For demo purposes, just return success
  res.status(201).json({
    success: true,
    message: 'Incident reported successfully',
    data: newIncident
  });
});

// Update incident status (admin only)
router.patch('/:id/status', auth, (req, res) => {
  // Check if user is admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
  
  const incident = incidents.find(i => i.id === req.params.id);
  
  if (!incident) {
    return res.status(404).json({
      success: false,
      message: 'Incident not found'
    });
  }
  
  // In a real app, you would update the database
  // For demo purposes, just return success
  res.json({
    success: true,
    message: 'Incident status updated successfully',
    data: {
      ...incident,
      status: req.body.status
    }
  });
});

export default router;