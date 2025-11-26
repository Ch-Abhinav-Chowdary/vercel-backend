import mongoose from 'mongoose';

const checklistItemSchema = new mongoose.Schema({
  task: {
    type: String,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date
  }
});

const checklistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  role: {
    type: String,
    required: true
  },
  items: [checklistItemSchema]
}, {
  timestamps: true
});

const Checklist = mongoose.model('Checklist', checklistSchema);

export default Checklist;