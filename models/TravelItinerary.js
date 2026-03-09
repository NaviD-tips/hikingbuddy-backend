const mongoose = require('mongoose');

const travelDaySchema = new mongoose.Schema({
  date: {
    type: String,   // stored as 'YYYY-MM-DD' string for easy keying
    required: true
  },
  activities: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  hotel: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
  },
  booked: {
    type: Boolean,
    default: false
  },
  accomJPY: {
    type: Number,
    default: 0
  },
  accomAUD: {
    type: Number,
    default: 0
  }
});

const travelItinerarySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tripName: {
    type: String,
    default: 'My Trip'
  },
  days: [travelDaySchema]
}, {
  timestamps: true
});

// One itinerary document per user (upsert pattern)
travelItinerarySchema.index({ userId: 1 });

module.exports = mongoose.model('TravelItinerary', travelItinerarySchema);