/**
 * Support ticket routes (客服工单)
 * - User side: create a ticket, list my tickets
 * - Admin side: list all tickets, reply / resolve
 */
const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const { db, save, genId, findUserById } = require('../db');

const TICKET_TYPES = ['problem', 'suggestion'];

// ===== User router (/api/support) =====
const userRouter = express.Router();

// Create a support ticket
userRouter.post('/', auth, (req, res) => {
  const { type, subject, description, contact } = req.body || {};

  if (!type || !TICKET_TYPES.includes(type)) {
    return res.json({ success: false, error: '请选择工单类型' });
  }
  if (!description || !String(description).trim()) {
    return res.json({ success: false, error: '请描述您的问题或建议' });
  }

  const ticket = {
    id: genId('st'),
    userId: req.user.id,
    type,
    subject: String(subject || '').trim().slice(0, 200),
    description: String(description).trim().slice(0, 2000),
    contact: String(contact || '').trim().slice(0, 200),
    status: 'pending', // pending | replied | resolved
    reply: '',
    replyAt: null,
    createdAt: Date.now(),
    handledAt: null,
    handledBy: null
  };

  db().supportTickets.push(ticket);
  save();

  res.json({ success: true, ticket });
});

// List my tickets
userRouter.get('/my', auth, (req, res) => {
  const tickets = db().supportTickets
    .filter(t => t.userId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, tickets });
});

// ===== Admin router (/api/admin/support) =====
const adminRouter = express.Router();

// List tickets (with optional status filter + pagination)
adminRouter.get('/support', adminAuth, (req, res) => {
  const { status, page = 1, pageSize = 20 } = req.query;
  let tickets = db().supportTickets;
  if (status && status !== 'all') {
    tickets = tickets.filter(t => t.status === status);
  }
  const total = tickets.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = tickets
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(start, start + parseInt(pageSize))
    .map(t => {
      const u = findUserById(t.userId);
      return {
        ...t,
        userNickname: u ? (u.nickname || u.phone || '未知用户') : '未知用户',
        userPhone: u ? u.phone : ''
      };
    });
  res.json({ success: true, tickets: paged, total });
});

// Reply and/or resolve a ticket
adminRouter.post('/support/:id/handle', adminAuth, (req, res) => {
  const { action, reply } = req.body || {}; // action: 'reply' | 'resolve'
  const ticket = db().supportTickets.find(t => t.id === req.params.id);
  if (!ticket) {
    return res.json({ success: false, error: '工单不存在' });
  }

  if (reply && String(reply).trim()) {
    ticket.reply = String(reply).trim().slice(0, 2000);
    ticket.replyAt = Date.now();
  }
  if (action === 'resolve') {
    ticket.status = 'resolved';
    ticket.replyAt = ticket.replyAt || Date.now();
    ticket.handledAt = Date.now();
    ticket.handledBy = req.admin.id;
  } else if (action === 'reply') {
    if (ticket.status === 'pending') ticket.status = 'replied';
    ticket.handledAt = ticket.handledAt || Date.now();
    ticket.handledBy = req.admin.id;
  }
  save();

  res.json({ success: true, ticket });
});

module.exports = { user: userRouter, admin: adminRouter };
