// 使用真实 Vue 响应式运行时和隔离浏览器替身，不访问真实账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const createTestRenderer = require('./helpers/vue-renderer.cjs');

const frontend = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(frontend, 'js', 'app.js'), 'utf8');
const vue = fs.readFileSync(path.join(frontend, 'vendor', 'vue.global.prod.js'), 'utf8');
const scriptPaths = [...html.matchAll(/<script src="\/(.*?)"><\/script>/g)].map(match => match[1]);
const componentSources = scriptPaths.filter(name => name !== 'vendor/vue.global.prod.js' && name !== 'js/app.js')
  .map(name => ({ name, source: fs.readFileSync(path.join(frontend, name), 'utf8') }));
const rootTemplate = html.match(/<div id="app" v-cloak>([\s\S]*?)\n<\/div>/)[1];
const clone = value => JSON.parse(JSON.stringify(value));
const makeRecord = (id = 'test', extra = {}) => ({
  id, type: 'expense', date: '2026-01-02', amount: 1, category: '餐饮', member: '测试成员', note: '', createdAt: 1, ...extra,
});

async function harness(initial = [], options = {}) {
  const remote = { records: clone(initial), members: [{ id: 'mingqi', name: '测试成员' }, { id: 'jiaren', name: '家人' }], revision: 'rev-0', token: 'test-token' };
  const state = { remote, gets: 0, posts: 0, fail: false, loseResponse: false, gate: null, downloads: [], errors: [], listeners: {} };
  const storage = new Map(Object.entries(options.storage || {}));
  const context = vm.createContext({ console, setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; },
    clearTimeout, AbortController, Blob, crypto: { randomUUID } });
  vm.runInContext(vue, context);
  context.window = { addEventListener(name, handler) { state.listeners[name] = handler; } };
  context.document = {
    body: { style: {}, appendChild() {} }, activeElement: null, querySelector: () => null,
    createElement: () => ({ click() {}, remove() {} }),
  };
  context.URL = { createObjectURL(blob) { state.downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} };
  context.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) { if (options.storageFull) throw new Error('配额不足'); storage.set(key, value); },
  };
  context.FileReader = class {
    readAsText(file) { this.result = file.contents; this.onload(); }
  };
  context.fetch = async (url, config = {}) => {
    if (state.fail) throw new Error('测试网络断开');
    if (config.method === 'POST') {
      state.posts++;
      if (state.gate) await state.gate;
      const body = JSON.parse(config.body);
      if (body.revision !== remote.revision) return { ok: false, status: 409, json: async () => ({ error: '版本冲突' }) };
      remote.records = body.records;
      remote.members = body.members;
      remote.revision = 'rev-' + state.posts;
      if (state.loseResponse) { state.loseResponse = false; throw new Error('测试响应丢失'); }
      return { ok: true, json: async () => ({ ok: true, revision: remote.revision }) };
    }
    state.gets++;
    return { ok: true, json: async () => clone(remote) };
  };
  for (const file of componentSources) vm.runInContext(file.source, context, { filename: 'frontend/' + file.name });
  if (options.render) {
    state.ui = createTestRenderer(context.Vue, context.document);
    context.Vue.createApp = config => ({ mount() {
      state.components = config.components;
      for (const component of Object.values(config.components)) {
        component.render = context.Vue.compile(component.template, { hoistStatic: false });
      }
      const app = state.ui.renderer.createApp({ ...config,
        render: context.Vue.compile(rootTemplate, { hoistStatic: false }),
        setup() { state.app = config.setup(); return state.app; },
      });
      app.config.errorHandler = error => { state.errors.push(error); };
      app.mount(state.ui.root);
      state.unmount = () => app.unmount();
    } });
  } else {
    context.Vue.provide = () => {};
    context.Vue.createApp = config => ({ mount() { state.app = config.setup(); } });
  }
  vm.runInContext(source, context, { filename: 'frontend/js/app.js' });
  await new Promise(resolve => setImmediate(resolve));
  state.context = context;
  state.storage = storage;
  state.app.cursor.value = { y: 2026, m: 0 };
  state.flush = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await context.Vue.nextTick();
    assert.deepEqual(state.errors, [], '组件挂载或事件处理不应报错');
  };
  await state.flush();
  return state;
}

function fill(app) {
  app.openDrawer();
  app.form.amount = '12.34';
  app.form.date = '2026-01-02';
}

test('入口只组合页面，依次加载 Vue、上下文、组件和应用，无构建依赖', () => {
  assert.deepEqual(scriptPaths, ['vendor/vue.global.prod.js', 'js/view-context.js',
    'pages/detail.js', 'pages/stats.js', 'pages/invest.js', 'pages/settings.js',
    'components/tab-bar.js', 'components/record-drawer.js', 'components/confirm-dialog.js', 'js/app.js']);
  for (const tag of ['detail-page', 'stats-page', 'invest-page', 'settings-page', 'tab-bar', 'record-drawer', 'confirm-dialog']) {
    assert.ok(rootTemplate.includes('<' + tag));
  }
  assert.ok(html.includes('href="/styles/app.css"'));
  assert.equal(html.includes('<style>'), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('v-for='), false);
  assert.equal(html.includes('v-model='), false);
});

function button(h, text, scope) {
  const found = h.ui.all(node => {
    if (node.type !== 'button' || h.ui.text(node) !== text) return false;
    if (!scope) return true;
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (h.ui.hasClass(parent, scope)) return true;
    }
    return false;
  })[0];
  assert.ok(found, '应渲染按钮：' + text);
  return found;
}

function input(h, label) {
  const found = h.ui.all(node => node.type === 'input' && node.props['aria-label'] === label)[0];
  assert.ok(found, '应渲染输入框：' + label);
  return found;
}

function typeInto(node, value) {
  node.value = value;
  node.dispatchEvent({ type: 'input' });
}

test('真实组件挂载及四页切换，共享筛选与年视图，不重复加载账本', async () => {
  const h = await harness([makeRecord()], { render: true });
  assert.match(h.ui.text(), /家庭账本/);
  assert.equal(h.ui.all(node => h.ui.hasClass(node, 'page')).length, 1);
  button(h, '支出').click(); await h.flush();
  assert.equal(h.app.filter.value, 'expense');
  button(h, '📊统计').click(); await h.flush();
  assert.match(h.ui.text(), /每日支出趋势/);
  button(h, '年视图').click(); await h.flush();
  button(h, '‹').click(); await h.flush();
  assert.match(h.ui.text(), /2025 年各月收支对比/);
  button(h, '💰理财').click(); await h.flush();
  assert.match(h.ui.text(), /按平台汇总/);
  button(h, '⚙️设置').click(); await h.flush();
  assert.match(h.ui.text(), /家庭成员/);
  button(h, '📋明细').click(); await h.flush();
  assert.equal(h.app.filter.value, 'expense');
  button(h, '📊统计').click(); await h.flush();
  assert.equal(h.app.statView.value, 'year');
  assert.equal(h.ui.all(node => h.ui.hasClass(node, 'page')).length, 1);
  assert.equal(h.gets, 1);
  assert.equal(h.posts, 0);
  h.unmount();
});

test('抽屉组件输入双向绑定、类型切换聚焦，关闭后重新挂载引用有效', async () => {
  const h = await harness([], { render: true });
  const add = button(h, '＋'); add.focus(); add.click(); await h.flush();
  let amount = input(h, '金额（元）');
  assert.equal(h.context.document.activeElement, amount);
  typeInto(amount, '12.345元'); await h.flush();
  assert.equal(h.app.form.amount, '12.34');
  assert.equal(amount.value, '12.34');
  button(h, '收入', 'drawer').click(); await h.flush();
  assert.equal(h.app.form.type, 'income');
  assert.equal(h.context.document.activeElement, amount);
  button(h, '理财', 'drawer').click(); await h.flush();
  typeInto(input(h, '理财平台'), '组件测试平台');
  button(h, '收益').click(); await h.flush();
  assert.equal(h.app.form.action, 'profit');
  button(h, '内部转账', 'drawer').click(); await h.flush();
  assert.match(h.ui.text(), /转出人/);
  h.listeners.keydown({ key: 'Escape', preventDefault() {} }); await h.flush();
  assert.equal(h.app.drawer.value, false);
  assert.equal(h.context.document.activeElement, add);
  add.click(); await h.flush();
  assert.notEqual(input(h, '金额（元）'), amount);
  amount = input(h, '金额（元）');
  assert.equal(h.context.document.activeElement, amount);
  typeInto(amount, '8.88');
  typeInto(input(h, '记账日期'), '2026-01-02');
  button(h, '保存到数据库').click(); await h.flush();
  assert.equal(h.remote.records[0].amount, 8.88);
  assert.equal(h.app.drawer.value, false);
  assert.equal(h.ui.all(node => h.ui.hasClass(node, 'rec')).length, 1);
  h.unmount();
});

test('组件保存中禁用按钮，失败保留输入，确认弹窗删除后刷新明细', async () => {
  const h = await harness([makeRecord()], { render: true });
  button(h, '＋').click(); await h.flush();
  typeInto(input(h, '金额（元）'), '6.66');
  let release; h.gate = new Promise(resolve => { release = resolve; });
  button(h, '保存到数据库').click(); await h.flush();
  assert.equal(button(h, '正在保存…').props.disabled, true);
  assert.equal(button(h, '取消').props.disabled, true);
  release(); await h.flush();
  button(h, '＋').click(); await h.flush();
  typeInto(input(h, '金额（元）'), '7.77'); h.fail = true;
  button(h, '保存到数据库').click(); await h.flush();
  assert.equal(input(h, '金额（元）').value, '7.77');
  assert.match(h.ui.text(), /保存未确认/);
  button(h, '取消').click(); h.fail = false;
  await h.app.reloadData(); await h.flush();
  h.ui.all(node => h.ui.hasClass(node, 'rec'))[0].click(); await h.flush();
  assert.match(h.ui.text(), /删除这条记录/);
  button(h, '取消').click(); await h.flush();
  assert.equal(h.app.records.value.length, 2);
  h.ui.all(node => h.ui.hasClass(node, 'rec'))[0].click(); await h.flush();
  button(h, '删除').click(); await h.flush();
  assert.equal(h.app.records.value.length, 1);
  assert.equal(h.app.modal.value, null);
  h.unmount();
});

test('设置组件成员绑定及文件引用重建，导入确认仍通过共享事务保存', async () => {
  const h = await harness([], { render: true });
  button(h, '⚙️设置').click(); await h.flush();
  typeInto(input(h, '新增成员名字'), '新增测试成员');
  button(h, '添加').click(); await h.flush();
  assert.ok(h.remote.members.some(m => m.name === '新增测试成员'));
  assert.equal(input(h, '新增成员名字').value, '');
  let file = h.ui.all(node => node.props.type === 'file')[0];
  button(h, '从备份文件恢复').click();
  assert.equal(file.clicks, 1);
  button(h, '📋明细').click(); await h.flush();
  button(h, '⚙️设置').click(); await h.flush();
  const oldFile = file;
  file = h.ui.all(node => node.props.type === 'file')[0];
  assert.notEqual(file, oldFile);
  button(h, '从备份文件恢复').click();
  assert.equal(file.clicks, 1);
  assert.equal(oldFile.clicks, 1);
  const contents = JSON.stringify({ records: [makeRecord('restored')], members: ['导入成员'] });
  file.files = [{ size: contents.length, contents }];
  file.dispatchEvent({ type: 'change' }); await h.flush();
  assert.match(h.ui.text(), /恢复备份？/);
  assert.equal(h.app.records.value.length, 0);
  button(h, '覆盖恢复').click(); await h.flush();
  assert.equal(h.app.records.value[0].id, 'restored');
  assert.match(h.ui.text(), /导入成员/);
  button(h, '导出备份（JSON）').click();
  assert.equal(JSON.parse(await h.downloads[0].text()).records[0].id, 'restored');
  h.unmount();
});

test('明细页人名筛选：按成员过滤，切到理财时自动重置，成员被移除时同步重置', async () => {
  const h = await harness([
    makeRecord('a', { member: '测试成员' }),
    makeRecord('b', { member: '家人' }),
    makeRecord('c', { type: 'income', member: '测试成员' }),
  ], { render: true });
  assert.equal(h.app.filteredMonth.value.length, 3);
  button(h, '家人', 'chips-member').click(); await h.flush();
  assert.equal(h.app.memberFilter.value, 'jiaren');
  assert.deepEqual([...h.app.filteredMonth.value.map(r => r.id)], ['b']);
  // 切到理财时自动重置人名筛选，避免隐藏筛选导致空列表
  button(h, '理财').click(); await h.flush();
  assert.equal(h.app.memberFilter.value, 'all');
  // 选中成员后切回支持人名的类型，再移除该成员，自动回到全部
  button(h, '支出').click(); await h.flush();
  button(h, '测试成员', 'chips-member').click(); await h.flush();
  assert.equal(h.app.memberFilter.value, 'mingqi');
  h.app.members.value = [{ id: 'jiaren', name: '家人' }]; await h.flush();
  assert.equal(h.app.memberFilter.value, 'all');
  h.unmount();
});

test('统计页成员筛选：按成员汇总并隐藏理财项，成员被移除时重置', async () => {
  const h = await harness([
    makeRecord('a', { member: '测试成员', amount: 10 }),
    makeRecord('b', { member: '家人', amount: 4 }),
    makeRecord('c', { type: 'income', member: '测试成员', amount: 20 }),
    makeRecord('d', { type: 'invest', action: 'buy', platform: '某平台', amount: 100 }),
  ], { render: true });
  button(h, '📊统计').click(); await h.flush();
  // 全部成员：支出含两人，理财买入计入，理财概况卡片可见
  assert.equal(h.app.statMonthStats.value.expense, 14);
  assert.equal(h.app.statMonthStats.value.investBuy, 100);
  assert.match(h.ui.text(), /理财概况/);
  // 选中“测试成员”：仅其收支，无成员归属的理财记录被排除，理财项隐藏
  button(h, '测试成员', 'chips-member').click(); await h.flush();
  assert.equal(h.app.statMember.value, 'mingqi');
  assert.equal(h.app.statMonthStats.value.expense, 10);
  assert.equal(h.app.statMonthStats.value.income, 20);
  assert.equal(h.app.statMonthStats.value.investBuy, 0);
  assert.doesNotMatch(h.ui.text(), /理财概况/);
  // 移除该成员后统计页筛选自动回到全部
  h.app.members.value = [{ id: 'jiaren', name: '家人' }]; await h.flush();
  assert.equal(h.app.statMember.value, 'all');
  h.unmount();
});

test('改名保持成员 id，历史记录随 id 自动跟随新名字', async () => {
  const h = await harness([
    makeRecord('a', { member: '测试成员', amount: 10 }),
    makeRecord('b', { member: '家人', amount: 4 }),
  ]);
  h.app.statMember.value = 'mingqi';
  assert.equal(h.app.statMonthStats.value.expense, 10); // 改名前按 id 命中
  assert.equal(await h.app.renameMember('jiaren', '测试成员'), false); // 重名拒绝，不改数据
  assert.equal(h.app.members.value.find(m => m.id === 'mingqi').name, '测试成员');
  const ok = await h.app.renameMember('mingqi', '新名字');
  assert.equal(ok, true);
  assert.equal(h.app.members.value.find(m => m.id === 'mingqi').name, '新名字');
  assert.deepEqual(h.remote.members.map(m => m.name), ['新名字', '家人']);
  assert.equal(h.app.statMember.value, 'mingqi'); // 筛选状态不因改名丢失
  assert.equal(h.app.statMonthStats.value.expense, 10); // 旧记录仍随 id 命中
  assert.equal(h.app.memberDisplay('mingqi', ''), '新名字'); // 展示按 id 解析到新名字
});

test('初始化只读、旧缓存不自动迁移或复活已清空账本', async () => {
  const h = await harness([], { storage: {
    'family-ledger-records-v1': JSON.stringify([makeRecord('old')]),
    'family-ledger-members-v1': '["旧成员"]',
  } });
  assert.equal(h.posts, 0);
  assert.equal(h.app.records.value.length, 0);
  assert.equal(h.app.hasLegacy.value, true);
  assert.equal(h.app.ready.value, true);
});

test('年视图按年切换，月视图跨年正确', async () => {
  const { app } = await harness();
  app.tab.value = 'stats'; app.statView.value = 'year';
  app.shiftMonth(-1);
  assert.deepEqual(clone(app.cursor.value), { y: 2025, m: 0 });
  app.statView.value = 'month'; app.shiftMonth(-1);
  assert.deepEqual(clone(app.cursor.value), { y: 2024, m: 11 });
});

test('分类百分比和金额按分汇总，日收入包含理财收益', async () => {
  const { app } = await harness([
    makeRecord('a', { amount: 0.1 }), makeRecord('b', { amount: 0.2 }),
    makeRecord('c', { amount: 0.2, category: '交通' }),
    makeRecord('d', { type: 'income', amount: 1 }),
    makeRecord('e', { type: 'invest', action: 'profit', platform: '测试平台', amount: 0.1 }),
  ]);
  assert.equal(app.monthStats.value.expense, 0.5);
  assert.equal(app.monthStats.value.balance, 0.6);
  assert.equal(app.monthExpenseRank.value[0].share, 60);
  assert.equal(app.monthExpenseRank.value[1].share, 40);
  assert.equal(app.dayGroups.value[0].income, 1.1);
  assert.equal(app.dailyTrend.value[1].expense, 0.5);
  assert.equal(app.monthTrend.value[0].income, 1.1);
  assert.ok(componentSources.find(file => file.name === 'pages/stats.js').source.includes('{{ c.share }}%'));
});

test('备份结构、日期、非有限金额、重复 ID 均校验', async () => {
  const { context } = await harness();
  for (const bad of [makeRecord('x', { amount: NaN }), makeRecord('x', { amount: Infinity }),
    makeRecord('x', { amount: 1.234 }), makeRecord('x', { date: '2026-02-30' }), { id: 'broken' }]) {
    context.input = { records: [bad], members: ['甲'] };
    assert.throws(() => vm.runInContext('validateSnapshot(input)', context));
  }
  context.input = { records: [makeRecord(), makeRecord()], members: ['甲'] };
  assert.throws(() => vm.runInContext('validateSnapshot(input)', context));
  assert.equal(vm.runInContext("validDate('2024-02-29')", context), true);
});

test('保存失败不显示成功、不改动页面记录，保留表单', async () => {
  const h = await harness(); fill(h.app); h.fail = true;
  await h.app.saveRecord();
  assert.equal(h.app.records.value.length, 0);
  assert.equal(h.app.drawer.value, true);
  assert.equal(h.app.form.amount, '12.34');
  assert.equal(h.app.ready.value, false);
  assert.match(h.app.syncError.value, /保存未确认/);
});

test('重复点击仅发起一个写入，请求完成后才更新记录', async () => {
  const h = await harness(); fill(h.app);
  let release; h.gate = new Promise(resolve => { release = resolve; });
  const first = h.app.saveRecord();
  assert.equal(h.app.busy.value, true);
  assert.equal(h.app.records.value.length, 0);
  await h.app.saveRecord();
  assert.equal(h.posts, 1);
  release(); await first;
  assert.equal(h.app.records.value.length, 1);
  assert.equal(h.app.drawer.value, false);
});

test('版本冲突拒绝覆盖，重新加载能看到其他页面记录', async () => {
  const h = await harness(); fill(h.app);
  h.remote.revision = 'other-tab'; h.remote.records = [makeRecord('other')];
  await h.app.saveRecord();
  assert.equal(h.remote.records[0].id, 'other');
  assert.equal(h.app.ready.value, false);
  await h.app.reloadData();
  await h.app.saveRecord();
  assert.equal(h.remote.records.length, 2);
});

test('写入成功但响应丢失，重新加载后不会重复记账', async () => {
  const h = await harness(); fill(h.app); h.loseResponse = true;
  await h.app.saveRecord();
  assert.equal(h.remote.records.length, 1);
  assert.equal(h.app.records.value.length, 0);
  await h.app.reloadData();
  await h.app.saveRecord();
  assert.equal(h.posts, 1);
  assert.equal(h.app.records.value.length, 1);
});

test('浏览器存储配额用尽不影响数据库保存', async () => {
  const h = await harness([], { storageFull: true }); fill(h.app);
  await h.app.saveRecord();
  assert.equal(h.app.records.value.length, 1);
  assert.match(h.app.cacheWarning.value, /缓存不可用/);
});

test('错误备份不会弹覆盖确认，合法备份等待确认后恢复', async () => {
  const h = await harness([makeRecord('original')]);
  const input = contents => ({ target: { files: [{ size: contents.length, contents }], value: 'test' } });
  h.app.importJSON(input('{"records":[{"id":"broken"}]}'));
  assert.equal(h.app.modal.value, null);
  assert.equal(h.app.records.value[0].id, 'original');
  h.app.importJSON(input(JSON.stringify({ app: 'family-ledger', version: 1, records: [makeRecord('imported')], members: ['甲'] })));
  assert.equal(h.app.records.value[0].id, 'original');
  await h.app.confirmModal();
  assert.equal(h.app.records.value[0].id, 'imported');
  assert.equal(h.app.modal.value, null);
});

test('JSON 导出可直接恢复，保留全部记录和成员', async () => {
  const h = await harness([makeRecord('backup', { note: '备份测试' })]);
  h.app.exportJSON();
  const content = await h.downloads[0].text();
  const backup = JSON.parse(content);
  assert.equal(backup.app, 'family-ledger');
  assert.equal(backup.records[0].id, 'backup');
  assert.deepEqual(backup.members.map(m => m.name), ['测试成员', '家人']);
  assert.equal(content.includes('\n'), false);
  h.app.importJSON({ target: { files: [{ size: h.downloads[0].size, contents: content }], value: 'backup' } });
  await h.app.confirmModal();
  assert.equal(h.app.records.value.length, 1);
});

test('CSV 导出中和公式注入并保留引号及换行', async () => {
  const h = await harness([makeRecord('csv', { note: '=SUM(1,2)\n"测试"' })]);
  h.app.exportCSV();
  const csv = await h.downloads[0].text();
  assert.match(csv, /'=SUM/);
  assert.match(csv, /""测试""/);
});

test('一万条记录仅渲染首批，统计仍基于全量，月份切换重置分页', async () => {
  const h = await harness(Array.from({ length: 10000 }, (_, i) => makeRecord(String(i), { amount: 0.01 })));
  const start = performance.now();
  assert.equal(h.app.monthStats.value.expense, 100);
  assert.equal(h.app.yearStats.value.expense, 100);
  assert.equal(h.app.dayGroups.value.reduce((n, g) => n + g.items.length, 0), 100);
  assert.equal(h.app.dayGroups.value[0].expense, 100);
  assert.equal(h.app.monthTrend.value[0].expense, 100);
  assert.equal(h.app.dailyTrend.value[1].expense, 100);
  console.log('一万条合成记录首次统计与分组耗时：' + (performance.now() - start).toFixed(1) + ' ms');
  h.app.visibleCount.value = 200;
  assert.equal(h.app.dayGroups.value[0].items.length, 200);
  h.app.shiftMonth(1);
  await h.context.Vue.nextTick();
  assert.equal(h.app.visibleCount.value, 100);
});
