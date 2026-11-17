// 理财页：模板与组件绑定；账本数据由根应用统一管理。
const InvestPage = {
  name: 'InvestPage',
  setup() {
    return LedgerContext.use(['fmt', 'totalInvested', 'allTime', 'platformSummary', 'investRecent', 'askDelete', 'recTitle', 'amtText', 'investActionIcon', 'investActionName']);
  },
  template: `
<div class="page">
  <div class="topbar"><h1>理财</h1></div>

  <div class="summary" style="background:linear-gradient(135deg,#c47f00 0%,#f5a623 100%);box-shadow:0 4px 14px rgba(245,166,35,.3)">
    <div class="balance-label">当前在投本金</div>
    <div class="balance">¥{{ fmt(totalInvested) }}</div>
    <div class="row">
      <div class="item"><div class="k">累计买入</div><div class="v">{{ fmt(allTime.investBuy) }}</div></div>
      <div class="item"><div class="k">累计赎回</div><div class="v">{{ fmt(allTime.investRedeem) }}</div></div>
      <div class="item"><div class="k">累计收益</div><div class="v">+{{ fmt(allTime.investProfit) }}</div></div>
    </div>
    <div class="rule">买入/赎回是本金流转，不计入收支账单；收益计入账单收入</div>
  </div>

  <div class="card">
    <h3>按平台汇总</h3>
    <div class="rank-item" v-for="p in platformSummary" :key="p.name">
      <div class="face">💼</div>
      <div class="info">
        <div class="line1"><span class="name">{{ p.name }}</span><span>在投 ¥{{ fmt(p.invested) }} · 收益 +{{ fmt(p.profit) }}</span></div>
        <div class="bar-bg"><div class="bar" style="background:var(--gold)" :style="{width: p.pct+'%'}"></div></div>
      </div>
    </div>
    <div class="empty" v-if="!platformSummary.length" style="padding:20px 0">暂无理财记录<br>点下方 ＋ 记一笔理财</div>
  </div>

  <div class="card">
    <h3>理财流水（最近 20 笔）</h3>
    <div class="rec" style="box-shadow:none;border:1px solid var(--line)" v-for="r in investRecent" :key="r.id" @click="askDelete(r)" @keydown.enter="askDelete(r)" @keydown.space.prevent="askDelete(r)" tabindex="0" role="button" :aria-label="'查看删除确认：' + recTitle(r) + ' ' + amtText(r)">
      <div class="ico invest">{{ investActionIcon(r.action) }}</div>
      <div class="mid">
        <div class="cat">{{ r.platform }}<span class="tag" :class="r.action==='profit'?'gold':'purple'">{{ investActionName(r.action) }}</span></div>
        <div class="sub">{{ r.date }} {{ r.note }}</div>
      </div>
      <div class="amt" :class="r.action==='profit' ? 'in':'plain'">{{ r.action==='profit' ? '+' : '' }}¥{{ fmt(r.amount) }}</div>
    </div>
    <div class="empty" v-if="!investRecent.length" style="padding:20px 0">暂无理财记录</div>
  </div>
</div>
`,
};
