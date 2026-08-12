const assert = require('assert');
const databaseModule = require('./src/db');
const {
  sendPopupNotification,
  getPendingPopup,
  acknowledgePopup,
  listAdminPopups
} = require('./src/services/popupNotifications');

const database = databaseModule.db();
const original = {
  users: database.users,
  popupAnnouncements: database.popupAnnouncements,
  popupAnnouncementReceipts: database.popupAnnouncementReceipts
};

try {
  database.users = [
    { id:'u1', phone:'13800000001', status:'active', account_type:'HUMAN' },
    { id:'u2', email:'two@test.com', status:'restricted', account_type:'HUMAN' },
    { id:'bot1', status:'active', account_type:'BOT' },
    { id:'u3', status:'banned', account_type:'HUMAN' }
  ];
  database.popupAnnouncements = [];
  database.popupAnnouncementReceipts = [];

  const sent = sendPopupNotification({ adminId:'admin', title:'重要通知', content:'请立即查看', targetType:'all' });
  assert.strictEqual(sent.recipients.length, 2);
  assert.strictEqual(getPendingPopup('u1').id, sent.popup.id);
  assert.strictEqual(acknowledgePopup('u1', sent.popup.id), true);
  assert.strictEqual(getPendingPopup('u1'), null);

  const targeted = sendPopupNotification({ adminId:'admin', title:'安全提醒', content:'账号安全提示', type:'safety', targetType:'specific', targetIdentifiers:'two@test.com,missing' });
  assert.strictEqual(targeted.recipients.length, 1);
  assert.deepStrictEqual(targeted.unresolved, ['missing']);
  assert.strictEqual(listAdminPopups().items[1].acknowledgedCount, 1);
  console.log('popup notifications: 7 checks passed');
} finally {
  database.users = original.users;
  database.popupAnnouncements = original.popupAnnouncements;
  database.popupAnnouncementReceipts = original.popupAnnouncementReceipts;
  databaseModule.saveNow();
}
