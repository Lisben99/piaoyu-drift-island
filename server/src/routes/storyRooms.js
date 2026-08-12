'use strict';

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { moderate } = require('../services/moderation');
const storyRooms = require('../services/storyRooms');

router.use(auth);
function respond(res, result) { return res.status(result.status || 200).json(result); }

router.get('/', (req, res) => respond(res, storyRooms.listStoryRooms(req.user, req.query || {})));

router.post('/', async (req, res) => {
  const body = req.body || {};
  const roleTexts = Array.isArray(body.roles) ? body.roles.flatMap(role => [role && role.name, role && role.description]) : [];
  const moderation = await moderate([body.title, body.summary, body.background, ...roleTexts].join('\n'));
  if (!moderation.pass) return res.status(400).json({ success: false, error: moderation.reason });
  return respond(res, storyRooms.createStoryRoom(req.user, body));
});

router.get('/:roomId', (req, res) => respond(res, storyRooms.getStoryRoom(req.user, req.params.roomId)));
router.post('/:roomId/roles/:roleId/select', (req, res) => respond(res, storyRooms.selectStoryRole(req.user, req.params.roomId, req.params.roleId)));
router.post('/:roomId/leave', (req, res) => respond(res, storyRooms.leaveStoryRoom(req.user, req.params.roomId)));
router.post('/:roomId/start', (req, res) => respond(res, storyRooms.startStoryRoom(req.user, req.params.roomId)));
router.post('/:roomId/end', (req, res) => respond(res, storyRooms.endStoryRoom(req.user, req.params.roomId)));
router.get('/:roomId/messages', (req, res) => respond(res, storyRooms.listStoryMessages(req.user, req.params.roomId, req.query.after)));

router.post('/:roomId/messages', async (req, res) => {
  const content = String((req.body || {}).content || '');
  const moderation = await moderate(content);
  if (!moderation.pass) return res.status(400).json({ success: false, error: moderation.reason });
  return respond(res, storyRooms.sendStoryMessage(req.user, req.params.roomId, content));
});

module.exports = router;
