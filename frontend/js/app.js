const { createApp, ref, shallowRef, reactive, computed, watch, nextTick } = Vue;

/* ---------- 本地存储 ---------- */
const LS_RECORDS = 'family-ledger-records-v1';
const LS_MEMBERS = 'family-ledger-members-v1';

function loadLS(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch (e) { return fallback; }
}
const LS_CACHE = 'family-ledger-cache-v2';
const MAX_RECORDS = 50000;
const MAX_AMOUNT = 99999999.99;
const cents = n => Math.round(n * 100);
const addMoney = (a, b) => (cents(a) + cents(b)) / 100;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validateSnapshot(data) {
  if (!data || !Array.isArray(data.records) || data.records.length > MAX_RECORDS) throw new Error('记录格式不正确或超过 50000 条');
  if (!Array.isArray(data.members) || !data.members.length || data.members.length > 50) throw new Error('成员数量必须在 1 到 50 之间');
  const text = (v, label, max, optional = false) => {
    if (typeof v !== 'string' || [...v].length > max || (!optional && !v.trim())) throw new Error(label + '格式或长度不正确');
    return v;
  };
  const members = data.members.map(m => text(m, '成员', 32));
  if (new Set(members).size !== members.length) throw new Error('成员名字不能重复');
  const ids = new Set();
  const records = data.records.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('第 ' + (i + 1) + ' 条记录格式不正确');
    const id = text(r.id, '记录 ID', 128);
    if (ids.has(id)) throw new Error('记录 ID 重复');
    ids.add(id);
    if (!['income', 'expense', 'invest', 'transfer'].includes(r.type) || !validDate(r.date)) throw new Error('第 ' + (i + 1) + ' 条记录类型或日期不正确');
    if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0 || r.amount > MAX_AMOUNT || cents(r.amount) / 100 !== r.amount) throw new Error('金额须大于 0、不超过 ' + MAX_AMOUNT + ' 且最多两位小数');
    const createdAt = r.createdAt ?? 0;
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('记录创建时间不正确');
    const item = { id, type: r.type, date: r.date, amount: cents(r.amount) / 100, createdAt, note: text(r.note ?? '', '备注', 500, true) };
    if (r.type === 'income' || r.type === 'expense') {
      item.category = text(r.category, '分类', 64);
      item.member = text(r.member ?? '', '成员', 32, true);
    } else if (r.type === 'invest') {
      if (!['buy', 'redeem', 'profit'].includes(r.action)) throw new Error('理财操作不正确');
      item.action = r.action;
      item.platform = text(r.platform, '平台', 64);
    } else {
      item.from = text(r.from, '转出人', 32);
      item.to = text(r.to, '转入人', 32);
      if (item.from === item.to) throw new Error('转出人和转入人不能相同');
    }
    return item;
  });
  return { records, members };
}

/* ---------- 分类定义 ---------- */
const EXPENSE_CATS = [
  { name: '餐饮', emoji: '🍜' }, { name: '交通', emoji: '🚗' }, { name: '购物', emoji: '🛒' },
  { name: '居住', emoji: '🏠' }, { name: '水电', emoji: '💡' }, { name: '通讯', emoji: '📱' },
  { name: '娱乐', emoji: '🎮' }, { name: '医疗', emoji: '💊' }, { name: '教育', emoji: '📚' },
  { name: '人情', emoji: '🎁' }, { name: '宠物', emoji: '🐱' }, { name: '娃', emoji: '🍼' },
  { name: '旅行', emoji: '✈️' }, { name: '其他', emoji: '📦' },
];
const INCOME_CATS = [
  { name: '工资', emoji: '💰' }, { name: '奖金', emoji: '🏆' }, { name: '兼职', emoji: '💼' },
  { name: '红包', emoji: '🧧' }, { name: '退款', emoji: '↩️' }, { name: '报销', emoji: '🧾' },
  { name: '其他', emoji: '💵' },
];
const CAT_EMOJI_MAP = {};
EXPENSE_CATS.forEach(c => CAT_EMOJI_MAP['e:' + c.name] = c.emoji);
INCOME_CATS.forEach(c => CAT_EMOJI_MAP['i:' + c.name] = c.emoji);

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

createApp({
  components: { DetailPage, StatsPage, InvestPage, SettingsPage, TabBar, RecordDrawer, ConfirmDialog },
  setup() {
    /* ========== 状态 ========== */
    const records = shallowRef([]);
    const members = shallowRef(['明奇', '家人']);
    const ready = ref(false);
    const busy = ref(false);
    const syncError = ref('');
    const cacheWarning = ref('');
    const hasLegacy = ref(loadLS(LS_RECORDS, null) !== null);
    const syncLabel = computed(() => busy.value ? '正在保存，请勿关闭页面…' : ready.value ? '已连接本机数据库' : '账本只读');
    const visibleCount = ref(100);
    const tab = ref('detail');
    const drawer = ref(false);
    const toast = ref('');
    const modal = ref(null);

    // 当前选中月份（明细页与月统计共用游标）
    const now = new Date();
    const cursor = ref({ y: now.getFullYear(), m: now.getMonth() }); // m: 0-11
    const filter = ref('all');
    const statView = ref('month');
    const newMember = ref('');

    let draftId = '';
    const form = reactive({
      type: 'expense', amount: '', category: '餐饮', member: '',
      action: 'buy', platform: '', from: '', to: '',
      date: todayStr(), note: '',
    });

    /* ---------- 仅在服务确认写入后更新界面，缓存不自动覆盖数据库 ---------- */
    let revision = null;
    let token = null;
    let loading = false;
    try {
      const cached = loadLS(LS_CACHE, null);
      if (cached) {
        const data = validateSnapshot(cached);
        records.value = data.records;
        members.value = data.members;
      }
    } catch (e) { cacheWarning.value = '浏览器缓存无效，已忽略；可继续读取数据库。'; }

    async function api(path, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(path, { ...options, cache: 'no-store', signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '服务返回错误 ' + res.status);
        return data;
      } finally { clearTimeout(timer); }
    }
    function mirror() {
      try {
        localStorage.setItem(LS_CACHE, JSON.stringify({ records: records.value, members: members.value }));
        cacheWarning.value = '';
      } catch (e) { cacheWarning.value = '浏览器缓存不可用，数据库不受影响，请定期导出备份。'; }
    }
    async function reloadData() {
      if (busy.value || loading) return;
      loading = true;
      ready.value = false;
      syncError.value = '正在连接本机服务…';
      try {
        const data = await api('/api/data');
        const valid = validateSnapshot(data);
        if (typeof data.revision !== 'string' || typeof data.token !== 'string') throw new Error('请停止旧版服务，重新运行启动脚本');
        records.value = valid.records;
        members.value = valid.members;
        revision = data.revision;
        token = data.token;
        ready.value = true;
        syncError.value = '';
        mirror();
      } catch (e) {
        syncError.value = '无法读取账本：' + e.message + '。请启动服务后重新加载；当前缓存仅供查看。';
      } finally { loading = false; }
    }
    function canWrite() {
      if (!ready.value || busy.value) {
        showToast(busy.value ? '正在保存，请稍候' : '请先连接服务并重新加载账本');
        return false;
      }
      return true;
    }
    async function commitData(nextRecords, nextMembers = members.value) {
      if (!canWrite()) return false;
      let valid, body;
      try {
        valid = validateSnapshot({ records: nextRecords, members: nextMembers });
        body = JSON.stringify({ ...valid, revision });
        if (new Blob([body]).size > 32 * 1024 * 1024 - 1024) throw new Error('账本接近 32 MiB 上限，请减少记录或备注长度');
      } catch (e) { showToast(e.message); return false; }
      busy.value = true;
      try {
        const result = await api('/api/replace', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ledger-Token': token }, body,
        });
        if (!result.ok || typeof result.revision !== 'string') throw new Error('服务响应无效');
        revision = result.revision;
        records.value = valid.records;
        members.value = valid.members;
        syncError.value = '';
        mirror();
        return true;
      } catch (e) {
        ready.value = false;
        syncError.value = '保存未确认：' + e.message + '。请重新加载核对后再操作，避免重复记账。';
        showToast('保存未确认，请查看顶部提示');
        return false;
      } finally { busy.value = false; }
    }
    reloadData();
    window.addEventListener('beforeunload', event => {
      if (busy.value) { event.preventDefault(); event.returnValue = ''; }
    });
    watch(members, v => {
      if (!v.includes(form.member)) form.member = v[0] || '';
      if (!v.includes(form.from)) form.from = v[0] || '';
      if (!v.includes(form.to)) form.to = v[1] || v[0] || '';
    });
    watch([cursor, filter], () => { visibleCount.value = 100; });

    /* ========== 工具 ========== */
    const fmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    const pad = n => String(n).padStart(2, '0');
    const today = ref(todayStr());
    const monthKey = r => r.date.slice(0, 7);           // YYYY-MM
    const yearKey = r => r.date.slice(0, 4);            // YYYY
    const curMonthStr = computed(() => cursor.value.y + '-' + pad(cursor.value.m + 1));
    const monthLabel = computed(() => cursor.value.y + '年' + (cursor.value.m + 1) + '月');
    const statLabel = computed(() => statView.value === 'month' ? monthLabel.value : (cursor.value.y + '年'));
    const statYear = computed(() => cursor.value.y);

    function shiftMonth(dir) {
      let { y, m } = cursor.value;
      if (tab.value === 'stats' && statView.value === 'year') y += dir;
      else {
        m += dir;
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      }
      if (y >= 1000 && y <= 9999) cursor.value = { y, m };
    }
    function showToast(msg) {
      toast.value = msg;
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => toast.value = '', 1800);
    }
    function dayTitle(date) {
      if (date === todayStr()) return '今天';
      const yest = new Date(); yest.setDate(yest.getDate() - 1);
      const ys = yest.getFullYear() + '-' + pad(yest.getMonth() + 1) + '-' + pad(yest.getDate());
      if (date === ys) return '昨天';
      const [y, m, d] = date.split('-');
      return y + '年' + parseInt(m, 10) + '月' + parseInt(d, 10) + '日';
    }
    const dayNum = d => Number(d) === 1 || Number(d) % 5 === 0 ? Number(d) : '';

    /* ========== 统计核心 ========== */
    // 以整数分汇总，内部转账不计入收支
    function statsOf(list) {
      const s = { income: 0, expense: 0, investBuy: 0, investRedeem: 0, investProfit: 0 };
      list.forEach(r => {
        if (r.type === 'income') s.income += cents(r.amount);
        else if (r.type === 'expense') s.expense += cents(r.amount);
        else if (r.type === 'invest') {
          if (r.action === 'buy') s.investBuy += cents(r.amount);
          else if (r.action === 'redeem') s.investRedeem += cents(r.amount);
          else if (r.action === 'profit') s.investProfit += cents(r.amount);
        }
        // transfer 不计入任何统计
      });
      s.balance = s.income + s.investProfit - s.expense;
      Object.keys(s).forEach(key => { s[key] /= 100; });
      return s;
    }
    const recordIndex = computed(() => {
      const months = new Map(), years = new Map(), investments = [];
      const sorted = [...records.value].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      for (const record of sorted) {
        const month = monthKey(record), year = yearKey(record);
        if (!months.has(month)) months.set(month, []);
        if (!years.has(year)) years.set(year, []);
        months.get(month).push(record);
        years.get(year).push(record);
        if (record.type === 'invest') investments.push(record);
      }
      return { months, years, investments };
    });
    const monthRecords = computed(() => recordIndex.value.months.get(curMonthStr.value) || []);
    const yearRecords = computed(() => recordIndex.value.years.get(String(cursor.value.y)) || []);
    const monthStats = computed(() => statsOf(monthRecords.value));
    const yearStats = computed(() => statsOf(yearRecords.value));

    // 全部历史
    const allTime = computed(() => statsOf(records.value));
    const totalInvested = computed(() => addMoney(allTime.value.investBuy, -allTime.value.investRedeem));

    /* ========== 明细页 ========== */
    const typeFilters = [
      { key: 'all', name: '全部' }, { key: 'expense', name: '支出' }, { key: 'income', name: '收入' },
      { key: 'invest', name: '理财' }, { key: 'transfer', name: '内部转账' },
    ];
    const filteredMonth = computed(() => {
      let list = monthRecords.value;
      if (filter.value !== 'all') list = list.filter(r => r.type === filter.value);
      return list;
    });
    const dayGroups = computed(() => {
      const map = new Map();
      filteredMonth.value.forEach(r => {
        if (!map.has(r.date)) map.set(r.date, { date: r.date, items: [], expense: 0, income: 0 });
        const g = map.get(r.date);
        g.items.push(r);
        if (r.type === 'expense') g.expense = addMoney(g.expense, r.amount);
        if (r.type === 'income' || (r.type === 'invest' && r.action === 'profit')) g.income = addMoney(g.income, r.amount);
      });
      const groups = [];
      let remaining = visibleCount.value;
      for (const group of map.values()) {
        if (remaining <= 0) break;
        groups.push({ ...group, items: group.items.slice(0, remaining) });
        remaining -= group.items.length;
      }
      return groups;
    });

    const INVEST_ACTIONS = { buy: { name: '买入', icon: '📥' }, redeem: { name: '赎回', icon: '📤' }, profit: { name: '收益', icon: '📈' } };
    const investActionName = a => (INVEST_ACTIONS[a] || {}).name || a;
    const investActionIcon = a => (INVEST_ACTIONS[a] || {}).icon || '💼';

    function recIcon(r) {
      if (r.type === 'invest') return investActionIcon(r.action);
      if (r.type === 'transfer') return '🔁';
      return catEmoji(r.category, r.type);
    }
    function recTitle(r) {
      if (r.type === 'expense' || r.type === 'income') return r.category;
      if (r.type === 'invest') return r.platform || '理财';
      if (r.type === 'transfer') return r.from + ' → ' + r.to;
      return '';
    }
    function recSub(r) {
      const parts = [];
      if (r.type === 'expense' || r.type === 'income') { if (r.member) parts.push(r.member); }
      if (r.type === 'invest') parts.push(investActionName(r.action));
      if (r.note) parts.push(r.note);
      return parts.join(' · ') || '—';
    }
    function amtClass(r) {
      if (r.type === 'expense') return 'out';
      if (r.type === 'income') return 'in';
      if (r.type === 'invest' && r.action === 'profit') return 'in';
      return 'plain';
    }
    function amtText(r) {
      if (r.type === 'expense') return '-' + fmt(r.amount);
      if (r.type === 'income') return '+' + fmt(r.amount);
      if (r.type === 'invest' && r.action === 'profit') return '+' + fmt(r.amount);
      return fmt(r.amount);
    }
    function catEmoji(name, type) {
      return CAT_EMOJI_MAP[(type === 'expense' ? 'e:' : 'i:') + name] || (type === 'income' ? '💵' : '📦');
    }

    /* ========== 统计页 ========== */
    function rankOf(list, type) {
      const map = new Map();
      list.filter(r => r.type === type).forEach(r => {
        const key = r.category || '其他';
        map.set(key, addMoney(map.get(key) || 0, r.amount));
      });
      const arr = [...map.entries()].map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total);
      const max = arr.length ? arr[0].total : 1;
      const sum = arr.reduce((t, c) => addMoney(t, c.total), 0) || 1;
      arr.forEach(c => { c.pct = Math.max(4, Math.round(c.total / max * 100)); c.share = Math.round(c.total / sum * 100); });
      return arr;
    }
    const monthExpenseRank = computed(() => rankOf(monthRecords.value, 'expense'));
    const monthIncomeRank = computed(() => rankOf(monthRecords.value, 'income'));
    const yearExpenseRank = computed(() => rankOf(yearRecords.value, 'expense'));

    const dailyTrend = computed(() => {
      const days = new Date(cursor.value.y, cursor.value.m + 1, 0).getDate();
      const arr = Array.from({ length: days }, (_, i) => ({ day: String(i + 1), expense: 0 }));
      for (const r of monthRecords.value) {
        if (r.type === 'expense') {
          const day = arr[Number(r.date.slice(8)) - 1];
          day.expense = addMoney(day.expense, r.amount);
        }
      }
      return arr;
    });
    const trendMax = computed(() => Math.max(1, ...dailyTrend.value.map(d => d.expense)));
    const trendH = v => Math.max(2, Math.round(v / trendMax.value * 88));

    const monthTrend = computed(() => {
      const arr = [];
      for (let m = 1; m <= 12; m++) {
        const key = cursor.value.y + '-' + pad(m);
        const s = statsOf(recordIndex.value.months.get(key) || []);
        arr.push({ m, income: addMoney(s.income, s.investProfit), expense: s.expense });
      }
      return arr;
    });
    const yearTrendMax = computed(() => Math.max(1, ...monthTrend.value.flatMap(m => [m.income, m.expense])));
    const yBarH = v => Math.max(2, Math.round(v / yearTrendMax.value * 120));

    /* ========== 理财页 ========== */
    const investRecent = computed(() => recordIndex.value.investments.slice(0, 20));
    const platformSummary = computed(() => {
      const map = new Map();
      recordIndex.value.investments.forEach(r => {
        const p = r.platform || '未指定';
        if (!map.has(p)) map.set(p, { name: p, invested: 0, profit: 0 });
        const o = map.get(p);
        if (r.action === 'buy') o.invested = addMoney(o.invested, r.amount);
        else if (r.action === 'redeem') o.invested = addMoney(o.invested, -r.amount);
        else if (r.action === 'profit') o.profit = addMoney(o.profit, r.amount);
      });
      const arr = [...map.values()].filter(o => Math.abs(o.invested) > 0.001 || o.profit > 0)
        .sort((a, b) => b.invested - a.invested);
      const max = arr.reduce((value, o) => Math.max(value, o.invested), 1);
      arr.forEach(o => o.pct = Math.max(4, Math.round(Math.max(o.invested, 0) / max * 100)));
      return arr;
    });

    /* ========== 记账抽屉 ========== */
    function openDrawer() {
      if (!canWrite()) return;
      today.value = todayStr();
      draftId = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2);
      form.type = tab.value === 'invest' ? 'invest' : 'expense';
      form.amount = '';
      form.category = '餐饮';
      form.action = 'buy';
      form.platform = '';
      form.from = members.value[0] || '';
      form.to = members.value[1] || members.value[0] || '';
      form.member = members.value[0] || '';
      form.date = todayStr();
      form.note = '';
      drawer.value = true;
    }
    function switchType(t) {
      form.type = t;
      if (t === 'expense' || t === 'income') {
        form.category = t === 'expense' ? '餐饮' : '工资';
        form.member = members.value.includes(form.member) ? form.member : (members.value[0] || '');
      }
    }
    function cleanAmount() {
      let v = form.amount.replace(/[^\d.]/g, '');
      const i = v.indexOf('.');
      if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2);
      form.amount = v;
    }
    async function saveRecord() {
      if (!canWrite()) return;
      if (records.value.some(r => r.id === draftId)) {
        showToast('该笔记录已写入，请在明细中核对');
        drawer.value = false;
        return;
      }
      const amount = Number(form.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) { showToast('请输入大于 0 且不超过 ' + MAX_AMOUNT + ' 的金额'); return; }
      if (!validDate(form.date) || form.date > todayStr()) { showToast('请选择有效日期，不能晚于今天'); return; }
      const rec = {
        id: draftId,
        type: form.type, amount: Math.round(amount * 100) / 100,
        date: form.date, note: form.note.trim(),
        createdAt: Date.now(),
      };
      if (form.type === 'expense' || form.type === 'income') {
        rec.category = form.category;
        rec.member = form.member || members.value[0] || '';
      } else if (form.type === 'invest') {
        rec.action = form.action;
        rec.platform = form.platform.trim() || '未指定';
      } else if (form.type === 'transfer') {
        if (!form.from || !form.to) { showToast('请选择转出人和转入人'); return; }
        if (form.from === form.to) { showToast('转出人和转入人不能相同'); return; }
        rec.from = form.from; rec.to = form.to;
      }
      if (await commitData([...records.value, rec])) {
        drawer.value = false;
        cursor.value = { y: Number(rec.date.slice(0, 4)), m: Number(rec.date.slice(5, 7)) - 1 };
        filter.value = 'all';
        showToast('已保存到数据库 ¥' + fmt(rec.amount));
      }
    }

    /* ========== 删除 ========== */
    function askDelete(r) {
      if (!canWrite()) return;
      modal.value = {
        title: '删除这条记录？',
        desc: recTitle(r) + '  ' + amtText(r) + '\n' + r.date + (r.note ? ' · ' + r.note : ''),
        okText: '删除',
        async onOk() {
          const saved = await commitData(records.value.filter(x => x.id !== r.id));
          if (saved) showToast('已删除');
          return saved;
        },
      };
    }
    function confirmClear() {
      if (!canWrite()) return;
      modal.value = {
        title: '清空全部数据？',
        desc: '将删除全部 ' + records.value.length + ' 条记账记录，且无法恢复。建议先导出备份。',
        okText: '全部清空',
        async onOk() {
          const saved = await commitData([]);
          if (saved) showToast('已清空');
          return saved;
        },
      };
    }

    /* ========== 成员管理 ========== */
    async function addMember() {
      if (!canWrite()) return;
      const n = newMember.value.trim();
      if (!n) return;
      if (members.value.includes(n)) { showToast('该成员已存在'); return; }
      if (await commitData(records.value, [...members.value, n])) {
        newMember.value = '';
        showToast('已添加「' + n + '」');
      }
    }
    function removeMember(m) {
      if (!canWrite() || members.value.length <= 1) return;
      const used = records.value.some(r => r.member === m || r.from === m || r.to === m);
      modal.value = {
        title: '删除成员「' + m + '」？',
        desc: used ? '该成员已有历史记录，删除后旧记录中的名字会保留显示。' : '该成员暂无记录。',
        okText: '删除',
        async onOk() {
          const saved = await commitData(records.value, members.value.filter(x => x !== m));
          if (saved) showToast('已删除');
          return saved;
        },
      };
    }

    /* ========== 备份导入导出 ========== */
    function download(name, content, mime) {
      const blob = new Blob([content], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function exportJSON() {
      const data = JSON.stringify({ app: 'family-ledger', version: 1, exportedAt: todayStr(), members: members.value, records: records.value });
      download('家庭记账备份_' + todayStr() + '.json', data, 'application/json');
      showToast('备份已导出');
    }
    function exportLegacy() {
      const data = { app: 'family-ledger', version: 1, records: loadLS(LS_RECORDS, []), members: loadLS(LS_MEMBERS, ['明奇', '家人']) };
      download('旧版浏览器备份_' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
      showToast('已导出旧版缓存，请核对后再决定是否恢复');
    }
    function exportCSV() {
      const typeNames = { expense: '支出', income: '收入', invest: '理财', transfer: '内部转账' };
      const rows = [['日期', '类型', '分类/平台', '成员/方向', '金额', '备注']];
      [...records.value].sort((a, b) => a.date > b.date ? 1 : -1).forEach(r => {
        rows.push([
          r.date, typeNames[r.type],
          r.type === 'invest' ? (r.platform + '/' + investActionName(r.action)) : (r.category || ''),
          r.type === 'transfer' ? (r.from + '→' + r.to) : (r.member || ''),
          r.amount, r.note || '',
        ]);
      });
      const csv = '\uFEFF' + rows.map(row => row.map(c => {
        let value = String(c);
        if (/^\s*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
        return '"' + value.replace(/"/g, '""') + '"';
      }).join(',')).join('\r\n');
      download('家庭记账流水_' + todayStr() + '.csv', csv, 'text/csv');
      showToast('CSV 已导出');
    }
    function importJSON(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      if (file.size > 32 * 1024 * 1024) { showToast('备份文件不能超过 32 MiB'); ev.target.value = ''; return; }
      const reader = new FileReader();
      reader.onerror = () => { showToast('读取备份文件失败'); ev.target.value = ''; };
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (parsed.app !== undefined && parsed.app !== 'family-ledger') throw new Error('不是家庭记账备份');
          if (parsed.version !== undefined && parsed.version !== 1) throw new Error('不支持此备份版本');
          const data = validateSnapshot({ ...parsed, members: parsed.members ?? members.value });
          modal.value = {
            title: '恢复备份？',
            desc: '备份中有 ' + data.records.length + ' 条记录，将覆盖当前 ' + records.value.length + ' 条记录。',
            okText: '覆盖恢复',
            async onOk() {
              const saved = await commitData(data.records, data.members);
              if (saved) showToast('备份已恢复到数据库');
              return saved;
            },
          };
        } catch (e) { showToast('备份无效：' + e.message); }
        ev.target.value = '';
      };
      reader.readAsText(file);
    }

    /* ========== 确认框与键盘交互 ========== */
    async function confirmModal() {
      if (busy.value || !modal.value) return;
      const current = modal.value;
      const saved = await current.onOk();
      if (saved !== false && modal.value === current) modal.value = null;
    }
    function closeOverlay() {
      if (busy.value) return;
      if (modal.value) modal.value = null;
      else drawer.value = false;
    }
    let previousFocus = null;
    watch(() => drawer.value || !!modal.value, async opened => {
      document.body.style.overflow = opened ? 'hidden' : '';
      if (opened) {
        previousFocus = document.activeElement;
        await nextTick();
        document.querySelector('.modal .cancel, .drawer input')?.focus();
      } else previousFocus?.focus();
    });
    window.addEventListener('keydown', event => {
      if (!drawer.value && !modal.value) return;
      if (event.key === 'Escape') { event.preventDefault(); closeOverlay(); }
      if (event.key !== 'Tab') return;
      const panel = document.querySelector(modal.value ? '.modal' : '.drawer');
      if (!panel) return; // v-if 组件尚未完成本帧渲染时跳过陷阱逻辑
      const items = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });

    const state = {
      tab, drawer, toast, modal, form,
      records, members, newMember,
      ready, busy, syncLabel, syncError, cacheWarning, hasLegacy, reloadData, exportLegacy,
      visibleCount, filteredMonth, confirmModal, closeOverlay,
      cursor, filter, statView,
      monthLabel, statLabel, statYear, today,
      monthStats, yearStats, allTime, totalInvested,
      typeFilters, dayGroups, dayTitle, dayNum,
      recIcon, recTitle, recSub, amtClass, amtText, catEmoji,
      investActionName, investActionIcon,
      monthExpenseRank, monthIncomeRank, yearExpenseRank,
      dailyTrend, trendH, monthTrend, yBarH,
      investRecent, platformSummary,
      shiftMonth, openDrawer, switchType, cleanAmount, saveRecord,
      askDelete, confirmClear, addMember, removeMember,
      exportJSON, exportCSV, importJSON, canWrite,
      expenseCats: EXPENSE_CATS, incomeCats: INCOME_CATS,
      fmt,
    };
    Vue.provide(LedgerContext.key, state);
    return state;
  },
}).mount('#app');
