const assert = require('assert');
const databaseModule = require('./src/db');
const {
  sendSiteMail,
  listUserMail,
  getUnreadMailCount,
  readSiteMail,
  markAllSiteMailRead,
  listAdminMail
} = require('./src/services/siteMail');

const database = databaseModule.db();
const original = {
  users: database.users,
  siteMails: database.siteMails,
  siteMailReceipts: database.siteMailReceipts
};

try {
  database.users = [
    { id:'u1', phone:'13800000001', email:'one@test.com', status:'active', account_type:'HUMAN' },
    { id:'u2', phone:'13800000002', email:'two@test.com', status:'restricted', account_type:'HUMAN' },
    { id:'bot1', status:'active', account_type:'BOT' },
    { id:'u3', status:'deleted', account_type:'HUMAN' }
  ];
  database.siteMails = [];
  database.siteMailReceipts = [];

  const broadcast = sendSiteMail({ adminId:'admin', title:'版本更新', content:'新增漂屿信箱', type:'update', version:'v1.0', targetType:'all' });
  assert.strictEqual(broadcast.recipients.length, 2);
  assert.strictEqual(getUnreadMailCount('u1'), 1);
  assert.strictEqual(listUserMail('u1').items[0].title, '版本更新');
  assert.ok(readSiteMail('u1', broadcast.mail.id).readAt);
  assert.strictEqual(getUnreadMailCount('u1'), 0);

  const targeted = sendSiteMail({ adminId:'admin', title:'指定通知', content:'仅发给二号用户', targetType:'specific', targetIdentifiers:'two@test.com,missing' });
  assert.strictEqual(targeted.recipients.length, 1);
  assert.deepStrictEqual(targeted.unresolved, ['missing']);
  assert.strictEqual(markAllSiteMailRead('u2'), 2);
  assert.strictEqual(listAdminMail().items.length, 2);
  console.log('site mail: 8 checks passed');
} finally {
  database.users = original.users;
  database.siteMails = original.siteMails;
  database.siteMailReceipts = original.siteMailReceipts;
  databaseModule.saveNow();
}
