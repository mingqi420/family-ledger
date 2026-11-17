// 统计页：模板与组件绑定；账本数据由根应用统一管理。
const StatsPage = {
  name: 'StatsPage',
  setup() {
    return LedgerContext.use(['shiftMonth', 'statLabel', 'statView', 'fmt', 'monthStats', 'dailyTrend', 'trendH', 'dayNum', 'monthExpenseRank', 'catEmoji', 'monthIncomeRank', 'monthLabel', 'totalInvested', 'yearStats', 'statYear', 'monthTrend', 'yBarH', 'yearExpenseRank']);
  },
  template: `
<div class="page">
  <div class="topbar">
    <h1>统计</h1>
    <div class="month-nav">
      <button @click="shiftMonth(-1)" aria-label="上一个月份或年份">‹</button>
      <span class="label">{{ statLabel }}</span>
      <button @click="shiftMonth(1)" aria-label="下一个月份或年份">›</button>
    </div>
  </div>

  <div class="view-switch">
    <button :class="{on: statView==='month'}" @click="statView='month'">月视图</button>
    <button :class="{on: statView==='year'}" @click="statView='year'">年视图</button>
  </div>

  <template v-if="statView==='month'">
    <div class="stat-grid">
      <div class="cell"><div class="k">收入</div><div class="v" style="color:var(--in)">+{{ fmt(monthStats.income) }}</div></div>
      <div class="cell"><div class="k">支出</div><div class="v" style="color:var(--out)">-{{ fmt(monthStats.expense) }}</div></div>
      <div class="cell"><div class="k">结余</div><div class="v">¥{{ fmt(monthStats.balance) }}</div></div>
      <div class="cell"><div class="k">理财收益</div><div class="v" style="color:var(--gold)">+{{ fmt(monthStats.investProfit) }}</div></div>
    </div>

    <div class="card">
      <h3>每日支出趋势</h3>
      <div class="trend" v-if="dailyTrend.length">
        <div class="col" v-for="d in dailyTrend" :key="d.day">
          <span class="num" v-if="d.expense>0">{{ d.expense>=1000 ? (d.expense/1000).toFixed(1)+'k' : Math.round(d.expense) }}</span>
          <div class="stick" :style="{height: trendH(d.expense)+'px'}" :title="d.day+'日 支出 ¥'+fmt(d.expense)"></div>
        </div>
      </div>
      <div class="trend-x"><span v-for="d in dailyTrend" :key="'x'+d.day">{{ dayNum(d.day) }}</span></div>
      <div class="legend"><span><i style="background:var(--out)"></i>当日支出</span></div>
    </div>

    <div class="card">
      <h3>支出分类排行</h3>
      <div class="rank-item" v-for="c in monthExpenseRank" :key="c.name">
        <div class="face">{{ catEmoji(c.name, 'expense') }}</div>
        <div class="info">
          <div class="line1"><span class="name">{{ c.name }}</span><span>¥{{ fmt(c.total) }} · {{ c.share }}%</span></div>
          <div class="bar-bg"><div class="bar" style="background:var(--out)" :style="{width: c.pct+'%'}"></div></div>
        </div>
      </div>
      <div class="empty" v-if="!monthExpenseRank.length" style="padding:20px 0">本月暂无支出</div>
    </div>

    <div class="card">
      <h3>收入分类排行</h3>
      <div class="rank-item" v-for="c in monthIncomeRank" :key="c.name">
        <div class="face">{{ catEmoji(c.name, 'income') }}</div>
        <div class="info">
          <div class="line1"><span class="name">{{ c.name }}</span><span>¥{{ fmt(c.total) }} · {{ c.share }}%</span></div>
          <div class="bar-bg"><div class="bar" style="background:var(--in)" :style="{width: c.pct+'%'}"></div></div>
        </div>
      </div>
      <div class="empty" v-if="!monthIncomeRank.length" style="padding:20px 0">本月暂无收入</div>
    </div>

    <div class="card">
      <h3>理财概况（{{ monthLabel }}）</h3>
      <div class="stat-grid" style="margin-bottom:6px">
        <div class="cell"><div class="k">本月买入</div><div class="v">¥{{ fmt(monthStats.investBuy) }}</div></div>
        <div class="cell"><div class="k">本月赎回</div><div class="v">¥{{ fmt(monthStats.investRedeem) }}</div></div>
        <div class="cell"><div class="k">本月收益</div><div class="v" style="color:var(--gold)">+{{ fmt(monthStats.investProfit) }}</div></div>
      </div>
      <div class="tip-box">当前在投本金合计：¥{{ fmt(totalInvested) }}（累计买入 − 累计赎回，含全部历史）</div>
    </div>
  </template>

  <template v-else>
    <div class="stat-grid">
      <div class="cell"><div class="k">年收入</div><div class="v" style="color:var(--in)">+{{ fmt(yearStats.income) }}</div></div>
      <div class="cell"><div class="k">年支出</div><div class="v" style="color:var(--out)">-{{ fmt(yearStats.expense) }}</div></div>
      <div class="cell"><div class="k">年结余</div><div class="v">¥{{ fmt(yearStats.balance) }}</div></div>
      <div class="cell"><div class="k">理财收益</div><div class="v" style="color:var(--gold)">+{{ fmt(yearStats.investProfit) }}</div></div>
    </div>

    <div class="card">
      <h3>{{ statYear }} 年各月收支对比</h3>
      <div class="year-trend" v-if="monthTrend.length">
        <div class="col" v-for="m in monthTrend" :key="m.m">
          <div class="bar" style="background:var(--in)" :style="{height: yBarH(m.income)+'px'}" :title="m.m+'月 收入 ¥'+fmt(m.income)"></div>
          <div class="bar" style="background:var(--out)" :style="{height: yBarH(m.expense)+'px'}" :title="m.m+'月 支出 ¥'+fmt(m.expense)"></div>
        </div>
      </div>
      <div class="trend-x"><span v-for="i in 12" :key="i">{{ i }}</span></div>
      <div class="legend"><span><i style="background:var(--in)"></i>收入</span><span><i style="background:var(--out)"></i>支出</span></div>
    </div>

    <div class="card">
      <h3>年度支出分类排行</h3>
      <div class="rank-item" v-for="c in yearExpenseRank" :key="c.name">
        <div class="face">{{ catEmoji(c.name, 'expense') }}</div>
        <div class="info">
          <div class="line1"><span class="name">{{ c.name }}</span><span>¥{{ fmt(c.total) }} · {{ c.share }}%</span></div>
          <div class="bar-bg"><div class="bar" style="background:var(--out)" :style="{width: c.pct+'%'}"></div></div>
        </div>
      </div>
      <div class="empty" v-if="!yearExpenseRank.length" style="padding:20px 0">今年暂无支出</div>
    </div>

    <div class="card">
      <h3>年度理财概况</h3>
      <div class="tip-box">
        全年买入 ¥{{ fmt(yearStats.investBuy) }} ｜ 赎回 ¥{{ fmt(yearStats.investRedeem) }} ｜ 收益 <b style="color:var(--gold)">+¥{{ fmt(yearStats.investProfit) }}</b><br>
        当前在投本金合计：¥{{ fmt(totalInvested) }}
      </div>
    </div>
  </template>
</div>
`,
};
