/**
 * Visits (访客记录) routes
 *
 * Records who viewed whose profile. A user can ONLY read their own visitor list
 * (privacy: you don't get to see who else someone else's visitors are).
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { recordVisit, getVisitors, getVisitCount } = require('../db');

router.use(auth);

// Record that the current user visited :userId's profile.
// The visit interaction is written inside db.recordVisit (single source of truth),
// so the route just delegates. Self-visits are a no-op.
router.post('/:userId', (req, res) => {
  const r = recordVisit(req.user.id, req.params.userId);
  res.json({ success: true, recorded: !!r });
});

// List visitors to the CURRENT user's own profile (only self allowed).
router.get('/me', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const { items, total } = getVisitors(req.user.id, { limit, offset });
  res.json({
    success: true,
    visitors: items,
    total,
    hasMore: offset + limit < total,
    visitCount: getVisitCount(req.user.id)
  });
});

module.exports = router;
