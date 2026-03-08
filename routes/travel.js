const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');

// ── Inline model (avoids any file import issues) ──
const travelDaySchema = new mongoose.Schema({
  date:       { type: String, required: true },
  activities: { type: String, default: '' },
  notes:      { type: String, default: '' },
  hotel:      { type: String, default: '' },
  location:   { type: String, default: '' },
  booked:     { type: Boolean, default: false },
  accomJPY:   { type: Number, default: 0 },
  accomAUD:   { type: Number, default: 0 },
});

const TravelItinerary = mongoose.models.TravelItinerary ||
  mongoose.model('TravelItinerary', new mongoose.Schema({
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tripName: { type: String, default: 'My Trip' },
    days:     [travelDaySchema],
  }, { timestamps: true }));

console.log('TravelItinerary ready:', typeof TravelItinerary.findOne);

// ── GET /api/travel/itinerary
router.get('/itinerary', auth, async (req, res) => {
  try {
    const itinerary = await TravelItinerary.findOne({ userId: req.user.id });
    if (!itinerary) return res.json({ days: [] });
    res.json(itinerary);
  } catch (error) {
    console.error('Error fetching travel itinerary:', error);
    res.status(500).json({ message: 'Failed to fetch itinerary' });
  }
});

// ── POST /api/travel/itinerary
router.post('/itinerary', auth, async (req, res) => {
  try {
    const { tripName, days } = req.body;
    if (!days || !Array.isArray(days)) {
      return res.status(400).json({ message: 'days must be an array' });
    }
    const itinerary = await TravelItinerary.findOneAndUpdate(
      { userId: req.user.id },
      { userId: req.user.id, tripName: tripName || 'My Trip', days },
      { upsert: true, new: true, runValidators: true }
    );
    res.status(201).json(itinerary);
  } catch (error) {
    console.error('Error saving travel itinerary:', error);
    res.status(500).json({ message: 'Failed to save itinerary' });
  }
});

// ── PUT /api/travel/itinerary/:date
router.put('/itinerary/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    const updates = req.body;
    const itinerary = await TravelItinerary.findOne({ userId: req.user.id });
    if (!itinerary) return res.status(404).json({ message: 'Itinerary not found' });
    const dayIndex = itinerary.days.findIndex(d => d.date === date);
    if (dayIndex === -1) return res.status(404).json({ message: `No day found for date ${date}` });
    const allowedFields = ['activities', 'notes', 'hotel', 'location', 'booked', 'accomJPY', 'accomAUD'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) itinerary.days[dayIndex][field] = updates[field];
    });
    itinerary.markModified('days');
    await itinerary.save();
    res.json(itinerary.days[dayIndex]);
  } catch (error) {
    console.error('Error updating travel day:', error);
    res.status(500).json({ message: 'Failed to update day' });
  }
});

// ── DELETE /api/travel/itinerary
router.delete('/itinerary', auth, async (req, res) => {
  try {
    await TravelItinerary.deleteOne({ userId: req.user.id });
    res.json({ message: 'Itinerary cleared' });
  } catch (error) {
    console.error('Error deleting travel itinerary:', error);
    res.status(500).json({ message: 'Failed to clear itinerary' });
  }
});

module.exports = router;