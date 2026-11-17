// 明细页：模板与组件绑定；账本数据由根应用统一管理。
const DetailPage = {
  name: 'DetailPage',
  setup() {
    return LedgerContext.use(['monthLabel', 'monthStats', 'fmt', 'shiftMonth', 'typeFilters', 'filter', 'filteredMonth', 'dayGroups', 'dayTitle', 'askDelete', 'recTitle', 'amtText', 'recIcon', 'investActionName', 'recSub', 'amtClass', 'visibleCount']);
  },
  template: `
<div class="page">
  <div class="topbar">
    <h1>家庭账本</h1>
    <div class="month-nav">
      <button @click="shiftMonth(-1)" aria-label="上一个月份或年份">‹</button>
      <span class="label">{{ monthLabel }}</span>
      <button @click="shiftMonth(1)" aria-label="下一个月份或年份">›</button>
    </div>
  </div>

  <div class="summary">
    <div class="balance-label">{{ monthLabel }}结余</div>
    <div class="balance">¥{{ fmt(monthStats.balance) }}</div>
    <div class="row">
      <div class="item"><div class="k">收入</div><div class="v">+{{ fmt(monthStats.income) }}</div></div>
      <div class="item"><div class="k">支出</div><div class="v">-{{ fmt(monthStats.expense) }}</div></div>
      <div class="item"><div class="k">理财收益</div><div class="v">+{{ fmt(monthStats.investProfit) }}</div></div>
    </div>
    <div class="rule">结余 = 收入 + 理财收益 − 支出 ｜ 理财本金流转与内部转账不计入账单</div>
  </div>

  <div class="chips">
    <button v-for="f in typeFilters" :key="f.key" class="chip" :class="{on: filter===f.key}" @click="filter=f.key">{{ f.name }}</button>
  </div>

  <div class="list-hint" v-if="filteredMonth.length">共 {{ filteredMonth.length }} 笔 · 点击记录可删除 · 每日汇总包含当天全部筛选结果，收入含理财收益</div>
  <template v-if="dayGroups.length">
    <div v-for="g in dayGroups" :key="g.date">
      <div class="day-head">
        <span>{{ dayTitle(g.date) }}</span>
        <span>支 {{ fmt(g.expense) }} ｜ 收 {{ fmt(g.income) }}</span>
      </div>
      <div class="rec" v-for="r in g.items" :key="r.id" @click="askDelete(r)" @keydown.enter="askDelete(r)" @keydown.space.prevent="askDelete(r)" tabindex="0" role="button" :aria-label="'查看删除确认：' + recTitle(r) + ' ' + amtText(r)">
        <div class="ico" :class="r.type">{{ recIcon(r) }}</div>
        <div class="mid">
          <div class="cat">{{ recTitle(r) }}<span v-if="r.type==='invest'" class="tag" :class="r.action==='profit' ? 'gold':'purple'">{{ investActionName(r.action) }}</span><span v-if="r.type==='transfer'" class="tag purple">内部</span></div>
          <div class="sub">{{ recSub(r) }}</div>
        </div>
        <div class="amt" :class="amtClass(r)">{{ amtText(r) }}</div>
      </div>
    </div>
  </template>
  <div class="empty" v-else>{{ filter==='all' ? '本月暂无记录' : '本月暂无此类型记录' }}<br>点下方 ＋ 开始记一笔</div>
  <button class="btn ghost" v-if="visibleCount < filteredMonth.length" @click="visibleCount += 100">加载更多（已显示 {{ visibleCount }} / {{ filteredMonth.length }} 笔）</button>
</div>
`,
};
