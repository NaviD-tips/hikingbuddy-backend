const mongoose = require('mongoose');

const hikeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  totalDistance: {
    type: Number,
    required: true,
    min: 0
  },
  preHikeBudget: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  onTrailBudget: {
    type: Number,
    required: true,
    min: 0
  },
  budget: {
    type: Number,
    required: true,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Index for faster queries
hikeSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Hike', hikeSchema);
