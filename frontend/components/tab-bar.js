// 底部导航：模板与组件绑定；账本数据由根应用统一管理。
const TabBar = {
  name: 'TabBar',
  setup() {
    return LedgerContext.use(['tab', 'openDrawer', 'busy', 'ready']);
  },
  template: `
<div class="tabbar">
  <button class="tab" :class="{on: tab==='detail'}" @click="tab='detail'"><span class="ic">📋</span>明细</button>
  <button class="tab" :class="{on: tab==='stats'}" @click="tab='stats'"><span class="ic">📊</span>统计</button>
  <div class="add-wrap"><button class="add" @click="openDrawer" :disabled="busy || !ready" aria-label="记一笔">＋</button></div>
  <button class="tab" :class="{on: tab==='invest'}" @click="tab='invest'"><span class="ic">💰</span>理财</button>
  <button class="tab" :class="{on: tab==='settings'}" @click="tab='settings'"><span class="ic">⚙️</span>设置</button>
</div>
`,
};
