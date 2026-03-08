const express = require('express');
const router = express.Router();
const TravelItinerary = require('../models/TravelItinerary');
const auth = require('../middleware/auth');

// Diagnostic log — remove once working
console.log('TravelItinerary type:', typeof TravelItinerary);
console.log('TravelItinerary value:', TravelItinerary);
console.log('Has findOne?', typeof TravelItinerary?.findOne);

// ── GET /api/travel/itinerary
// Returns the full itinerary for the logged-in user
router.get('/itinerary', auth, async (req, res) => {
  try {
    const itinerary = await TravelItinerary.findOne({ userId: req.user.id });
    if (!itinerary) {
      return res.json({ days: [] });
    }
    res.json(itinerary);
  } catch (error) {
    console.error('Error fetching travel itinerary:', error);
    res.status(500).json({ message: 'Failed to fetch itinerary' });
  }
});

// ── POST /api/travel/itinerary
// Upload/replace full itinerary (called on Excel upload)
router.post('/itinerary', auth, async (req, res) => {
  try {
    const { tripName, days } = req.body;

    if (!days || !Array.isArray(days)) {
      return res.status(400).json({ message: 'days must be an array' });
    }

    // Upsert — one itinerary doc per user
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
// Update a single day's fields (activities, notes, hotel, etc.)
router.put('/itinerary/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    const updates = req.body; // any subset of day fields

    const itinerary = await TravelItinerary.findOne({ userId: req.user.id });
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }

    const dayIndex = itinerary.days.findIndex(d => d.date === date);
    if (dayIndex === -1) {
      return res.status(404).json({ message: `No day found for date ${date}` });
    }

    // Merge updates into the day
    const allowedFields = ['activities', 'notes', 'hotel', 'location', 'booked', 'accomJPY', 'accomAUD'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        itinerary.days[dayIndex][field] = updates[field];
      }
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
// Clear the itinerary (called on "Change file")
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