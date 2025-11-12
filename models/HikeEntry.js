const mongoose = require('mongoose');

const hikeEntrySchema = new mongoose.Schema({
  hikeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hike',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  kmTravelled: {
    type: Number,
    required: true,
    min: 0
  },
  rpe: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  expenses: [{
    category: {
      type: String,
      enum: ['Travel', 'Accommodation', 'Food', 'Equipment', 'General', 'Pre-Hike'],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  moneySpent: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  mood: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  sleepQuality: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  overallFeeling: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  caloriesSpent: {
    type: Number,
    required: true,
    min: 0
  },
  weatherTemp: {
    type: String,
    required: true,
    enum: ['Hot', 'Mild', 'Cold']
  },
  weatherType: {
    type: String,
    enum: ['Sunny', 'Cloudy', 'Rain', 'Storm', 'Windy', 'Snow'],
    required: true
  },
  notes: {  
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for faster queries
hikeEntrySchema.index({ hikeId: 1, date: 1 });
hikeEntrySchema.index({ userId: 1 });

module.exports = mongoose.model('HikeEntry', hikeEntrySchema);
